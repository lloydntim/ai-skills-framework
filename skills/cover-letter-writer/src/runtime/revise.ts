import type { PromptComponentSize } from '@skills/framework/provider/request-metadata';
import type { GenerationResult, ModelProvider } from '@skills/framework/provider/types';
import { renderTemplate } from '@skills/framework/prompts/prompt-file';
import { reviserPrompt } from '../prompts';
import { buildUserPrompt, caseInputChars, skillSystemPrompt } from './generate';
import type { DeterministicCheckResult } from '../deterministic-checks';
import type { CoverLetterTaskInput, RuntimeConfig, SemanticDimension, ValidationResult } from './types';

export const DIMENSION_LABELS: Record<SemanticDimension, string> = {
  factualGrounding: 'low factual-grounding score — a claim in the letter is not actually true of the CV, or overstates ownership level',
  jobRelevance: 'low job-relevance score — the letter does not answer what this specific advert asked for',
  professionalTone: 'low professional-tone score — the register is wrong for this advert/market',
  specificity: 'low specificity score — claims are too generic; use concrete, named evidence from the CV',
  naturalness: 'low naturalness score — the prose reads stilted or templated rather than fluent',
  overall: 'low overall quality score',
};

/** One unmet deterministic rule: a fixed `code` (an identifier, safe to record) and the instruction the reviser is given. */
export interface DeterministicIssue {
  code: string;
  message: string;
}

/**
 * Every rule of the deterministic layer that fails a letter outright, in the order the reviser is
 * told about them. These are exactly the conditions deterministic-checks.ts folds into `pass`; word
 * count, clichés and repeated openers are soft and never appear here. The one place that names them,
 * so the reviser's instructions and the runtime's issue codes cannot disagree.
 */
export function deterministicIssues(d: DeterministicCheckResult): DeterministicIssue[] {
  const issues: DeterministicIssue[] = [];
  const add = (code: string, items: string[], message: (item: string) => string) => {
    for (const item of items) issues.push({ code, message: message(item) });
  };
  add('missing-exact-string', d.missingExactStrings, (s) => `missing required exact text: "${s}"`);
  add('missing-required-group', d.missingRequiredGroups, (g) => `missing required text (any one of): ${g}`);
  add('missing-term', d.missingTerms, (t) => `missing required term: "${t}"`);
  add('forbidden-claim', d.matchedForbiddenClaims, (c) => `remove forbidden claim: "${c}"`);
  add('forbidden-character', d.matchedForbiddenCharacters, (c) => `remove forbidden character: "${c}"`);
  add('unfilled-placeholder', d.unfilledPlaceholders, (p) => `fill in the placeholder: "${p}"`);
  add('unsupported-technology', d.unsupportedTechnologies, (t) => `remove or justify technology not in the CV: "${t}"`);
  add('unsupported-number', d.unsupportedNumbers, (n) => `remove or justify number not in the CV: "${n}"`);
  add('phrase-without-cv-support', d.phrasesWithoutCvSupport, (id) => `remove standard phrase not supported by this CV: "${id}"`);
  add('unoffered-preference', d.unofferedPreferences, (id) => `remove claim about a benefit this advert never offered: "${id}"`);
  add('missing-letter-structure', d.missingLetterStructure, (s) => `add missing house-format marker (any one of): ${s}`);
  return issues;
}

/** Turns one ValidationResult into the exact, itemised list of problems a reviser must fix — nothing vaguer than that. */
export function describeFailures(validation: ValidationResult): string[] {
  const deterministic = deterministicIssues(validation.deterministic).map((issue) => issue.message);
  const judgeIssues = validation.judgeHardGuardrailFailures;
  const dimensionIssues = validation.failingCriteria.map((dimension) => DIMENSION_LABELS[dimension]);

  return [...deterministic, ...judgeIssues, ...dimensionIssues];
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
    metadata: { requestType: 'revision', components },
  });
}
