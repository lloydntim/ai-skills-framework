import { describe, expect, it } from 'vitest';
import { LlmResponseValidationError } from '@skills/framework/llm-json-response';
import { SingleResponseProvider } from '@skills/framework/testing/single-response-provider';
import { evaluateQuality } from './evaluator';
import type { EvalCase } from './types';

const kase: EvalCase = {
  id: 'case-1',
  category: 'naturalness',
  sourceLanguage: 'de',
  targetLanguage: 'en',
  input: 'Kurzer Lebenslaufabschnitt.',
  instructions: 'Translate faithfully.',
};

const config = { model: 'fake-model', temperature: 0 };

function judgeSaid(json: Record<string, unknown>): SingleResponseProvider {
  return new SingleResponseProvider({ text: JSON.stringify(json) });
}

const VALID_EVALUATOR_RESPONSE = {
  faithfulness: 5,
  naturalness: 4,
  cvQuality: 4,
  terminology: 5,
  conciseness: 4,
  overall: 4,
  justification: 'Solid, faithful translation.',
  problems: [],
  missingExpectedFacts: [],
  unsupportedClaims: [],
  seniorityInflationNotes: [],
  terminologyProblems: [],
  naturalnessProblems: [],
};

describe('evaluateQuality — evaluator score response hardening', () => {
  it('accepts a well-formed, in-range judge response', async () => {
    const provider = judgeSaid(VALID_EVALUATOR_RESPONSE);

    const score = await evaluateQuality(kase, 'A faithful draft.', provider, config);

    expect(score).toEqual(VALID_EVALUATOR_RESPONSE);
  });

  it('defaults optional list/justification fields the model omitted, without failing validation', async () => {
    const { justification, problems, ...required } = VALID_EVALUATOR_RESPONSE;
    void justification;
    void problems;
    const provider = judgeSaid(required);

    const score = await evaluateQuality(kase, 'A faithful draft.', provider, config);

    expect(score.justification).toBe('');
    expect(score.problems).toEqual([]);
  });

  it('rejects a reply that is not JSON at all', async () => {
    const provider = new SingleResponseProvider({ text: 'Looks great overall!' });

    await expect(evaluateQuality(kase, 'A draft.', provider, config)).rejects.toThrow(/did not return JSON/);
  });

  it('rejects malformed JSON', async () => {
    const provider = new SingleResponseProvider({ text: '{ "faithfulness": 5, }' });

    await expect(evaluateQuality(kase, 'A draft.', provider, config)).rejects.toThrow(/invalid JSON/);
  });

  it('rejects a response missing a required scored dimension', async () => {
    const { overall, ...withoutOverall } = VALID_EVALUATOR_RESPONSE;
    void overall;
    const provider = judgeSaid(withoutOverall);

    await expect(evaluateQuality(kase, 'A draft.', provider, config)).rejects.toThrow(LlmResponseValidationError);
    await expect(evaluateQuality(kase, 'A draft.', provider, config)).rejects.toThrow(/overall/);
  });

  it('rejects a score outside the 1-5 range', async () => {
    const provider = judgeSaid({ ...VALID_EVALUATOR_RESPONSE, conciseness: 0 });

    await expect(evaluateQuality(kase, 'A draft.', provider, config)).rejects.toThrow(LlmResponseValidationError);
  });

  it('rejects a non-integer score', async () => {
    const provider = judgeSaid({ ...VALID_EVALUATOR_RESPONSE, overall: 3.5 });

    await expect(evaluateQuality(kase, 'A draft.', provider, config)).rejects.toThrow(LlmResponseValidationError);
  });

  it('rejects a field of the wrong type instead of coercing it', async () => {
    const provider = judgeSaid({ ...VALID_EVALUATOR_RESPONSE, problems: 'none' });

    await expect(evaluateQuality(kase, 'A draft.', provider, config)).rejects.toThrow(LlmResponseValidationError);
  });
});
