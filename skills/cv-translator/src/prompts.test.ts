import { describe, expect, it } from 'vitest';
import { placeholdersIn } from '@skills/framework/prompts/prompt-file';
import {
  baselineSystemPrompt,
  evaluatorPrompt,
  pairwiseEvaluatorPrompt,
  reviserPrompt,
  validatorPrompt,
} from './prompts';

/** The placeholders each prompt file must contain. A missing or misspelled one would fail loudly at run time. */
const EXPECTED = {
  validator: ['SOURCE', 'INSTRUCTIONS', 'OUTPUT', 'TARGET_LANGUAGE'],
  evaluator: ['SOURCE', 'INSTRUCTIONS', 'OUTPUT', 'TARGET_LANGUAGE', 'TARGET_MARKET', 'EXPECTED_FACTS', 'FORBIDDEN_CLAIMS'],
  pairwiseEvaluator: ['SOURCE', 'INSTRUCTIONS', 'TARGET_LANGUAGE', 'OUTPUT_A', 'OUTPUT_B'],
  reviser: ['TASK', 'PREVIOUS_DRAFT', 'ISSUES'],
};

const sorted = (names: string[]) => [...names].sort();

describe('prompt files', () => {
  it.each([
    ['validator', validatorPrompt],
    ['evaluator', evaluatorPrompt],
    ['pairwiseEvaluator', pairwiseEvaluatorPrompt],
    ['reviser', reviserPrompt],
  ] as const)('%s has exactly the placeholders the code fills in', (name, prompt) => {
    expect(sorted(placeholdersIn(prompt.task))).toEqual(sorted(EXPECTED[name]));
  });

  it.each([
    ['validator', validatorPrompt],
    ['evaluator', evaluatorPrompt],
    ['pairwiseEvaluator', pairwiseEvaluatorPrompt],
  ] as const)('%s has a system prompt', (_name, prompt) => {
    expect(prompt.system?.length ?? 0).toBeGreaterThan(20);
  });

  it('has a baseline system prompt for the no-skill variant', () => {
    expect(baselineSystemPrompt.length).toBeGreaterThan(20);
  });
});
