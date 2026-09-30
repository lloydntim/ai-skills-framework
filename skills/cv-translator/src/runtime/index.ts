import type { ResolvedModelRoles } from '@skills/framework/provider/model-roles';
import { createRuntime } from '@skills/framework/runtime/controller';
import { settle } from '@skills/framework/runtime/result';
import { spendOf, type TraceSink } from '@skills/framework/runtime/trace';
import { cvTranslatorSkill, SKILL_NAME } from './skill';
import type { CvTaskInput, ProductionResult, RoleUsageSummary, RuntimeConfig, ValidationResult } from './types';

const unused = (): RoleUsageSummary => ({ requestCount: 0, usage: {} });

export interface ProductionOptions {
  /** Where the finished run trace goes. Absent: the trace is built and returned, and nothing is written. */
  traceSink?: TraceSink;
}

/**
 * Runs the production pipeline: generate, validate, and revise until validation passes or the
 * revisions run out. The pipeline itself is the shared runtime's (framework/runtime); this
 * function hands it this skill (./skill.ts) and returns the shape callers of this skill have
 * always received, so evals and scripts are unchanged.
 *
 * What is the same as before: the last draft is returned even when it still fails validation
 * (`validation.pass` is false), and a provider or skill error is thrown as the error it was.
 * What is new: `trace`, the run's record, and limits the runtime enforces when the skill's
 * skill.json sets them.
 */
export async function runProductionSkill(
  input: CvTaskInput,
  roles: ResolvedModelRoles,
  config: RuntimeConfig,
  skillPath?: string,
  options: ProductionOptions = {}
): Promise<ProductionResult> {
  const runtime = createRuntime({ skills: [cvTranslatorSkill(config, skillPath)], roles, traceSink: options.traceSink });

  const result = await runtime.execute<CvTaskInput, ValidationResult>({
    skill: SKILL_NAME,
    input,
    options: { settings: { execution: { maxRevisions: config.maxRevisionAttempts } } },
  });

  // Running out of revisions is an outcome this skill has always returned, not thrown.
  const { output, detail, trace } = settle(result);

  const calls = trace.modelCalls;
  const total = spendOf(calls);
  return {
    finalText: output,
    validation: detail,
    revisionAttempts: trace.attempts - 1,
    totalUsage: total?.usage ?? {},
    requestCount: total?.requestCount ?? 0,
    totalLatencyMs: total?.latencyMs,
    totalCost: total?.cost,
    usageByRole: {
      generator: spendOf(calls, 'generator') ?? unused(),
      validator: spendOf(calls, 'validator') ?? unused(),
      reviser: spendOf(calls, 'reviser') ?? unused(),
    },
    trace,
  };
}
