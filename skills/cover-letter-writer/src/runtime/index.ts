import { MODEL_ROLES, type ModelRole, type ResolvedModelRoles } from '@skills/framework/provider/model-roles';
import type { TokenUsage } from '@skills/framework/provider/types';
import { generateDraft } from './generate';
import { reviseDraft } from './revise';
import type { CoverLetterTaskInput, ProductionResult, RoleUsage, RuntimeConfig, ValidationResult } from './types';
import { validateDraft } from './validate';

function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 };
}

function addUsage(a: TokenUsage, b: TokenUsage | undefined): TokenUsage {
  return {
    inputTokens: a.inputTokens! + (b?.inputTokens ?? 0),
    outputTokens: a.outputTokens! + (b?.outputTokens ?? 0),
    totalTokens: a.totalTokens! + (b?.totalTokens ?? 0),
    cachedInputTokens: (a.cachedInputTokens ?? 0) + (b?.cachedInputTokens ?? 0),
    reasoningTokens: (a.reasoningTokens ?? 0) + (b?.reasoningTokens ?? 0),
  };
}

/** undefined only when neither side ever reported one, so a fully-unmeasured run stays undefined rather than reading as a real zero. */
function addOptional(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
}

function emptyRoleUsage(): RoleUsage {
  return { requestCount: 0, usage: emptyUsage() };
}

function emptyUsageByRole(): Record<ModelRole, RoleUsage> {
  const byRole = {} as Record<ModelRole, RoleUsage>;
  for (const role of MODEL_ROLES) byRole[role] = emptyRoleUsage();
  return byRole;
}

interface RunTotals {
  totalUsage: TokenUsage;
  totalLatencyMs?: number;
  totalCost?: number;
  requestCount: number;
  usageByRole: Record<ModelRole, RoleUsage>;
}

/** Folds one model call's result into the running totals, both overall and for the specific role that made the call. */
function recordCall(
  totals: RunTotals,
  role: ModelRole,
  call: { usage?: TokenUsage; latencyMs?: number; cost?: number }
): void {
  totals.totalUsage = addUsage(totals.totalUsage, call.usage);
  totals.totalLatencyMs = addOptional(totals.totalLatencyMs, call.latencyMs);
  totals.totalCost = addOptional(totals.totalCost, call.cost);
  totals.requestCount += 1;

  const roleUsage = totals.usageByRole[role];
  roleUsage.requestCount += 1;
  roleUsage.usage = addUsage(roleUsage.usage, call.usage);
  roleUsage.latencyMs = addOptional(roleUsage.latencyMs, call.latencyMs);
  roleUsage.cost = addOptional(roleUsage.cost, call.cost);
}

/**
 * Runs the production Cover Letter Writer flow:
 *
 *   generate -> deterministic validation -> semantic validation
 *   -> bounded targeted revision when necessary
 *   -> deterministic + semantic revalidation (repeat, capped at config.maxRevisionAttempts)
 *   -> final result
 *
 * Deterministic and semantic validation are combined inside validateDraft (see validate.ts); the
 * deterministic half is always src/deterministic-checks.ts itself, never a copy of its logic.
 */
export async function runProductionSkill(
  input: CoverLetterTaskInput,
  roles: ResolvedModelRoles,
  config: RuntimeConfig,
  skillPath?: string
): Promise<ProductionResult> {
  const { generator, validator, reviser } = roles;

  const totals: RunTotals = {
    totalUsage: emptyUsage(),
    requestCount: 0,
    usageByRole: emptyUsageByRole(),
  };

  const draftResult = await generateDraft(input, generator.provider, generator.model, config, 'skill', skillPath);
  recordCall(totals, 'generator', draftResult);
  let draftText = draftResult.text;

  let validation = await validateDraft(
    input,
    draftText,
    validator.provider,
    validator.model,
    config,
    'semantic-validation'
  );
  recordCall(totals, 'validator', validation);

  const initialPass = validation.pass;
  let revisionAttempts = 0;

  while (!validation.pass && revisionAttempts < config.maxRevisionAttempts) {
    const revisionResult = await reviseDraft(
      input,
      draftText,
      validation,
      reviser.provider,
      reviser.model,
      config,
      skillPath
    );
    recordCall(totals, 'reviser', revisionResult);
    draftText = revisionResult.text;

    validation = await validateDraft(
      input,
      draftText,
      validator.provider,
      validator.model,
      config,
      'revalidation'
    );
    recordCall(totals, 'validator', validation);

    revisionAttempts += 1;
  }

  return {
    finalText: draftText,
    initialPass,
    finalValidation: validation,
    revisionAttempts,
    requestCount: totals.requestCount,
    totalUsage: totals.totalUsage,
    totalLatencyMs: totals.totalLatencyMs,
    totalCost: totals.totalCost,
    usageByRole: totals.usageByRole,
  };
}

export type { ValidationResult };
