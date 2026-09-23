import type { ResolvedModelRoles } from '@skills/framework/provider/model-roles';
import type { TokenUsage } from '@skills/framework/provider/types';
import { generateDraft } from './generate';
import { reviseDraft } from './revise';
import type { CvTaskInput, ProductionResult, RoleUsageSummary, RuntimeConfig } from './types';
import { validateDraft } from './validator';

function addUsage(a: TokenUsage | undefined, b: TokenUsage | undefined): TokenUsage {
  return {
    inputTokens: (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0),
    outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0),
    totalTokens: (a?.totalTokens ?? 0) + (b?.totalTokens ?? 0),
    cachedInputTokens: (a?.cachedInputTokens ?? 0) + (b?.cachedInputTokens ?? 0),
    reasoningTokens: (a?.reasoningTokens ?? 0) + (b?.reasoningTokens ?? 0),
  };
}

/** undefined only when neither side reported a value, so a fully-unmeasured run stays undefined
 *  rather than reading as a real zero. Used for both latency and cost, which follow the same rule. */
function addOptionalNumber(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
}

function emptyRoleUsage(): RoleUsageSummary {
  return { requestCount: 0, usage: {} };
}

function addToRoleUsage(
  role: RoleUsageSummary,
  call: { usage?: TokenUsage; latencyMs?: number; cost?: number }
): RoleUsageSummary {
  return {
    requestCount: role.requestCount + 1,
    usage: addUsage(role.usage, call.usage),
    latencyMs: addOptionalNumber(role.latencyMs, call.latencyMs),
    cost: addOptionalNumber(role.cost, call.cost),
  };
}

export async function runProductionSkill(
  input: CvTaskInput,
  roles: ResolvedModelRoles,
  config: RuntimeConfig,
  skillPath?: string
): Promise<ProductionResult> {
  const { generator, validator, reviser } = roles;

  let generatorUsage = emptyRoleUsage();
  let validatorUsage = emptyRoleUsage();
  let reviserUsage = emptyRoleUsage();

  let draft = await generateDraft(input, generator.provider, generator.model, config, 'skill', skillPath);
  generatorUsage = addToRoleUsage(generatorUsage, draft);
  let totalUsage: TokenUsage = draft.usage ?? {};
  let totalLatencyMs = draft.latencyMs;
  let totalCost = draft.cost;
  let requestCount = 1;

  let validation = await validateDraft(input, draft.text, validator.provider, validator.model, config, 'semantic-validation');
  validatorUsage = addToRoleUsage(validatorUsage, validation);
  totalUsage = addUsage(totalUsage, validation.usage);
  totalLatencyMs = addOptionalNumber(totalLatencyMs, validation.latencyMs);
  totalCost = addOptionalNumber(totalCost, validation.cost);
  requestCount += 1;

  let revisionAttempts = 0;

  while (!validation.pass && revisionAttempts < config.maxRevisionAttempts) {
    draft = await reviseDraft(input, draft.text, validation, reviser.provider, reviser.model, config, skillPath);
    reviserUsage = addToRoleUsage(reviserUsage, draft);
    totalUsage = addUsage(totalUsage, draft.usage);
    totalLatencyMs = addOptionalNumber(totalLatencyMs, draft.latencyMs);
    totalCost = addOptionalNumber(totalCost, draft.cost);
    requestCount += 1;

    validation = await validateDraft(input, draft.text, validator.provider, validator.model, config, 'revalidation');
    validatorUsage = addToRoleUsage(validatorUsage, validation);
    totalUsage = addUsage(totalUsage, validation.usage);
    totalLatencyMs = addOptionalNumber(totalLatencyMs, validation.latencyMs);
    totalCost = addOptionalNumber(totalCost, validation.cost);
    requestCount += 1;

    revisionAttempts += 1;
  }

  return {
    finalText: draft.text,
    validation,
    revisionAttempts,
    totalUsage,
    requestCount,
    totalLatencyMs,
    totalCost,
    usageByRole: { generator: generatorUsage, validator: validatorUsage, reviser: reviserUsage },
  };
}
