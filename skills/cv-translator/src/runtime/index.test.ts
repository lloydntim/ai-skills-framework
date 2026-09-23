import { describe, expect, it } from 'vitest';
import type { TokenUsage } from '@skills/framework/provider/types';
import { QueuedResponseProvider as FakeModelProvider } from '@skills/framework/testing/queued-response-provider';
import { makeUniformRoles } from '@skills/framework/testing/uniform-roles';
import { runProductionSkill } from './index';
import type { CvTaskInput, RuntimeConfig } from './types';

// Matches the shape addUsage() always produces (cachedInputTokens/reasoningTokens default to 0
// once summed, even when no call in the run reported them) so it can be used as an expected value
// for both aggregated role/total usage and for a single call's raw GenerationResult.usage.
function usage(inputTokens: number, outputTokens: number): TokenUsage {
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, cachedInputTokens: 0, reasoningTokens: 0 };
}

function usageWithCost(inputTokens: number, outputTokens: number, cost: number) {
  return { usage: usage(inputTokens, outputTokens), cost };
}

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
  maxLengthRatio: 100, // generous: the draft text length here is not the point of these tests
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

describe('runProductionSkill usage accounting', () => {
  it('accounts for generation + a single validation when the draft passes immediately', async () => {
    const provider = new FakeModelProvider([
      { text: 'Draft one.', usage: usage(100, 50), latencyMs: 200 },
      { text: PASSING_VALIDATION_JSON, usage: usage(80, 20), latencyMs: 150 },
    ]);

    const result = await runProductionSkill(input, makeUniformRoles(provider), config);

    expect(result.validation.pass).toBe(true);
    expect(result.revisionAttempts).toBe(0);
    expect(provider.callCount).toBe(2); // 1 generate + 1 validate
    expect(result.requestCount).toBe(2);
    expect(result.totalUsage).toEqual({
      inputTokens: 180,
      outputTokens: 70,
      totalTokens: 250,
      cachedInputTokens: 0,
      reasoningTokens: 0,
    });
    expect(result.totalLatencyMs).toBe(350);
  });

  it('includes the revision call and the revalidation call when one revision is required', async () => {
    const provider = new FakeModelProvider([
      { text: 'Draft one.', usage: usage(100, 50), latencyMs: 200 },
      { text: FAILING_VALIDATION_JSON, usage: usage(80, 20), latencyMs: 150 },
      { text: 'Draft two, revised.', usage: usage(120, 60), latencyMs: 220 },
      { text: PASSING_VALIDATION_JSON, usage: usage(85, 25), latencyMs: 160 },
    ]);

    const result = await runProductionSkill(input, makeUniformRoles(provider), config);

    expect(result.validation.pass).toBe(true);
    expect(result.revisionAttempts).toBe(1);
    expect(provider.callCount).toBe(4); // generate, validate, revise, revalidate
    expect(result.requestCount).toBe(4);
    expect(result.finalText).toBe('Draft two, revised.');

    const expectedInput = 100 + 80 + 120 + 85;
    const expectedOutput = 50 + 20 + 60 + 25;
    expect(result.totalUsage.inputTokens).toBe(expectedInput);
    expect(result.totalUsage.outputTokens).toBe(expectedOutput);
    expect(result.totalUsage.totalTokens).toBe(expectedInput + expectedOutput);
    expect(result.totalLatencyMs).toBe(200 + 150 + 220 + 160);
  });

  it('includes every validation call across multiple revision rounds', async () => {
    const provider = new FakeModelProvider([
      { text: 'Draft one.', usage: usage(100, 50), latencyMs: 100 },
      { text: FAILING_VALIDATION_JSON, usage: usage(10, 10), latencyMs: 100 },
      { text: 'Draft two.', usage: usage(100, 50), latencyMs: 100 },
      { text: FAILING_VALIDATION_JSON, usage: usage(10, 10), latencyMs: 100 },
      { text: 'Draft three.', usage: usage(100, 50), latencyMs: 100 },
      { text: PASSING_VALIDATION_JSON, usage: usage(10, 10), latencyMs: 100 },
    ]);

    const result = await runProductionSkill(input, makeUniformRoles(provider), config);

    expect(result.revisionAttempts).toBe(2);
    // 1 generate + 3 validate (initial + 2 revalidations) + 2 revise = 6 requests
    expect(provider.callCount).toBe(6);
    expect(result.requestCount).toBe(6);

    // Three validation calls occurred: assert each independently contributed its usage rather
    // than only the last one being counted.
    const expectedInput = 100 + 10 + 100 + 10 + 100 + 10;
    const expectedOutput = 50 + 10 + 50 + 10 + 50 + 10;
    expect(result.totalUsage.inputTokens).toBe(expectedInput);
    expect(result.totalUsage.outputTokens).toBe(expectedOutput);
    expect(result.totalLatencyMs).toBe(600);
  });

  it('caps revisions at maxRevisionAttempts and still returns aggregated usage for every call made', async () => {
    const limitedConfig: RuntimeConfig = { ...config, maxRevisionAttempts: 1 };
    const provider = new FakeModelProvider([
      { text: 'Draft one.', usage: usage(100, 50), latencyMs: 100 },
      { text: FAILING_VALIDATION_JSON, usage: usage(10, 10), latencyMs: 100 },
      { text: 'Draft two.', usage: usage(100, 50), latencyMs: 100 },
      { text: FAILING_VALIDATION_JSON, usage: usage(10, 10), latencyMs: 100 },
    ]);

    const result = await runProductionSkill(input, makeUniformRoles(provider), limitedConfig);

    expect(result.validation.pass).toBe(false);
    expect(result.revisionAttempts).toBe(1);
    expect(provider.callCount).toBe(4);
    expect(result.requestCount).toBe(4);
    expect(result.totalUsage.totalTokens).toBe(100 + 50 + 10 + 10 + 100 + 50 + 10 + 10);
  });

  it('sums correctly when some calls report no usage at all (never estimates)', async () => {
    const provider = new FakeModelProvider([
      { text: 'Draft one.' }, // no usage/latency reported by this call
      { text: PASSING_VALIDATION_JSON, usage: usage(80, 20), latencyMs: 150 },
    ]);

    const result = await runProductionSkill(input, makeUniformRoles(provider), config);

    // Missing usage contributes 0, not an estimate.
    expect(result.totalUsage.inputTokens).toBe(80);
    expect(result.totalUsage.outputTokens).toBe(20);
    // Latency should still surface as a real number (from the call that reported it) rather than
    // becoming undefined just because one call didn't report it.
    expect(result.totalLatencyMs).toBe(150);
  });

  it('aggregates reasoningTokens independently, without folding it into totalTokens', async () => {
    // Each call's own totalTokens is summed as reported (input+output, per the real provider's
    // convention); reasoningTokens is tracked as its own separate running total, not added on top
    // of totalTokens. A provider that ever reports both should not see totalTokens inflated here.
    const provider = new FakeModelProvider([
      { text: 'Draft one.', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, reasoningTokens: 40 } },
      {
        text: PASSING_VALIDATION_JSON,
        usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100, reasoningTokens: 10 },
      },
    ]);

    const result = await runProductionSkill(input, makeUniformRoles(provider), config);

    expect(result.totalUsage.totalTokens).toBe(250); // 150 + 100, unaffected by reasoning tokens
    expect(result.totalUsage.reasoningTokens).toBe(50); // 40 + 10, tracked on its own
  });

  it('leaves totalLatencyMs undefined when no call in the run ever reported latency', async () => {
    const provider = new FakeModelProvider([
      { text: 'Draft one.', usage: usage(100, 50) },
      { text: PASSING_VALIDATION_JSON, usage: usage(80, 20) },
    ]);

    const result = await runProductionSkill(input, makeUniformRoles(provider), config);

    expect(result.totalLatencyMs).toBeUndefined();
  });
});

