import type { PromptComponentSize } from '@skills/framework/provider/request-metadata';
import type { GenerationResult, ModelProvider } from '@skills/framework/provider/types';
import { renderTemplate } from '@skills/framework/prompts/prompt-file';
import { reviserPrompt } from '../prompts';
import { buildUserPrompt, caseInputChars, skillSystemPrompt } from './generate';
import type { CoverLetterTaskInput, RuntimeConfig, SemanticDimension, ValidationResult } from './types';

const DIMENSION_LABELS: Record<SemanticDimension, string> = {
  factualGrounding: 'low factual-grounding score — a claim in the letter is not actually true of the CV, or overstates ownership level',
  jobRelevance: 'low job-relevance score — the letter does not answer what this specific advert asked for',
  professionalTone: 'low professional-tone score — the register is wrong for this advert/market',
  specificity: 'low specificity score — claims are too generic; use concrete, named evidence from the CV',
  naturalness: 'low naturalness score — the prose reads stilted or templated rather than fluent',
  overall: 'low overall quality score',
};

/** Turns one ValidationResult into the exact, itemised list of problems a reviser must fix — nothing vaguer than that. */
export function describeFailures(validation: ValidationResult): string[] {
  const deterministicIssues: string[] = [];
  const d = validation.deterministic;
  for (const s of d.missingExactStrings) deterministicIssues.push(`missing required exact text: "${s}"`);
  for (const g of d.missingRequiredGroups) deterministicIssues.push(`missing required text (any one of): ${g}`);
  for (const t of d.missingTerms) deterministicIssues.push(`missing required term: "${t}"`);
  for (const c of d.matchedForbiddenClaims) deterministicIssues.push(`remove forbidden claim: "${c}"`);
  for (const c of d.matchedForbiddenCharacters) deterministicIssues.push(`remove forbidden character: "${c}"`);
  for (const p of d.unfilledPlaceholders) deterministicIssues.push(`fill in the placeholder: "${p}"`);
  for (const t of d.unsupportedTechnologies) deterministicIssues.push(`remove or justify technology not in the CV: "${t}"`);
  for (const n of d.unsupportedNumbers) deterministicIssues.push(`remove or justify number not in the CV: "${n}"`);
  for (const id of d.phrasesWithoutCvSupport) deterministicIssues.push(`remove standard phrase not supported by this CV: "${id}"`);
  for (const id of d.unofferedPreferences) deterministicIssues.push(`remove claim about a benefit this advert never offered: "${id}"`);
  for (const s of d.missingLetterStructure) deterministicIssues.push(`add missing house-format marker (any one of): ${s}`);

  const judgeIssues = validation.judgeHardGuardrailFailures;

  const dimensionIssues = validation.failingCriteria.map((dimension) => DIMENSION_LABELS[dimension]);

  return [...deterministicIssues, ...judgeIssues, ...dimensionIssues];
}

/** Sends the reviser role the previous draft and the exact failed criteria, asking it to change only what is needed. */
export async function reviseDraft(
  input: CoverLetterTaskInput,
  previousDraft: string,
  validation: ValidationResult,
  provider: ModelProvider,
  model: string,
  config: RuntimeConfig,
  skillPath?: string
): Promise<GenerationResult> {
  const issues = describeFailures(validation);

  const revisionPrompt = renderTemplate(reviserPrompt.task, {
    TASK: buildUserPrompt(input),
    PREVIOUS_DRAFT: previousDraft,
    ISSUES: issues.map((issue) => `- ${issue}`).join('\n'),
  });

  const systemPrompt = skillSystemPrompt(input, config, skillPath);
  const components: PromptComponentSize[] = [
    { component: 'skill', chars: systemPrompt.length },
    { component: 'task-instructions', chars: input.instructions.length },
    { component: 'case-input', chars: caseInputChars(input) },
    { component: 'previous-output', chars: previousDraft.length },
  ];

  return provider.generate({
    systemPrompt,
    userPrompt: revisionPrompt,
    model,
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
    metadata: { requestType: 'revision', components },
  });
}
