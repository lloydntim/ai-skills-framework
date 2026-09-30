import { randomUUID } from 'node:crypto';
import type { ModelRole, ResolvedModelRoles } from '../provider/model-roles';
import { BudgetTracker, budgetFailure } from './budget';
import { DEFAULT_RUNTIME_SETTINGS, resolveSettings, type RuntimeOverrides, type RuntimeSettings } from './config';
import { classifyError, RuntimeFailure, summariseFailure, type FailurePhase, type FailureSummary } from './failure';
import { buildRoleHandles } from './gateway';
import type { RuntimeSkill, Step } from './skill';
import { isTerminal, RunStateMachine, type StateChange, type RunState } from './state';
import { ToolBroker, type ConfirmTool, type ToolPolicy } from './tools';
import {
  safeCode,
  sumOptional,
  sumUsage,
  type ModelCallRecord,
  type RunTrace,
  type TraceSink,
  type ValidationRecord,
} from './trace';
import type { ValidationOutcome } from './validation';

export interface RuntimeDependencies {
  /** The skills this runtime can run, looked up by name. */
  skills: readonly RuntimeSkill<any, any, any>[];
  /**
   * Which model plays each role. A function is called with the skill's name, for a runtime that
   * serves skills with different config/models.json files. A throw is a CONFIGURATION_ERROR.
   */
  roles: ResolvedModelRoles | ((skill: string) => ResolvedModelRoles);
  /** Replaces the framework defaults for every run this runtime makes. Rarely needed. */
  defaults?: RuntimeSettings;
  /** What capabilities may be used. Absent means none, so a skill that declares a tool cannot run. */
  toolPolicy?: ToolPolicy;
  confirmTool?: ConfirmTool;
  /** Receives each finished trace when `tracing.enabled` is on. Absent: the trace is only returned. */
  traceSink?: TraceSink;
  /** Called on every state change, for a caller that wants to watch a run as it happens. */
  onStateChange?: (change: StateChange, from: RunState) => void;
  /** Injected so tests are deterministic. */
  now?: () => number;
  newRunId?: () => string;
}

export interface ExecuteRequest<Input> {
  skill: string;
  input: Input;
  options?: { settings?: RuntimeOverrides };
}

interface RunResultBase<Detail> {
  /** The last draft. Present on a completed run, and on a failed one that got as far as a draft. */
  output?: string;
  /** The skill's own last validation result, for callers that want more than pass/fail. Not traced. */
  detail?: Detail;
  trace: RunTrace;
  /** False when tracing was on and the sink threw. The run's outcome is not affected. */
  traceWritten: boolean;
}

export type RunResult<Detail = unknown> =
  | (RunResultBase<Detail> & { status: 'completed'; output: string })
  | (RunResultBase<Detail> & { status: 'failed'; failure: FailureSummary; cause?: unknown });

export interface Runtime {
  execute<Input, Detail = unknown>(request: ExecuteRequest<Input>): Promise<RunResult<Detail>>;
}

/**
 * The one entry point for running a skill:
 *
 *   INITIALISING  find the skill, resolve settings (defaults -> skill -> run options)
 *   PREPARING     resolve roles, check required tools against policy, let the skill prepare
 *   EXECUTING     the skill's first draft
 *   VALIDATING    the skill's validation, reduced to pass / revise / fail
 *   REVISING      another draft, only if revisions and budget remain
 *   COMPLETED | FAILED, then the trace is written
 *
 * This function sequences those stages and decides what happens next. The parts (settings, budget,
 * tool policy, model gateway, trace) are separate modules and are handed what they need.
 */
