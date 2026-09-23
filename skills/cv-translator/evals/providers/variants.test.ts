import { describe, expect, it } from 'vitest';
import { BASELINE_SYSTEM_PROMPT } from '../../src/skill-loader';
import { QueuedResponseProvider } from '@skills/framework/testing/queued-response-provider';
import { makeUniformRoles } from '@skills/framework/testing/uniform-roles';
import type { RuntimeConfig } from '../../src/runtime/types';
import type { EvalCase } from '../types';
import { runVariant } from './variants';

function validationJson(overrides: Partial<{
  faithfulness: number;
  naturalness: number;
  cvQuality: number;
  terminology: number;
  unsupportedClaims: string[];
  hardGuardrailFailures: string[];
}> = {}): string {
  return JSON.stringify({
    faithfulness: 5,
    naturalness: 5,
    cvQuality: 5,
    terminology: 5,
    unsupportedClaims: [],
    hardGuardrailFailures: [],
    ...overrides,
  });
}

const PASSING_VALIDATION_JSON = validationJson();
const FAILING_VALIDATION_JSON = validationJson({ faithfulness: 1 });

const config: RuntimeConfig = {
  temperature: 0.3,
  maxRevisionAttempts: 5,
  maxLengthRatio: 100, // generous: these tests are about the pipeline, not length checks
  forbiddenCharacters: ['—', '–'],
  thresholds: {
    faithfulness: 5,
    unsupportedClaims: 0,
    naturalness: 4,
    cvQuality: 4,
    terminology: 4,
  },
};

const kase: EvalCase = {
  id: 'golden-001',
  category: 'faithfulness',
  sourceLanguage: 'de',
  targetLanguage: 'en',
  input: 'Kurzer Lebenslaufabschnitt.',
  instructions: 'Translate faithfully.',
};

describe('runVariant("A") — baseline, no skill', () => {
  it('makes exactly one generate call and reports it with no revisions', async () => {
    const provider = new QueuedResponseProvider([
      { text: 'baseline draft', usage: { inputTokens: 80, outputTokens: 40, totalTokens: 120 }, latencyMs: 90, cost: 0.002 },
    ]);

    const output = await runVariant('A', kase, makeUniformRoles(provider), config);

    expect(output.variant).toBe('A');
    expect(output.caseId).toBe('golden-001');
    expect(output.text).toBe('baseline draft');
    expect(output.usage?.totalTokens).toBe(120);
    expect(output.latencyMs).toBe(90);
    expect(output.cost).toBe(0.002);
    expect(output.revisionAttempts).toBe(0);
    expect(output.requestCount).toBe(1);
    expect(output.initialGenerationPassed).toBeUndefined();
    expect(provider.callCount).toBe(1);
  });

  it('sends the generic baseline system prompt rather than the CV skill (unlike variant B)', async () => {
    const provider = new QueuedResponseProvider([{ text: 'baseline draft' }]);

    await runVariant('A', kase, makeUniformRoles(provider), config);

    expect(provider.requests[0].systemPrompt).toBe(BASELINE_SYSTEM_PROMPT);
  });
});

describe('runVariant("B") — the raw skill, single shot, no self-review', () => {
  it('makes exactly one generate call and reports it with no revisions', async () => {
    const provider = new QueuedResponseProvider([
      { text: 'skill draft', usage: { inputTokens: 200, outputTokens: 90, totalTokens: 290 } },
    ]);

    const output = await runVariant('B', kase, makeUniformRoles(provider), config);

    expect(output.variant).toBe('B');
    expect(output.text).toBe('skill draft');
    expect(output.revisionAttempts).toBe(0);
    expect(output.requestCount).toBe(1);
    expect(output.initialGenerationPassed).toBeUndefined();
    expect(provider.callCount).toBe(1);
  });
});

describe('runVariant("D") — reserved, not implemented', () => {
  it('throws a clear error naming what is missing, rather than silently running something else', async () => {
    const provider = new QueuedResponseProvider([]);

    await expect(runVariant('D', kase, makeUniformRoles(provider), config)).rejects.toThrow(/not implemented/);
    expect(provider.callCount).toBe(0);
  });
});

