import { describe, expect, it } from 'vitest';
import { LlmResponseValidationError } from '@skills/framework/llm-json-response';
import { FakeModelProvider } from '../src/test-support/fake-model-provider';
import { evaluateQuality } from './evaluator';
import type { EvalCase } from './types';

const kase: EvalCase = {
  id: 'case-1',
  category: 'naturalness',
  language: 'en',
  cvText: 'Short CV excerpt.',
  roleDescription: 'Backend engineer role.',
  instructions: 'Write a faithful cover letter.',
};

const config = { model: 'fake-model', temperature: 0 };

function judgeSaid(json: Record<string, unknown>): FakeModelProvider {
  return new FakeModelProvider().queueResponse({ text: JSON.stringify(json) });
}

const VALID_EVALUATOR_RESPONSE = {
  factualGrounding: 5,
  jobRelevance: 4,
  professionalTone: 4,
  specificity: 4,
  naturalness: 4,
  conciseness: 4,
  overall: 4,
  justification: 'Solid, well-grounded letter.',
  problems: [],
  missingExpectedFacts: [],
  unsupportedClaims: [],
  ownershipInflationNotes: [],
  unofferedBenefitNotes: [],
};

describe('evaluateQuality — evaluator score response hardening', () => {
  it('accepts a well-formed, in-range judge response', async () => {
    const provider = judgeSaid(VALID_EVALUATOR_RESPONSE);

    const { quality } = await evaluateQuality(kase, 'A grounded draft.', provider, config);

    expect(quality).toEqual(VALID_EVALUATOR_RESPONSE);
  });

  it('defaults optional list/justification fields the model omitted, without failing validation', async () => {
    const { justification, problems, ...required } = VALID_EVALUATOR_RESPONSE;
    void justification;
    void problems;
    const provider = judgeSaid(required);

    const { quality } = await evaluateQuality(kase, 'A grounded draft.', provider, config);

    expect(quality.justification).toBe('');
    expect(quality.problems).toEqual([]);
  });

  it('rejects a reply that is not JSON at all', async () => {
    const provider = new FakeModelProvider().queueResponse({ text: 'Looks great overall!' });

    await expect(evaluateQuality(kase, 'A draft.', provider, config)).rejects.toThrow(/did not return JSON/);
  });

  it('rejects malformed JSON', async () => {
    const provider = new FakeModelProvider().queueResponse({ text: '{ "factualGrounding": 5, }' });

    await expect(evaluateQuality(kase, 'A draft.', provider, config)).rejects.toThrow(/invalid JSON/);
  });

  it('rejects a response missing a required scored dimension', async () => {
    const { overall, ...withoutOverall } = VALID_EVALUATOR_RESPONSE;
    void overall;

    await expect(evaluateQuality(kase, 'A draft.', judgeSaid(withoutOverall), config)).rejects.toThrow(
      LlmResponseValidationError
    );
    await expect(evaluateQuality(kase, 'A draft.', judgeSaid(withoutOverall), config)).rejects.toThrow(/overall/);
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
