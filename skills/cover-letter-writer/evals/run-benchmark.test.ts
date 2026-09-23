import { describe, expect, it } from 'vitest';
import { LlmResponseValidationError } from '@skills/framework/llm-json-response';
import { FakeModelProvider } from '../src/test-support/fake-model-provider';
import { makeUniformRoles } from '@skills/framework/testing/uniform-roles';
import { hashCase } from '@skills/framework/evals/case-hash';
import { runBenchmark } from './run-benchmark';
import type { EvalCase } from './types';
import type { RuntimeConfig } from '../src/runtime/types';

function judgeJson(overrides: Partial<{
  factualGrounding: number;
  jobRelevance: number;
  professionalTone: number;
  specificity: number;
  naturalness: number;
  conciseness: number;
  overall: number;
}> = {}): string {
  return JSON.stringify({
    factualGrounding: 5,
    jobRelevance: 5,
    professionalTone: 5,
    specificity: 5,
    naturalness: 5,
    conciseness: 5,
    overall: 5,
    justification: 'Solid letter.',
    problems: [],
    missingExpectedFacts: [],
    unsupportedClaims: [],
    ownershipInflationNotes: [],
    unofferedBenefitNotes: [],
    ...overrides,
  });
}

function pairwiseJudgeJson(overrides: Partial<{
  factualGrounding: 'A' | 'B' | 'tie';
  jobRelevance: 'A' | 'B' | 'tie';
  professionalTone: 'A' | 'B' | 'tie';
  naturalness: 'A' | 'B' | 'tie';
  winner: 'A' | 'B' | 'tie';
}> = {}): string {
  return JSON.stringify({
    factualGrounding: 'A',
    jobRelevance: 'A',
    professionalTone: 'A',
    naturalness: 'A',
    winner: 'A',
    justification: 'A is stronger.',
    ...overrides,
  });
}

const PASSING_EVALUATOR_JSON = judgeJson();

const runtimeConfig: RuntimeConfig = {
  temperature: 0.3,
  maxRevisionAttempts: 2,
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
  id: 'benchmark-run-001',
  category: 'strong-match',
  language: 'en',
  cvText: 'NORTHWIND London | Frontend Architect. Stack: React, TypeScript.',
  roleDescription: 'Senior Frontend Engineer at Acme. React, TypeScript.',
  instructions: 'Write a tailored cover letter.',
};