describe('runProductionSkill per-role usage and cost accounting', () => {
  it('immediate success: attributes the one generation call to generator and the one validation call to validator', async () => {
    const provider = new FakeModelProvider([
      { text: 'Draft one.', ...usageWithCost(100, 50, 0.01), latencyMs: 200 },
      { text: PASSING_VALIDATION_JSON, ...usageWithCost(80, 20, 0.005), latencyMs: 150 },
    ]);

    const result = await runProductionSkill(input, makeUniformRoles(provider), config);

    expect(result.usageByRole.generator).toEqual({
      requestCount: 1,
      usage: usage(100, 50),
      latencyMs: 200,
      cost: 0.01,
    });
    expect(result.usageByRole.validator).toEqual({
      requestCount: 1,
      usage: usage(80, 20),
      latencyMs: 150,
      cost: 0.005,
    });
    expect(result.usageByRole.reviser).toEqual({ requestCount: 0, usage: {} });
    expect(result.totalCost).toBeCloseTo(0.015);
  });

  it('one revision: attributes the revision call to reviser and both validation calls to validator', async () => {
    const provider = new FakeModelProvider([
      { text: 'Draft one.', ...usageWithCost(100, 50, 0.01) },
      { text: FAILING_VALIDATION_JSON, ...usageWithCost(80, 20, 0.005) },
      { text: 'Draft two, revised.', ...usageWithCost(120, 60, 0.012) },
      { text: PASSING_VALIDATION_JSON, ...usageWithCost(85, 25, 0.006) },
    ]);

    const result = await runProductionSkill(input, makeUniformRoles(provider), config);

    expect(result.usageByRole.generator.requestCount).toBe(1);
    expect(result.usageByRole.reviser).toEqual({
      requestCount: 1,
      usage: usage(120, 60),
      latencyMs: undefined,
      cost: 0.012,
    });
    expect(result.usageByRole.validator.requestCount).toBe(2);
    expect(result.usageByRole.validator.usage).toEqual(usage(80 + 85, 20 + 25));
    expect(result.usageByRole.validator.cost).toBeCloseTo(0.005 + 0.006);
    expect(result.totalCost).toBeCloseTo(0.01 + 0.005 + 0.012 + 0.006);
  });

  it('repeated validation: sums every validation round into a single validator total', async () => {
    const provider = new FakeModelProvider([
      { text: 'Draft one.', ...usageWithCost(100, 50, 0.01) },
      { text: FAILING_VALIDATION_JSON, ...usageWithCost(10, 10, 0.001) },
      { text: 'Draft two.', ...usageWithCost(100, 50, 0.01) },
      { text: FAILING_VALIDATION_JSON, ...usageWithCost(10, 10, 0.001) },
      { text: 'Draft three.', ...usageWithCost(100, 50, 0.01) },
      { text: PASSING_VALIDATION_JSON, ...usageWithCost(10, 10, 0.001) },
    ]);

    const result = await runProductionSkill(input, makeUniformRoles(provider), config);

    expect(result.usageByRole.validator.requestCount).toBe(3);
    expect(result.usageByRole.validator.usage).toEqual(usage(30, 30));
    expect(result.usageByRole.validator.cost).toBeCloseTo(0.003);
    expect(result.usageByRole.reviser.requestCount).toBe(2);
    expect(result.usageByRole.reviser.usage).toEqual(usage(200, 100));
  });

  it('exhausted revisions: still attributes every call made before the cap stopped the loop', async () => {
    const limitedConfig: RuntimeConfig = { ...config, maxRevisionAttempts: 1 };
    const provider = new FakeModelProvider([
      { text: 'Draft one.', ...usageWithCost(100, 50, 0.01) },
      { text: FAILING_VALIDATION_JSON, ...usageWithCost(10, 10, 0.001) },
      { text: 'Draft two.', ...usageWithCost(100, 50, 0.01) },
      { text: FAILING_VALIDATION_JSON, ...usageWithCost(10, 10, 0.001) },
    ]);

    const result = await runProductionSkill(input, makeUniformRoles(provider), limitedConfig);

    expect(result.validation.pass).toBe(false);
    expect(result.usageByRole.generator.requestCount).toBe(1);
    expect(result.usageByRole.reviser.requestCount).toBe(1);
    expect(result.usageByRole.validator.requestCount).toBe(2);
    expect(result.totalCost).toBeCloseTo(0.01 + 0.001 + 0.01 + 0.001);
  });

  it('exact totals: leaves totalCost and a role\'s cost undefined when nothing in that scope reported one', async () => {
    const provider = new FakeModelProvider([
      { text: 'Draft one.', usage: usage(100, 50) }, // no cost reported
      { text: PASSING_VALIDATION_JSON, usage: usage(80, 20) }, // no cost reported
    ]);

    const result = await runProductionSkill(input, makeUniformRoles(provider), config);

    expect(result.usageByRole.generator.cost).toBeUndefined();
    expect(result.usageByRole.validator.cost).toBeUndefined();
    expect(result.totalCost).toBeUndefined();
  });

  it('exact totals: sums known costs and treats a call with no cost as contributing zero, not as unknown', async () => {
    const provider = new FakeModelProvider([
      { text: 'Draft one.', ...usageWithCost(100, 50, 0.02) },
      { text: PASSING_VALIDATION_JSON, usage: usage(80, 20) }, // usage but no cost
    ]);

    const result = await runProductionSkill(input, makeUniformRoles(provider), config);

    expect(result.usageByRole.generator.cost).toBe(0.02);
    expect(result.usageByRole.validator.cost).toBeUndefined();
    expect(result.totalCost).toBe(0.02);
  });
});
