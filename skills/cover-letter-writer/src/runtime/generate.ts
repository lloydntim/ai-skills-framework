import { contactBlocks } from '../markets';
import type { PromptComponentSize } from '@skills/framework/provider/request-metadata';
import type { GenerationResult, ModelProvider } from '@skills/framework/provider/types';
import { BASELINE_SYSTEM_PROMPT, loadSkillPrompt } from '../skill-loader';
import { selectSkillSections } from '../skill-sections';
import type { CoverLetterTaskInput, RuntimeConfig } from './types';

/**
 * 'skill' (SKILL.md as the system prompt) is what production always uses. 'baseline' (a generic
 * writing-assistant prompt, no SKILL.md) exists so the eval framework can measure what the skill's
 * instructions are actually worth — see evals/providers/variants.ts, variant A.
 */
export type GenerationMode = 'baseline' | 'skill';

export function buildUserPrompt(input: CoverLetterTaskInput): string {
  const contact = input.market ? contactBlocks()[input.market] : undefined;

  return [
    `Letter language: ${input.language}`,
    input.market ? `Market: ${input.market}` : undefined,
    contact ? `Contact block to use: ${contact.location} | ${contact.phone} | ${contact.email}` : undefined,
    '',
    `Instructions: ${input.instructions}`,
    '',
    'Job advert:',
    input.roleDescription,
    '',
    "Candidate's CV:",
    input.cvText,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');
}

/**
 * The system prompt for the generator and the reviser: SKILL.md, whole, or with the sections this
 * letter cannot use left out when config.skillContext is 'by-task'. Both calls take the same text,
 * because a revision must be held to every rule the draft was written under.
 */
export function skillSystemPrompt(input: CoverLetterTaskInput, config: RuntimeConfig, skillPath?: string): string {
  const skill = loadSkillPrompt(skillPath);
  return config.skillContext === 'by-task' ? selectSkillSections(skill, input).text : skill;
}

/**
 * Characters of what the letter is built from: the CV and the advert. Characters, not tokens (see
 * PromptComponentSize): a rough size guide for deciding what to shorten, never a token count.
 */
export function caseInputChars(input: { cvText: string; roleDescription: string }): number {
  return input.cvText.length + input.roleDescription.length;
}

/** Generates the initial draft with the configured generator role, in either mode. Production always calls this with 'skill'. */
export async function generateDraft(
  input: CoverLetterTaskInput,
  provider: ModelProvider,
  model: string,
  config: RuntimeConfig,
  mode: GenerationMode = 'skill',
  skillPath?: string
): Promise<GenerationResult> {
  const systemPrompt = mode === 'skill' ? skillSystemPrompt(input, config, skillPath) : BASELINE_SYSTEM_PROMPT;
  const components: PromptComponentSize[] = [
    { component: mode === 'skill' ? 'skill' : 'baseline-prompt', chars: systemPrompt.length },
    { component: 'task-instructions', chars: input.instructions.length },
    { component: 'case-input', chars: caseInputChars(input) },
  ];

  return provider.generate({
    systemPrompt,
    userPrompt: buildUserPrompt(input),
    model,
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
    metadata: { requestType: 'initial-generation', components },
  });
}
