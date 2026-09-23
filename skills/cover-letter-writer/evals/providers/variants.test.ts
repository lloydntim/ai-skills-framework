import { describe, expect, it } from 'vitest';
import { FakeModelProvider } from '../../src/test-support/fake-model-provider';
import { makeUniformRoles } from '@skills/framework/testing/uniform-roles';
import type { RuntimeConfig } from '../../src/runtime/types';
import type { EvalCase } from '../types';
import { runVariant } from './variants';

function judgeJson(overrides: Partial<{
  factualGrounding: number;
  jobRelevance: number;
  professionalTone: number;
  specificity: number;
  naturalness: number;
  overall: number;
  hardGuardrailFailures: string[];
}> = {}): string {
  return JSON.stringify({
    factualGrounding: 5,
    jobRelevance: 5,
    professionalTone: 5,
    specificity: 5,
    naturalness: 5,
    overall: 5,
    hardGuardrailFailures: [],
    ...overrides,
  });
}

const PASSING_JUDGE_JSON = judgeJson();
const FAILING_JUDGE_JSON = judgeJson({ factualGrounding: 1 });

const config: RuntimeConfig = {
  temperature: 0.3,
  maxRevisionAttempts: 5,
  thresholds: {
    factualGrounding: 5,
    jobRelevance: 4,
    professionalTone: 4,
    specificity: 4,
    naturalness: 4,
    overall: 4,
  },
};

const kase: EvalCase = {
  id: 'benchmark-001',
  category: 'strong-match',
  language: 'en',
  cvText: 'NORTHWIND London | Frontend Architect. Stack: React, TypeScript.',
  roleDescription: 'Senior Frontend Engineer at Acme. React, TypeScript.',
  instructions: 'Write a tailored cover letter.',
};

describe('runVariant("A") — plain model, no SKILL.md', () => {
  it('makes exactly one call and reports requestCount 1, no revision fields', async () => {
    const provider = new FakeModelProvider().queueResponse({ text: 'A plain draft.', usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 } });

    const output = await runVariant('A', kase, makeUniformRoles(provider), config);

    expect(output.text).toBe('A plain draft.');
    expect(output.requestCount).toBe(1);
    expect(output.revisionAttempts).toBe(0);
    expect(output.initialGenerationPassed).toBeUndefined();
    expect(provider.callCount).toBe(1);
  });

  it('does not use SKILL.md as the system prompt', async () => {
    const provider = new FakeModelProvider().queueResponse({ text: 'A plain draft.' });

    await runVariant('A', kase, makeUniformRoles(provider), config);

    expect(provider.requests[0].systemPrompt).not.toMatch(/cover-letter-en/);
  });
});

describe('runVariant("B") — SKILL.md, single generation pass', () => {
  it('makes exactly one call using SKILL.md as the system prompt', async () => {
    const provider = new FakeModelProvider().queueResponse({ text: 'A skill-guided draft.' });

    const output = await runVariant('B', kase, makeUniformRoles(provider), config);

    expect(output.text).toBe('A skill-guided draft.');
    expect(output.requestCount).toBe(1);
    expect(provider.requests[0].systemPrompt).toContain('cover-letter-en');
  });
});

describe('runVariant("C") — the production pipeline as an eval variant', () => {
  it('records an immediate pass with no revision needed', async () => {
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'A faithful draft.', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } })
      .queueResponse({ text: PASSING_JUDGE_JSON, usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 } });

    const output = await runVariant('C', kase, makeUniformRoles(provider), config);

    expect(output.text).toBe('A faithful draft.');
    expect(output.revisionAttempts).toBe(0);
    expect(output.requestCount).toBe(2);
    expect(output.initialGenerationPassed).toBe(true);
    expect(output.usage?.totalTokens).toBe(250);
  });

  it('forces a revision when semantic validation fails, and succeeds once the revision passes', async () => {
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'A slightly unfaithful draft.' })
      .queueResponse({ text: FAILING_JUDGE_JSON })
      .queueResponse({ text: 'A corrected, faithful draft.' })
      .queueResponse({ text: PASSING_JUDGE_JSON });

    const output = await runVariant('C', kase, makeUniformRoles(provider), config);

    expect(output.text).toBe('A corrected, faithful draft.');
    expect(output.revisionAttempts).toBe(1);
    expect(output.requestCount).toBe(4);
    expect(output.initialGenerationPassed).toBe(false);
  });

  it('respects the maximum revision limit instead of retrying indefinitely', async () => {
    const limitedConfig: RuntimeConfig = { ...config, maxRevisionAttempts: 2 };
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Draft one.' })
      .queueResponse({ text: FAILING_JUDGE_JSON })
      .queueResponse({ text: 'Draft two.' })
      .queueResponse({ text: FAILING_JUDGE_JSON })
      .queueResponse({ text: 'Draft three.' })
      .queueResponse({ text: FAILING_JUDGE_JSON }); // a 3rd failure the config's cap must stop it from acting on

    const output = await runVariant('C', kase, makeUniformRoles(provider), limitedConfig);

    expect(output.revisionAttempts).toBe(2);
    // 1 generate + 3 validate (initial + 2 revalidations) + 2 revise = 6, not 8.
    expect(output.requestCount).toBe(6);
    expect(output.initialGenerationPassed).toBe(false);
  });
});
