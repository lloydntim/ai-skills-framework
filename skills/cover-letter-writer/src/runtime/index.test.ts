import { describe, expect, it } from 'vitest';
import { LlmResponseValidationError } from '@skills/framework/llm-json-response';
import { FakeModelProvider } from '../test-support/fake-model-provider';
import { makeUniformRoles } from '@skills/framework/testing/uniform-roles';
import type { TokenUsage } from '@skills/framework/provider/types';
import { runProductionSkill } from './index';
import type { CoverLetterTaskInput, RuntimeConfig } from './types';

function usage(inputTokens: number, outputTokens: number, extra: Partial<TokenUsage> = {}): TokenUsage {
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, ...extra };
}

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
const LOW_RELEVANCE_JUDGE_JSON = judgeJson({ jobRelevance: 2 });

const config: RuntimeConfig = {
  temperature: 0.3,
  maxOutputTokens: 4000,
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

describe('runProductionSkill — the generate -> validate -> revise loop', () => {
  it('returns immediately when the first draft passes deterministic and semantic validation', async () => {
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Draft one.', usage: usage(100, 50), latencyMs: 200 })
      .queueResponse({ text: PASSING_JUDGE_JSON, usage: usage(80, 20), latencyMs: 150 });

    const result = await runProductionSkill(input, makeUniformRoles(provider), config);

    expect(result.initialPass).toBe(true);
    expect(result.finalValidation.pass).toBe(true);
    expect(result.revisionAttempts).toBe(0);
    expect(result.finalText).toBe('Draft one.');
    expect(provider.callCount).toBe(2);
    expect(result.requestCount).toBe(2);
  });

  it('recovers from a deterministic failure via one successful revision', async () => {
    // The em dash is a hard deterministic failure (see DEFAULT_FORBIDDEN_CHARACTERS) — the judge
    // scoring everything a 5 must not paper over it.
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Draft one — with a forbidden dash.', usage: usage(100, 50) })
      .queueResponse({ text: PASSING_JUDGE_JSON, usage: usage(80, 20) })
      .queueResponse({ text: 'Draft two, revised, no dash.', usage: usage(90, 40) })
      .queueResponse({ text: PASSING_JUDGE_JSON, usage: usage(80, 20) });

    const result = await runProductionSkill(input, makeUniformRoles(provider), config);

    expect(result.initialPass).toBe(false);
    expect(result.finalValidation.pass).toBe(true);
    expect(result.revisionAttempts).toBe(1);
    expect(result.finalText).toBe('Draft two, revised, no dash.');
    expect(provider.callCount).toBe(4);
    expect(result.requestCount).toBe(4);
  });

  it('recovers from a semantic-only failure (deterministic checks already pass) via one successful revision', async () => {
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Draft one, deterministically clean.', usage: usage(100, 50) })
      .queueResponse({ text: LOW_RELEVANCE_JUDGE_JSON, usage: usage(80, 20) })
      .queueResponse({ text: 'Draft two, now on point for the advert.', usage: usage(90, 40) })
      .queueResponse({ text: PASSING_JUDGE_JSON, usage: usage(80, 20) });

    const result = await runProductionSkill(input, makeUniformRoles(provider), config);

    expect(result.initialPass).toBe(false);
    expect(result.finalValidation.pass).toBe(true);
    expect(result.finalValidation.failingCriteria).not.toContain('jobRelevance');
    expect(result.revisionAttempts).toBe(1);
    expect(provider.callCount).toBe(4);
  });

  it('tries again after a revision that still fails, and can still succeed within the cap', async () => {
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Draft one.', usage: usage(100, 50) })
      .queueResponse({ text: LOW_RELEVANCE_JUDGE_JSON, usage: usage(10, 10) })
      .queueResponse({ text: 'Draft two, still not quite it.', usage: usage(100, 50) })
      .queueResponse({ text: LOW_RELEVANCE_JUDGE_JSON, usage: usage(10, 10) })
      .queueResponse({ text: 'Draft three, finally on point.', usage: usage(100, 50) })
      .queueResponse({ text: PASSING_JUDGE_JSON, usage: usage(10, 10) });

    const result = await runProductionSkill(input, makeUniformRoles(provider), config);

    expect(result.finalValidation.pass).toBe(true);
    expect(result.revisionAttempts).toBe(2);
    expect(result.finalText).toBe('Draft three, finally on point.');
    // 1 generate + 3 validate (initial + 2 revalidations) + 2 revise = 6 requests
    expect(provider.callCount).toBe(6);
    expect(result.requestCount).toBe(6);
  });

  it('caps revision attempts at maxRevisionAttempts and stops even though still failing', async () => {
    const cappedConfig: RuntimeConfig = { ...config, maxRevisionAttempts: 1 };
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Draft one.', usage: usage(100, 50) })
      .queueResponse({ text: LOW_RELEVANCE_JUDGE_JSON, usage: usage(10, 10) })
      .queueResponse({ text: 'Draft two, still failing.', usage: usage(100, 50) })
      .queueResponse({ text: LOW_RELEVANCE_JUDGE_JSON, usage: usage(10, 10) });

    const result = await runProductionSkill(input, makeUniformRoles(provider), cappedConfig);

    expect(result.finalValidation.pass).toBe(false);
    expect(result.revisionAttempts).toBe(1);
    expect(provider.callCount).toBe(4); // stopped here — no third revision call despite still failing
    expect(result.requestCount).toBe(4);
  });

  it('propagates a malformed semantic-validator response as an explicit error rather than defaulting scores', async () => {
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Draft one.', usage: usage(100, 50) })
      .queueResponse({ text: '{ "factualGrounding": 5, "jobRelevance": "not a number" }', usage: usage(10, 10) });

    await expect(runProductionSkill(input, makeUniformRoles(provider), config)).rejects.toThrow(
      LlmResponseValidationError
    );
  });

  it('never calls the reviser once validation already passed, and never calls anything external', async () => {
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Draft one.', usage: usage(100, 50) })
      .queueResponse({ text: PASSING_JUDGE_JSON, usage: usage(80, 20) });

    await runProductionSkill(input, makeUniformRoles(provider), config);

    expect(provider.requests.every((r) => typeof r.userPrompt === 'string')).toBe(true);
    expect(provider.callCount).toBe(2);
  });
});

describe('runProductionSkill — usage and request accounting', () => {
  it('sums usage, latency, cost and request counts exactly, broken down by role', async () => {
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Draft one — bad dash.', usage: usage(100, 50), latencyMs: 200, cost: 0.01 })
      .queueResponse({ text: PASSING_JUDGE_JSON, usage: usage(80, 20), latencyMs: 150, cost: 0.005 })
      .queueResponse({ text: 'Draft two, revised.', usage: usage(120, 60), latencyMs: 220, cost: 0.012 })
      .queueResponse({ text: PASSING_JUDGE_JSON, usage: usage(85, 25), latencyMs: 160, cost: 0.006 });

    const result = await runProductionSkill(input, makeUniformRoles(provider), config);

    const expectedInput = 100 + 80 + 120 + 85;
    const expectedOutput = 50 + 20 + 60 + 25;
    expect(result.totalUsage.inputTokens).toBe(expectedInput);
    expect(result.totalUsage.outputTokens).toBe(expectedOutput);
    expect(result.totalUsage.totalTokens).toBe(expectedInput + expectedOutput);
    expect(result.totalLatencyMs).toBe(200 + 150 + 220 + 160);
    expect(result.totalCost).toBeCloseTo(0.01 + 0.005 + 0.012 + 0.006, 10);
    expect(result.requestCount).toBe(4);

    // Every role points at the same fake provider/model here (makeUniformRoles), so the breakdown
    // is entirely about which role each request was attributed to, not which provider handled it.
    expect(result.usageByRole.generator.requestCount).toBe(1);
    expect(result.usageByRole.generator.usage.inputTokens).toBe(100);
    expect(result.usageByRole.validator.requestCount).toBe(2);
    expect(result.usageByRole.validator.usage.inputTokens).toBe(80 + 85);
    expect(result.usageByRole.reviser.requestCount).toBe(1);
    expect(result.usageByRole.reviser.usage.inputTokens).toBe(120);
    // Roles the production flow never calls report a real, zeroed total rather than being absent.
    expect(result.usageByRole.evaluator).toEqual({ requestCount: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 } });
    expect(result.usageByRole.pairwiseJudge.requestCount).toBe(0);
  });

  it('counts semantic validation and every revalidation, never estimates missing usage, and tracks cached/reasoning tokens separately', async () => {
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Draft one.' }) // no usage/latency/cost reported at all
      .queueResponse({
        text: PASSING_JUDGE_JSON,
        usage: usage(80, 20, { cachedInputTokens: 30, reasoningTokens: 15 }),
        latencyMs: 150,
        cost: 0.004,
      });

    const result = await runProductionSkill(input, makeUniformRoles(provider), config);

    // Missing usage contributes 0, never a guess.
    expect(result.totalUsage.inputTokens).toBe(80);
    expect(result.totalUsage.outputTokens).toBe(20);
    expect(result.totalUsage.cachedInputTokens).toBe(30);
    expect(result.totalUsage.reasoningTokens).toBe(15);
    expect(result.totalLatencyMs).toBe(150);
    expect(result.totalCost).toBe(0.004);
    expect(result.requestCount).toBe(2);
  });

  it('leaves totalLatencyMs and totalCost undefined when no call in the run ever reported them', async () => {
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Draft one.', usage: usage(100, 50) })
      .queueResponse({ text: PASSING_JUDGE_JSON, usage: usage(80, 20) });

    const result = await runProductionSkill(input, makeUniformRoles(provider), config);

    expect(result.totalLatencyMs).toBeUndefined();
    expect(result.totalCost).toBeUndefined();
  });
});

