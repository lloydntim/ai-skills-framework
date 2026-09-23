import { generateDraft } from '../../src/runtime/generate';
import { runProductionSkill } from '../../src/runtime';
import type { RuntimeConfig } from '../../src/runtime/types';
import type { ResolvedModelRoles } from '@skills/framework/provider/model-roles';
import type { EvalCase, Variant, VariantOutput } from '../types';

function toCvTaskInput(kase: EvalCase) {
  return {
    sourceLanguage: kase.sourceLanguage,
    targetLanguage: kase.targetLanguage,
    input: kase.input,
    instructions: kase.instructions,
    targetMarket: kase.targetMarket,
    requiredExactStrings: kase.requiredExactStrings,
    requiredTerms: kase.requiredTerms,
    forbiddenClaims: kase.forbiddenClaims,
    maxLengthRatio: kase.maxLengthRatio,
  };
}

/**
 * A = base model, no skill.
 * B = CV skill, single shot, no runtime self-review.
 * C = CV skill + runtime self-review (generate -> validate -> revise, see src/runtime).
 * D = reserved for skill + self-review + external translation provider (e.g. DeepL/Google) — not implemented yet.
 */
export async function runVariant(
  variant: Variant,
  kase: EvalCase,
  roles: ResolvedModelRoles,
  config: RuntimeConfig
): Promise<VariantOutput> {
  const input = toCvTaskInput(kase);

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
      // One generate call and nothing else. Recorded explicitly so request count is comparable
      // across every variant rather than being present only for the self-reviewing pipeline.
      requestCount: 1,
    };
  }

  if (variant === 'C') {
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
      // The revision loop only ever runs when the initial validation failed, so zero revisions
      // combined with the (necessarily initial, in that case) validation having passed is exactly
      // "no correction needed" — zero revisions with a still-failing validation means the run had
      // no revision budget left to spend, not that it passed immediately.
      initialGenerationPassed: result.revisionAttempts === 0 && result.validation.pass,
    };
  }

  throw new Error(
    'Variant D (skill + self-review + external translation provider) is not implemented. ' +
      'Add a provider under evals/providers/ (e.g. deepl-provider.ts) and wire it in here when a translation-provider integration exists in production.'
  );
}
