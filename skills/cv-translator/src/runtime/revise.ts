import type { PromptComponentSize } from '@skills/framework/provider/request-metadata';
import type { GenerationResult, ModelProvider } from '@skills/framework/provider/types';
import { renderTemplate } from '@skills/framework/prompts/prompt-file';
import { reviserPrompt } from '../prompts';
import { loadSkillPrompt } from '../skill-loader';
import { buildUserPrompt } from './generate';
import type { CvTaskInput, RuntimeConfig, ValidationResult } from './types';

const FAILING_CRITERIA_LABELS: Record<string, string> = {
  faithfulness: 'low faithfulness score',
  unsupportedClaims: 'unsupported claims present',
  naturalness: 'low naturalness score',
  cvQuality: 'low CV quality score',
  terminology: 'low terminology score',
  length: 'output is noticeably longer than the source relative to the allowed threshold — tighten the wording without losing meaning',
  repetition:
    'two or more list entries open with the same word — give each entry a different accurate opening word, staying at the same ownership level',
};

export async function reviseDraft(
  input: CvTaskInput,
  previousDraft: string,
  validation: ValidationResult,
  provider: ModelProvider,
  model: string,
  config: RuntimeConfig,
  skillPath?: string
): Promise<GenerationResult> {
  const issues = [
    ...validation.hardGuardrailFailures,
    ...validation.failingCriteria.map((c) => FAILING_CRITERIA_LABELS[c] ?? `low score: ${c}`),
  ];

  const revisionPrompt = renderTemplate(reviserPrompt.task, {
    TASK: buildUserPrompt(input),
    PREVIOUS_DRAFT: previousDraft,
    ISSUES: issues.map((issue) => `- ${issue}`).join('\n'),
  });

  const systemPrompt = loadSkillPrompt(skillPath);
  const components: PromptComponentSize[] = [
    { component: 'skill', chars: systemPrompt.length },
    { component: 'task-instructions', chars: input.instructions.length },
    { component: 'case-input', chars: input.input.length },
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