export function createRuntime(deps: RuntimeDependencies): Runtime {
  const skills = new Map<string, RuntimeSkill<any, any, any>>();
  for (const skill of deps.skills) {
    if (skills.has(skill.name)) throw new Error(`Skill "${skill.name}" is registered twice.`);
    skills.set(skill.name, skill);
  }
  const now = deps.now ?? Date.now;

  async function execute<Input, Detail>(request: ExecuteRequest<Input>): Promise<RunResult<Detail>> {
    const runId = (deps.newRunId ?? randomUUID)();
    const startedAt = now();
    const machine = new RunStateMachine(now);
    if (deps.onStateChange) machine.onTransition(deps.onStateChange);

    const modelCalls: ModelCallRecord[] = [];
    const validationResults: ValidationRecord[] = [];
    const broker = new ToolBroker(deps.toolPolicy, deps.confirmTool);
    let settings: RuntimeSettings = deps.defaults ?? DEFAULT_RUNTIME_SETTINGS;
    let phase: FailurePhase = 'prepare';
    let attempts = 0;
    let output: string | undefined;
    let last: ValidationOutcome<Detail> | undefined;
    let failure: RuntimeFailure | undefined;

    try {
      const skill = skills.get(request.skill);
      if (!skill) throw new RuntimeFailure('CONFIGURATION_ERROR', `No skill named "${request.skill}" is registered.`);
      settings = resolveSettings({ defaults: deps.defaults, skill: skill.settings, run: request.options?.settings });

      machine.transition('PREPARING');
      const roles = resolveRoles(deps.roles, skill.name);
      const budget = new BudgetTracker(settings.budget, now, startedAt);
      await broker.requireAll(skill.tools?.required ?? []);
      const handles = buildRoleHandles(roles, budget, modelCalls);
      const prepared = await skill.prepare?.(request.input);

      const stepFor = (attempt: number): Step<Input, unknown> => ({
        input: request.input,
        prepared,
        roles: handles,
        attempt,
        tools: broker,
      });

      machine.transition('EXECUTING');
      phase = 'execute';
      output = await skill.generate(stepFor(0));
      attempts = 1;

      if (!settings.validation.enabled) {
        validationResults.push({ attempt: 0, status: 'skipped', issues: [] });
        machine.transition('COMPLETED');
      }

      let revisions = 0;
      while (machine.state !== 'COMPLETED') {
        machine.transition('VALIDATING');
        phase = 'validate';
        last = (await skill.validate(stepFor(attempts - 1), output, revisions === 0 ? 'initial' : 'revalidation')) as ValidationOutcome<Detail>;
        const { decision } = last;
        validationResults.push({
          attempt: attempts - 1,
          status: decision.status,
          issues: decision.status === 'pass' ? [] : decision.issues.map((i) => ({ source: i.source, code: safeCode(i.code) })),
        });

        if (decision.status === 'pass') {
          machine.transition('COMPLETED');
        } else if (decision.status === 'fail') {
          throw new RuntimeFailure('VALIDATION_ERROR', 'Validation concluded the output cannot be fixed by revising it.');
        } else if (revisions >= settings.execution.maxRevisions) {
          throw new RuntimeFailure('VALIDATION_ERROR', `Validation still failing after ${revisions} revision(s), the maximum.`);
        } else {
          const verdict = budget.check();
          if (!verdict.ok) throw budgetFailure(verdict, 'before revising');
          machine.transition('REVISING');
          phase = 'revise';
          output = await skill.revise(stepFor(attempts), output, last);
          revisions += 1;
          attempts += 1;
        }
      }
    } catch (err) {
      failure = classifyError(err, phase);
      if (!isTerminal(machine.state)) machine.transition('FAILED');
    }

    const finishedAt = now();
    const trace: RunTrace = {
      runId,
      skill: request.skill,
      startedAt,
      finishedAt,
      states: [...machine.history],
      models: modelsUsed(modelCalls),
      settings,
      attempts,
      validationResults,
      modelCalls,
      toolCalls: broker.calls,
      tokenUsage: sumUsage(modelCalls),
      cost: sumOptional(modelCalls.map((c) => c.cost)),
      finalStatus: failure ? 'failed' : 'completed',
      failure: failure ? summariseFailure(failure) : undefined,
    };

    let traceWritten = false;
    if (settings.tracing.enabled && deps.traceSink) {
      try {
        await deps.traceSink.write(trace);
        traceWritten = true;
      } catch {
        // Recording must never change what a run did; the caller can see that it was not written.
      }
    }

    const base = { output, detail: last?.detail, trace, traceWritten };
    if (failure) return { ...base, status: 'failed', failure: summariseFailure(failure), cause: failure.options.cause ?? failure };
    return { ...base, status: 'completed', output: output as string };
  }

  return { execute };
}

function resolveRoles(roles: RuntimeDependencies['roles'], skill: string): ResolvedModelRoles {
  if (typeof roles !== 'function') return roles;
  try {
    return roles(skill);
  } catch (err) {
    if (err instanceof RuntimeFailure) throw err;
    throw new RuntimeFailure('CONFIGURATION_ERROR', `Model roles for "${skill}" could not be loaded.`, { cause: err });
  }
}

function modelsUsed(calls: readonly ModelCallRecord[]): RunTrace['models'] {
  const models: RunTrace['models'] = {};
  for (const call of calls) models[call.role as ModelRole] = { provider: call.provider, model: call.model };
  return models;
}