describe('runBenchmark', () => {
  it('runs every variant over every case and returns one CaseResult per (case, variant) pair', async () => {
    // Variant C goes through the real production pipeline before the evaluator ever sees its
    // output, so its own semantic-validator call uses that pipeline's judge shape
    // (hardGuardrailFailures, no conciseness) — distinct from the offline evaluator's shape used
    // for every variant's final score, including C's.
    const validatorJson = JSON.stringify({
      factualGrounding: 5,
      jobRelevance: 5,
      professionalTone: 5,
      specificity: 5,
      naturalness: 5,
      overall: 5,
      hardGuardrailFailures: [],
    });
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Variant A draft.' }) // A: generate
      .queueResponse({ text: PASSING_EVALUATOR_JSON }) // A: evaluator
      .queueResponse({ text: 'Variant B draft.' }) // B: generate
      .queueResponse({ text: PASSING_EVALUATOR_JSON }) // B: evaluator
      .queueResponse({ text: 'Variant C draft.' }) // C: generate
      .queueResponse({ text: validatorJson }) // C: production semantic validation
      .queueResponse({ text: PASSING_EVALUATOR_JSON }); // C: evaluator

    const { caseResults, pairwiseResults } = await runBenchmark({
      cases: [kase],
      variants: ['A', 'B', 'C'],
      roles: makeUniformRoles(provider),
      runtimeConfig,
      evaluatorConfig: { temperature: 0 },
    });

    expect(caseResults).toHaveLength(3);
    expect(caseResults.map((r) => r.variant)).toEqual(['A', 'B', 'C']);
    expect(caseResults.every((r) => r.caseId === kase.id)).toBe(true);
    expect(caseResults.every((r) => r.category === kase.category)).toBe(true);
    expect(caseResults.every((r) => r.caseHash === hashCase(kase))).toBe(true);
    expect(pairwiseResults).toEqual([]);
  });

  it('reuses the production deterministic checks — a hard failure in the output is caught identically', async () => {
    // The em dash is a hard deterministic failure (DEFAULT_FORBIDDEN_CHARACTERS) — proves
    // run-benchmark calls the same runDeterministicChecks the production runtime uses, not a
    // second, looser copy.
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Draft one — with a forbidden dash.' }) // A: generate
      .queueResponse({ text: PASSING_EVALUATOR_JSON }); // A: evaluator

    const { caseResults } = await runBenchmark({
      cases: [kase],
      variants: ['A'],
      roles: makeUniformRoles(provider),
      runtimeConfig,
      evaluatorConfig: { temperature: 0 },
    });

    expect(caseResults[0].deterministic.pass).toBe(false);
    expect(caseResults[0].deterministic.matchedForbiddenCharacters).toContain('—');
  });

  it('carries the evaluator usage/latency/cost separately from the variant output usage', async () => {
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Variant A draft.', usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 }, latencyMs: 100, cost: 0.001 })
      .queueResponse({ text: PASSING_EVALUATOR_JSON, usage: { inputTokens: 40, outputTokens: 30, totalTokens: 70 }, latencyMs: 90, cost: 0.0009 });

    const { caseResults } = await runBenchmark({
      cases: [kase],
      variants: ['A'],
      roles: makeUniformRoles(provider),
      runtimeConfig,
      evaluatorConfig: { temperature: 0 },
    });

    expect(caseResults[0].output.usage?.inputTokens).toBe(50);
    expect(caseResults[0].evaluatorUsage?.inputTokens).toBe(40);
    expect(caseResults[0].evaluatorLatencyMs).toBe(90);
    expect(caseResults[0].evaluatorCost).toBeCloseTo(0.0009, 10);
  });

  it('propagates a malformed evaluator response as an explicit error rather than defaulting scores', async () => {
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Variant A draft.' })
      .queueResponse({ text: '{ "factualGrounding": "not a number" }' });

    await expect(
      runBenchmark({
        cases: [kase],
        variants: ['A'],
        roles: makeUniformRoles(provider),
        runtimeConfig,
        evaluatorConfig: { temperature: 0 },
      })
    ).rejects.toThrow(LlmResponseValidationError);
  });

  it('gives each case its own caseHash, distinguishing an edited case from an unrelated one', async () => {
    const otherCase: EvalCase = { ...kase, id: 'benchmark-run-002', roleDescription: 'A completely different advert.' };
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Draft for case one.' })
      .queueResponse({ text: PASSING_EVALUATOR_JSON })
      .queueResponse({ text: 'Draft for case two.' })
      .queueResponse({ text: PASSING_EVALUATOR_JSON });

    const { caseResults } = await runBenchmark({
      cases: [kase, otherCase],
      variants: ['A'],
      roles: makeUniformRoles(provider),
      runtimeConfig,
      evaluatorConfig: { temperature: 0 },
    });

    expect(caseResults[0].caseHash).not.toBe(caseResults[1].caseHash);
  });

  describe('pairwise option', () => {
    it('runs a blind pairwise comparison between the two requested variants for every case', async () => {
      const provider = new FakeModelProvider()
        .queueResponse({ text: 'Variant A draft.' }) // A: generate
        .queueResponse({ text: PASSING_EVALUATOR_JSON }) // A: evaluator
        .queueResponse({ text: 'Variant B draft.' }) // B: generate
        .queueResponse({ text: PASSING_EVALUATOR_JSON }) // B: evaluator
        .queueResponse({ text: pairwiseJudgeJson() }); // pairwise judge

      const { pairwiseResults } = await runBenchmark({
        cases: [kase],
        variants: ['A', 'B'],
        roles: makeUniformRoles(provider),
        runtimeConfig,
        evaluatorConfig: { temperature: 0 },
        pairwise: { variants: ['A', 'B'], temperature: 0, random: () => 0.9 }, // >= 0.5: no swap
      });

      expect(pairwiseResults).toHaveLength(1);
      expect(pairwiseResults[0].caseId).toBe(kase.id);
      expect(pairwiseResults[0].variantA).toBe('A');
      expect(pairwiseResults[0].variantB).toBe('B');
      expect(pairwiseResults[0].winner).toBe('A');
    });

    it('refuses when a requested pairwise variant is not in this run\'s variants', async () => {
      const provider = new FakeModelProvider();

      await expect(
        runBenchmark({
          cases: [kase],
          variants: ['A'],
          roles: makeUniformRoles(provider),
          runtimeConfig,
          evaluatorConfig: { temperature: 0 },
          pairwise: { variants: ['A', 'C'], temperature: 0 },
        })
      ).rejects.toThrow(/not in this run's variants/);
      expect(provider.callCount).toBe(0);
    });
  });
});
