import { describe, expect, it } from 'vitest';
import { LlmResponseValidationError } from '@skills/framework/llm-json-response';
import { SingleResponseProvider } from '@skills/framework/testing/single-response-provider';
import type { CvTaskInput, RuntimeConfig } from './types';
import { validateDraft } from './validator';

const MODEL = 'fake-model';

const config: RuntimeConfig = {
  temperature: 0,
  maxRevisionAttempts: 5,
  maxLengthRatio: 100, // generous: these tests are about the judge's JSON, not length checks
  forbiddenCharacters: ['—', '–'],
  thresholds: {
    faithfulness: 5,
    unsupportedClaims: 0,
    naturalness: 4,
    cvQuality: 4,
    terminology: 4,
  },
};

const input: CvTaskInput = {
  sourceLanguage: 'de',
  targetLanguage: 'en',
  input: 'Kurzer Lebenslaufabschnitt.',
  instructions: 'Translate faithfully.',
};

function judgeSaid(json: Record<string, unknown>): SingleResponseProvider {
  return new SingleResponseProvider({ text: JSON.stringify(json) });
}

const VALID_JUDGE_RESPONSE = {
  faithfulness: 5,
  naturalness: 5,
  cvQuality: 5,
  terminology: 5,
  unsupportedClaims: [],
  hardGuardrailFailures: [],
};

describe('validateDraft — semantic validator response hardening', () => {
  it('accepts a well-formed, in-range judge response', async () => {
    const provider = judgeSaid(VALID_JUDGE_RESPONSE);

    const result = await validateDraft(input, 'A faithful draft.', provider, MODEL, config);

    expect(result.pass).toBe(true);
    expect(result.scores).toEqual({ faithfulness: 5, naturalness: 5, cvQuality: 5, terminology: 5 });
  });

  it('rejects a reply that is not JSON at all', async () => {
    const provider = new SingleResponseProvider({ text: 'Sure, here are the scores: great job!' });

    await expect(validateDraft(input, 'A draft.', provider, MODEL, config)).rejects.toThrow(/did not return JSON/);
  });

  it('rejects malformed JSON (syntax error inside the braces)', async () => {
    const provider = new SingleResponseProvider({ text: '{ "faithfulness": 5, "naturalness": }' });

    await expect(validateDraft(input, 'A draft.', provider, MODEL, config)).rejects.toThrow(/invalid JSON/);
  });

  it('rejects a response missing a required field', async () => {
    const { terminology, ...withoutTerminology } = VALID_JUDGE_RESPONSE;
    void terminology;
    const provider = judgeSaid(withoutTerminology);

    await expect(validateDraft(input, 'A draft.', provider, MODEL, config)).rejects.toThrow(LlmResponseValidationError);
    await expect(validateDraft(input, 'A draft.', provider, MODEL, config)).rejects.toThrow(/terminology/);
  });

  it('rejects a score outside the 1-5 range', async () => {
    const provider = judgeSaid({ ...VALID_JUDGE_RESPONSE, faithfulness: 7 });

    await expect(validateDraft(input, 'A draft.', provider, MODEL, config)).rejects.toThrow(LlmResponseValidationError);
  });

  it('rejects a non-integer score', async () => {
    const provider = judgeSaid({ ...VALID_JUDGE_RESPONSE, faithfulness: 4.5 });

    await expect(validateDraft(input, 'A draft.', provider, MODEL, config)).rejects.toThrow(LlmResponseValidationError);
  });

  it('rejects a field of the wrong type instead of coercing it', async () => {
    // A string score ("5") must not be silently accepted as the number 5.
    const provider = judgeSaid({ ...VALID_JUDGE_RESPONSE, faithfulness: '5' });

    await expect(validateDraft(input, 'A draft.', provider, MODEL, config)).rejects.toThrow(LlmResponseValidationError);
  });

  it('rejects hardGuardrailFailures/unsupportedClaims that are not arrays of strings', async () => {
    const provider = judgeSaid({ ...VALID_JUDGE_RESPONSE, unsupportedClaims: 'none' });

    await expect(validateDraft(input, 'A draft.', provider, MODEL, config)).rejects.toThrow(LlmResponseValidationError);
  });
});
