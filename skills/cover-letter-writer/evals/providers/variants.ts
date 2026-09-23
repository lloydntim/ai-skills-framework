import { generateDraft } from '../../src/runtime/generate';
import { runProductionSkill } from '../../src/runtime';
import type { CoverLetterTaskInput, RuntimeConfig } from '../../src/runtime/types';
import type { ResolvedModelRoles } from '@skills/framework/provider/model-roles';
import type { EvalCase, Variant, VariantOutput } from '../types';

export function toCoverLetterTaskInput(kase: EvalCase): CoverLetterTaskInput {
  return {
    cvText: kase.cvText,
    roleDescription: kase.roleDescription,
    instructions: kase.instructions,
    language: kase.language,
    market: kase.market,
    templateLanguage: kase.templateLanguage,
    requiredExactStrings: kase.requiredExactStrings,
    requiredTerms: kase.requiredTerms,
    forbiddenClaims: kase.forbiddenClaims,
    allowedTechnologies: kase.allowedTechnologies,
    allowedNumbers: kase.allowedNumbers,
    minWords: kase.minWords,
    maxWords: kase.maxWords,
  };
}

/**
 * A = plain model, no SKILL.md.
 * B = SKILL.md, single generation pass, no runtime self-review.
 * C = SKILL.md + the real production pipeline (generate -> validate -> revise, see src/runtime).
 *     Calls runProductionSkill directly — the eval framework never reimplements that loop.
 */
export async function runVariant(
  variant: Variant,
  kase: EvalCase,
  roles: ResolvedModelRoles,
  config: RuntimeConfig
): Promise<VariantOutput> {
  const input = toCoverLetterTaskInput(kase);

  if (variant === 'A') {
    const result = await generateDraft(input, roles.generator.provider, roles.generator.model, config, 'baseline');
    return {
      variant,
      caseId: kase.id,
      text: result.text,
      usage: result.usage,
      latencyMs: result.latencyMs,
      cost: result.cost,
      revisionAttempts: 0,
      // One generate call and nothing else. Recorded explicitly so request count is comparable
      // across every variant rather than being present only for the self-reviewing pipeline.
      requestCount: 1,
    };
  }

  if (variant === 'B') {
    const result = await generateDraft(input, roles.generator.provider, roles.generator.model, config, 'skill');
    return {
      variant,
      caseId: kase.id,
      text: result.text,
      usage: result.usage,
      latencyMs: result.latencyMs,
      cost: result.cost,
      revisionAttempts: 0,
      requestCount: 1,
    };
  }

  const result = await runProductionSkill(input, roles, config);
  return {
    variant,
    caseId: kase.id,
    text: result.finalText,
    usage: result.totalUsage,
    latencyMs: result.totalLatencyMs,
    cost: result.totalCost,
    revisionAttempts: result.revisionAttempts,
    requestCount: result.requestCount,
    initialGenerationPassed: result.initialPass,
  };
}
