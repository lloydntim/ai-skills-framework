import type { PromptComponentSize } from '@skills/framework/provider/request-metadata';
import type { GenerationResult, ModelProvider } from '@skills/framework/provider/types';
import { BASELINE_SYSTEM_PROMPT, loadSkillPrompt } from '../skill-loader';
import type { CvTaskInput, RuntimeConfig } from './types';

export type GenerationMode = 'baseline' | 'skill';

export function buildUserPrompt(input: CvTaskInput): string {
  return [
    `Source language: ${input.sourceLanguage}`,
    `Target language: ${input.targetLanguage}`,
    input.targetMarket ? `Target market: ${input.targetMarket}` : undefined,
    '',
    `Instructions: ${input.instructions}`,
    '',
    'Source text:',
    input.input,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');
}

export async function generateDraft(
  input: CvTaskInput,
  provider: ModelProvider,
  model: string,
  config: RuntimeConfig,
  mode: GenerationMode,
  skillPath?: string
): Promise<GenerationResult> {
  const systemPrompt = mode === 'skill' ? loadSkillPrompt(skillPath) : BASELINE_SYSTEM_PROMPT;

  // Character counts, not token counts: no local tokenizer exists in this project, and the
  // provider only reports usage for the request as a whole. This is the one thing about each
  // component that can be measured exactly, useful as a rough size guide — never presented as a
  // token count.
  const components: PromptComponentSize[] = [
    { component: mode === 'skill' ? 'skill' : 'baseline-prompt', chars: systemPrompt.length },
    { component: 'task-instructions', chars: input.instructions.length },
    { component: 'case-input', chars: input.input.length },
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
