import { MODEL_ROLES, type ModelRole, type ResolvedModelRoles } from '@skills/framework/provider/model-roles';
import { createRuntime } from '@skills/framework/runtime/controller';
import { settle } from '@skills/framework/runtime/result';
import { spendOf, type TraceSink } from '@skills/framework/runtime/trace';
import { coverLetterSkill, SKILL_NAME } from './skill';
import type { CoverLetterTaskInput, ProductionResult, RoleUsage, RuntimeConfig, ValidationResult } from './types';

/** A role this run never called reports a real, zeroed total rather than being absent. */
function unused(): RoleUsage {
  return { requestCount: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 } };
}

export interface ProductionOptions {
  /** Where the finished run trace goes. Absent: the trace is built and returned, and nothing is written. */
  traceSink?: TraceSink;
}

/**
 * Runs the production Cover Letter Writer flow:
 *
 *   generate -> deterministic validation -> semantic validation
 *   -> bounded targeted revision when necessary
 *   -> deterministic + semantic revalidation (repeat, capped at config.maxRevisionAttempts)
 *   -> final result
 *
 * The flow itself is the shared runtime's (framework/runtime); this function hands it this skill
 * (./skill.ts) and returns the shape callers have always received, so evals and scripts are
 * unchanged. Deterministic and semantic validation are combined inside validateDraft (see
 * validate.ts); the deterministic half is always src/deterministic-checks.ts itself.
 *
 * What is the same as before: the last draft is returned even when it still fails validation
 * (`finalValidation.pass` is false), and a provider or skill error is thrown as the error it was.
 * What is new: `trace`, the run's record, and limits the runtime enforces when the skill's
 * skill.json sets them.
 */
export async function runProductionSkill(
  input: CoverLetterTaskInput,
  roles: ResolvedModelRoles,
  config: RuntimeConfig,
  skillPath?: string,
  options: ProductionOptions = {}
): Promise<ProductionResult> {
  const runtime = createRuntime({ skills: [coverLetterSkill(config, skillPath)], roles, traceSink: options.traceSink });

  const result = await runtime.execute<CoverLetterTaskInput, ValidationResult>({
    skill: SKILL_NAME,
    input,
    options: { settings: { execution: { maxRevisions: config.maxRevisionAttempts } } },
  });

  // Running out of revisions is an outcome this skill has always returned, not thrown.
  const { output, detail, trace } = settle(result);

  const calls = trace.modelCalls;
  const total = spendOf(calls);
  const usageByRole = {} as Record<ModelRole, RoleUsage>;
  for (const role of MODEL_ROLES) usageByRole[role] = spendOf(calls, role) ?? unused();

  return {
    finalText: output,
    initialPass: trace.validationResults[0]?.status === 'pass',
    finalValidation: detail,
    revisionAttempts: trace.attempts - 1,
    requestCount: total?.requestCount ?? 0,
    totalUsage: total?.usage ?? unused().usage,
    totalLatencyMs: total?.latencyMs,
    totalCost: total?.cost,
    usageByRole,
    trace,
  };
}

export type { ValidationResult };