describe('runVariant("C") — the production pipeline as an eval variant', () => {
  it('records an immediate pass with no revision needed', async () => {
    const provider = new QueuedResponseProvider([
      { text: 'A faithful draft.', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } },
      { text: PASSING_VALIDATION_JSON, usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 } },
    ]);

    const output = await runVariant('C', kase, makeUniformRoles(provider), config);

    expect(output.text).toBe('A faithful draft.');
    expect(output.revisionAttempts).toBe(0);
    expect(output.requestCount).toBe(2);
    expect(output.initialGenerationPassed).toBe(true);
    expect(output.usage?.totalTokens).toBe(250);
  });

  it('forces a revision when deterministic validation fails, even though the judge scores are perfect', async () => {
    // "Northwind Labs" is required but absent from the first draft; the judge is asked to (and
    // does) return a perfect score both times, so the only thing that can be driving the revision
    // is the deterministic check inside the production validator, not the semantic judge.
    const caseWithRequiredString: EvalCase = { ...kase, requiredExactStrings: ['Northwind Labs'] };
    const provider = new QueuedResponseProvider([
      { text: 'A faithful draft with no company name.' },
      { text: PASSING_VALIDATION_JSON },
      { text: 'A faithful draft for Northwind Labs.' },
      { text: PASSING_VALIDATION_JSON },
    ]);

    const output = await runVariant('C', caseWithRequiredString, makeUniformRoles(provider), config);

    expect(output.text).toBe('A faithful draft for Northwind Labs.');
    expect(output.revisionAttempts).toBe(1);
    expect(output.requestCount).toBe(4);
    expect(output.initialGenerationPassed).toBe(false);
  });

  it('reports initialGenerationPassed as false when there is no revision budget to act on a failure', async () => {
    // With maxRevisionAttempts: 0, the revision loop never runs even though validation fails, so
    // revisionAttempts stays 0 — the same value it would have if the draft had genuinely passed.
    // initialGenerationPassed must still read false here: it is not just "no revisions happened",
    // it is "no revisions happened AND the draft actually passed."
    const noBudgetConfig: RuntimeConfig = { ...config, maxRevisionAttempts: 0 };
    const provider = new QueuedResponseProvider([
      { text: 'An unfaithful draft with no budget to fix it.' },
      { text: FAILING_VALIDATION_JSON },
    ]);

    const output = await runVariant('C', kase, makeUniformRoles(provider), noBudgetConfig);

    expect(output.revisionAttempts).toBe(0);
    expect(output.requestCount).toBe(2);
    expect(output.initialGenerationPassed).toBe(false);
  });

  it('forces a revision when semantic validation fails, and succeeds once the revision passes', async () => {
    const provider = new QueuedResponseProvider([
      { text: 'A slightly unfaithful draft.' },
      { text: FAILING_VALIDATION_JSON },
      { text: 'A corrected, faithful draft.' },
      { text: PASSING_VALIDATION_JSON },
    ]);

    const output = await runVariant('C', kase, makeUniformRoles(provider), config);

    expect(output.text).toBe('A corrected, faithful draft.');
    expect(output.revisionAttempts).toBe(1);
    expect(output.requestCount).toBe(4);
    expect(output.initialGenerationPassed).toBe(false);
  });

  it('reports a failing result when the revision still does not pass', async () => {
    const limitedConfig: RuntimeConfig = { ...config, maxRevisionAttempts: 1 };
    const provider = new QueuedResponseProvider([
      { text: 'An unfaithful draft.' },
      { text: FAILING_VALIDATION_JSON },
      { text: 'Still an unfaithful draft.' },
      { text: FAILING_VALIDATION_JSON },
    ]);

    const output = await runVariant('C', kase, makeUniformRoles(provider), limitedConfig);

    expect(output.revisionAttempts).toBe(1);
    expect(output.requestCount).toBe(4);
    expect(output.initialGenerationPassed).toBe(false);
  });

  it('respects the maximum revision limit instead of retrying indefinitely', async () => {
    const limitedConfig: RuntimeConfig = { ...config, maxRevisionAttempts: 2 };
    const provider = new QueuedResponseProvider([
      { text: 'Draft one.' },
      { text: FAILING_VALIDATION_JSON },
      { text: 'Draft two.' },
      { text: FAILING_VALIDATION_JSON },
      { text: 'Draft three.' },
      { text: FAILING_VALIDATION_JSON }, // a 3rd failure the config's cap must stop it from acting on
    ]);

    const output = await runVariant('C', kase, makeUniformRoles(provider), limitedConfig);

    expect(output.revisionAttempts).toBe(2);
    // 1 generate + 3 validate (initial + 2 revalidations) + 2 revise = 6, not 8.
    expect(output.requestCount).toBe(6);
    expect(output.initialGenerationPassed).toBe(false);
  });
});
