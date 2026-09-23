import { runDeterministicChecks, type DeterministicCheckInput } from '../deterministic-checks';
import { parseJsonResponse } from '@skills/framework/llm-json-response';
import { contactRequirements, rightToWork } from '../markets';
import { parsePhraseBank } from '../phrase-bank';
import { parsePreferenceBank } from '../preference-bank';
import type { PromptComponentSize } from '@skills/framework/provider/request-metadata';
import type { ModelProvider } from '@skills/framework/provider/types';
import { SemanticValidatorResponseSchema } from './semantic-validator-schema';
import { renderTemplate } from '@skills/framework/prompts/prompt-file';
import { validatorPrompt } from '../prompts';
import { caseInputChars } from './generate';
import type { CoverLetterTaskInput, RuntimeConfig, SemanticDimension, ValidationResult } from './types';


/** Turns a task input plus a drafted letter into the input for the mechanical checks — never duplicated inline. */
export function toDeterministicCheckInput(input: CoverLetterTaskInput, output: string): DeterministicCheckInput {
  const contact = input.market ? contactRequirements(input.market) : { require: [], forbid: [] };
  const requiredAnyOf = input.market ? rightToWork()[input.market] : [];

  return {
    output,
    cvText: input.cvText,
    roleDescription: input.roleDescription,
    standardPhrases: parsePhraseBank(),
    preferences: parsePreferenceBank(),
    templateLanguage: input.templateLanguage,
    requiredExactStrings: [...(input.requiredExactStrings ?? []), ...contact.require],
    requiredAnyOf,
    requiredTerms: input.requiredTerms,
    forbiddenClaims: [...(input.forbiddenClaims ?? []), ...contact.forbid],
    allowedTechnologies: input.allowedTechnologies,
    allowedNumbers: input.allowedNumbers,
    minWords: input.minWords,
    maxWords: input.maxWords,
  };
}

/**
 * Runs deterministic validation (reused as-is from ../deterministic-checks, never copied), then
 * the cover-letter-specific semantic validator, and combines both into one ValidationResult. The
 * judge's JSON reply is parsed and schema-validated (parseJsonResponse) before any score is
 * trusted — a malformed reply throws rather than silently producing default scores.
 */
export async function validateDraft(
  input: CoverLetterTaskInput,
  draftText: string,
  provider: ModelProvider,
  model: string,
  config: RuntimeConfig,
  requestType: 'semantic-validation' | 'revalidation' = 'semantic-validation'
): Promise<ValidationResult> {
  const deterministic = runDeterministicChecks(toDeterministicCheckInput(input, draftText));

  const prompt = renderTemplate(validatorPrompt.task, {
    CV: input.cvText,
    ROLE_DESCRIPTION: input.roleDescription,
    INSTRUCTIONS: input.instructions,
    LANGUAGE: input.language,
    OUTPUT: draftText,
  });

  // The validator never sees SKILL.md, only its own rubric, so it is not primed by the rules it checks.
  const components: PromptComponentSize[] = [
    { component: 'validation-rubric', chars: validatorPrompt.task.length },
    { component: 'case-input', chars: caseInputChars(input) },
    { component: 'previous-output', chars: draftText.length },
  ];

  const result = await provider.generate({
    systemPrompt: validatorPrompt.system,
    userPrompt: prompt,
    model,
    temperature: 0,
    maxOutputTokens: 2000,
    metadata: { requestType, components },
  });

  const judged = parseJsonResponse(result.text, SemanticValidatorResponseSchema, 'Semantic validator');

  const hardGuardrailFailures = [
    ...deterministic.missingExactStrings.map((s) => `missing required exact string: "${s}"`),
    ...deterministic.missingRequiredGroups.map((g) => `missing required text (any of): ${g}`),
    ...deterministic.missingTerms.map((t) => `missing required term: "${t}"`),
    ...deterministic.matchedForbiddenClaims.map((c) => `forbidden claim present: "${c}"`),
    ...deterministic.matchedForbiddenCharacters.map((c) => `forbidden character used: "${c}"`),
    ...deterministic.unfilledPlaceholders.map((p) => `unfilled placeholder: "${p}"`),
    ...deterministic.unsupportedTechnologies.map((t) => `technology not in the CV: "${t}"`),
    ...deterministic.unsupportedNumbers.map((n) => `number not in the CV: "${n}"`),
    ...deterministic.phrasesWithoutCvSupport.map((id) => `standard phrase not supported by the CV: "${id}"`),
    ...deterministic.unofferedPreferences.map((id) => `job preference the advert never offered: "${id}"`),
    ...deterministic.missingLetterStructure.map((s) => `missing house-format marker (any of): ${s}`),
    ...judged.hardGuardrailFailures,
  ];

  const scores = {
    factualGrounding: judged.factualGrounding,
    jobRelevance: judged.jobRelevance,
    professionalTone: judged.professionalTone,
    specificity: judged.specificity,
    naturalness: judged.naturalness,
    overall: judged.overall,
  };

  const failingCriteria = (Object.keys(scores) as SemanticDimension[]).filter(
    (dimension) => scores[dimension] < config.thresholds[dimension]
  );

  const pass = deterministic.pass && judged.hardGuardrailFailures.length === 0 && failingCriteria.length === 0;

  return {
    pass,
    deterministic,
    scores,
    hardGuardrailFailures,
    judgeHardGuardrailFailures: judged.hardGuardrailFailures,
    failingCriteria,
    usage: result.usage,
    latencyMs: result.latencyMs,
    cost: result.cost,
  };
}
