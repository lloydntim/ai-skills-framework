import { describe, expect, it } from 'vitest';
import { LlmResponseValidationError } from '@skills/framework/llm-json-response';
import { FakeModelProvider } from '../test-support/fake-model-provider';
import type { CoverLetterTaskInput, RuntimeConfig } from './types';
import { validateDraft } from './validate';

const MODEL = 'fake-model';

const config: RuntimeConfig = {
  temperature: 0,
  maxOutputTokens: 2000,
  maxRevisionAttempts: 3,
  thresholds: {
    factualGrounding: 5,
    jobRelevance: 4,
    professionalTone: 4,
    specificity: 4,
    naturalness: 4,
    overall: 4,
  },
};

const input: CoverLetterTaskInput = {
  cvText: 'NORTHWIND London | Frontend Architect. Stack: React, TypeScript.',
  roleDescription: 'Senior Frontend Engineer at Acme. React, TypeScript.',
  instructions: 'Write a tailored cover letter.',
  language: 'en',
};

const VALID_JUDGE_RESPONSE = {
  factualGrounding: 5,
  jobRelevance: 5,
  professionalTone: 5,
  specificity: 5,
  naturalness: 5,
  overall: 5,
  hardGuardrailFailures: [],
};

function judgeSaid(json: Record<string, unknown>): FakeModelProvider {
  return new FakeModelProvider().queueResponse({ text: JSON.stringify(json) });
}

describe('validateDraft — semantic validator response hardening', () => {
  it('accepts a well-formed, in-range judge response', async () => {
    const provider = judgeSaid(VALID_JUDGE_RESPONSE);

    const result = await validateDraft(input, 'A faithful draft.', provider, MODEL, config);

    expect(result.scores).toEqual({
      factualGrounding: 5,
      jobRelevance: 5,
      professionalTone: 5,
      specificity: 5,
      naturalness: 5,
      overall: 5,
    });
    expect(result.judgeHardGuardrailFailures).toEqual([]);
  });

  it('fails overall when the deterministic layer fails even if the judge scores everything a 5', async () => {
    // No CV/advert text is echoed back, so this draft trips the missing-required-text rule below
    // via requiredExactStrings — proving semantic and deterministic validation are combined, not
    // semantic-only.
    const provider = judgeSaid(VALID_JUDGE_RESPONSE);

    const result = await validateDraft(
      { ...input, requiredExactStrings: ['Acme Corp'] },
      'A letter that never names the company.',
      provider,
      MODEL,
      config
    );

    expect(result.pass).toBe(false);
    expect(result.deterministic.pass).toBe(false);
    expect(result.hardGuardrailFailures).toEqual(
      expect.arrayContaining([expect.stringContaining('Acme Corp')])
    );
  });

  it('rejects a reply that is not JSON at all', async () => {
    const provider = new FakeModelProvider().queueResponse({ text: 'Sure, here are the scores: great job!' });

    await expect(validateDraft(input, 'A draft.', provider, MODEL, config)).rejects.toThrow(/did not return JSON/);
  });

  it('rejects malformed JSON (syntax error inside the braces)', async () => {
    const provider = new FakeModelProvider().queueResponse({ text: '{ "factualGrounding": 5, "jobRelevance": }' });

    await expect(validateDraft(input, 'A draft.', provider, MODEL, config)).rejects.toThrow(/invalid JSON/);
  });

  it('rejects a response missing a required dimension', async () => {
    const { specificity, ...withoutSpecificity } = VALID_JUDGE_RESPONSE;
    void specificity;

    let error: unknown;
    try {
      await validateDraft(input, 'A draft.', judgeSaid(withoutSpecificity), MODEL, config);
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(LlmResponseValidationError);
    expect((error as Error).message).toMatch(/specificity/);
  });

  it('rejects a score outside the 1-5 range', async () => {
    const provider = judgeSaid({ ...VALID_JUDGE_RESPONSE, factualGrounding: 7 });

    await expect(validateDraft(input, 'A draft.', provider, MODEL, config)).rejects.toThrow(
      LlmResponseValidationError
    );
  });

  it('rejects a non-integer score', async () => {
    const provider = judgeSaid({ ...VALID_JUDGE_RESPONSE, naturalness: 4.5 });

    await expect(validateDraft(input, 'A draft.', provider, MODEL, config)).rejects.toThrow(
      LlmResponseValidationError
    );
  });

  it('rejects a field of the wrong type instead of coercing it', async () => {
    // A string score ("5") must not be silently accepted as the number 5.
    const provider = judgeSaid({ ...VALID_JUDGE_RESPONSE, overall: '5' });

    await expect(validateDraft(input, 'A draft.', provider, MODEL, config)).rejects.toThrow(
      LlmResponseValidationError
    );
  });

  it('rejects hardGuardrailFailures that is not an array of strings, rather than defaulting it to empty', async () => {
    const provider = judgeSaid({ ...VALID_JUDGE_RESPONSE, hardGuardrailFailures: 'none' });

    await expect(validateDraft(input, 'A draft.', provider, MODEL, config)).rejects.toThrow(
      LlmResponseValidationError
    );
  });
});