describe('runProductionSkill — prompt-part measurement', () => {
  it('records the size of each prompt part on every request, matching what was sent', async () => {
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Draft one' })
      .queueResponse({ text: LOW_RELEVANCE_JUDGE_JSON })
      .queueResponse({ text: 'Draft two' })
      .queueResponse({ text: PASSING_JUDGE_JSON });

    await runProductionSkill(input, makeUniformRoles(provider), config);

    const parts = provider.requests.map((r) => [r.metadata?.requestType, r.metadata?.components?.map((c) => c.component)]);
    expect(parts).toEqual([
      ['initial-generation', ['skill', 'task-instructions', 'case-input']],
      ['semantic-validation', ['validation-rubric', 'case-input', 'previous-output']],
      ['revision', ['skill', 'task-instructions', 'case-input', 'previous-output']],
      ['revalidation', ['validation-rubric', 'case-input', 'previous-output']],
    ]);

    const [generation, , revision] = provider.requests;
    const size = (r: typeof generation, name: string) => r.metadata!.components!.find((c) => c.component === name)!.chars;
    expect(size(generation, 'skill')).toBe(generation.systemPrompt!.length);
    expect(size(generation, 'case-input')).toBe(input.cvText.length + input.roleDescription.length);
    expect(size(revision, 'previous-output')).toBe('Draft one'.length);
  });
});
