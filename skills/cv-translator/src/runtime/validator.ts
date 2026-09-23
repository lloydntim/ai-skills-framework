import { runDeterministicChecks } from '../deterministic-checks';
import { parseJsonResponse } from '@skills/framework/llm-json-response';
import type { PromptComponentSize } from '@skills/framework/provider/request-metadata';
import type { ModelProvider } from '@skills/framework/provider/types';
import { renderTemplate } from '@skills/framework/prompts/prompt-file';
import { validatorPrompt } from '../prompts';
import { SemanticValidatorResponseSchema } from './validator-schema';
import type { CvTaskInput, RuntimeConfig, ValidationResult } from './types';


export async function validateDraft(
  input: CvTaskInput,
  draftText: string,
  provider: ModelProvider,
  model: string,
  config: RuntimeConfig,
  /**
   * Distinguishes the first validation of a draft from a revalidation after a revision — both call
   * this same function, and only the caller (src/runtime/index.ts) knows which one this is.
   * Defaults to the first-call case so existing call sites need no change.
   */
  requestType: 'semantic-validation' | 'revalidation' = 'semantic-validation'
): Promise<ValidationResult> {
  const deterministic = runDeterministicChecks({
    output: draftText,
    requiredExactStrings: input.requiredExactStrings,
    requiredTerms: input.requiredTerms,
    forbiddenClaims: input.forbiddenClaims,
    sourceText: input.input,
    maxLengthRatio: input.maxLengthRatio ?? config.maxLengthRatio,
    forbiddenCharacters: config.forbiddenCharacters,
  });

  const prompt = renderTemplate(validatorPrompt.task, {
    SOURCE: input.input,
    INSTRUCTIONS: input.instructions,
    OUTPUT: draftText,
    TARGET_LANGUAGE: input.targetLanguage,
  });

  const components: PromptComponentSize[] = [
    { component: 'validation-rubric', chars: validatorPrompt.task.length },
    { component: 'case-input', chars: input.input.length },
    { component: 'previous-output', chars: draftText.length },
  ];

  const result = await provider.generate({
    systemPrompt: validatorPrompt.system,
    userPrompt: prompt,
    model,
    temperature: 0,
    metadata: { requestType, components },
  });

  const judged = parseJsonResponse(result.text, SemanticValidatorResponseSchema, 'Semantic validator');

  const hardGuardrailFailures = [
    ...deterministic.missingExactStrings.map((s) => `missing required exact string: "${s}"`),
    ...deterministic.missingTerms.map((t) => `missing required term: "${t}"`),
    ...deterministic.matchedForbiddenClaims.map((c) => `forbidden claim present: "${c}"`),
    ...deterministic.matchedForbiddenCharacters.map((c) => `forbidden character used: "${c}"`),
    ...(deterministic.boldMarkerMismatch
      ? [
          `markdown bold formatting not preserved: source has ${deterministic.sourceBoldMarkerCount} '**' markers, output has ${deterministic.outputBoldMarkerCount}`,
        ]
      : []),
    ...(deterministic.paragraphBreakMismatch
      ? [
          `paragraph/entry structure not preserved: source has ${deterministic.sourceParagraphBreakCount} paragraph breaks, output has ${deterministic.outputParagraphBreakCount}`,
        ]
      : []),
    ...judged.hardGuardrailFailures,
  ];

  const failingCriteria: string[] = [];
  if (judged.faithfulness < config.thresholds.faithfulness) failingCriteria.push('faithfulness');
  if (judged.unsupportedClaims.length > config.thresholds.unsupportedClaims) failingCriteria.push('unsupportedClaims');
  if (judged.naturalness < config.thresholds.naturalness) failingCriteria.push('naturalness');
  if (judged.cvQuality < config.thresholds.cvQuality) failingCriteria.push('cvQuality');
  if (judged.terminology < config.thresholds.terminology) failingCriteria.push('terminology');
  if (deterministic.lengthExceeded) failingCriteria.push('length');
  if (deterministic.repeatedEntryOpeners.length > 0) failingCriteria.push('repetition');

  const pass = hardGuardrailFailures.length === 0 && failingCriteria.length === 0;

  return {
    pass,
    hardGuardrailFailures,
    scores: {
      faithfulness: judged.faithfulness,
      naturalness: judged.naturalness,
      cvQuality: judged.cvQuality,
      terminology: judged.terminology,
    },
    unsupportedClaims: judged.unsupportedClaims,
    failingCriteria,
    usage: result.usage,
    latencyMs: result.latencyMs,
    cost: result.cost,
  };
}
