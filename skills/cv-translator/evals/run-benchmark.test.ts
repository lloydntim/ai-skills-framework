import { describe, expect, it } from 'vitest';
import { InstrumentingProvider, RequestLog } from '@skills/framework/provider/instrumentation';
import { QueuedResponseProvider } from '@skills/framework/testing/queued-response-provider';
import { makeUniformRoles } from '@skills/framework/testing/uniform-roles';
import type { RuntimeConfig } from '../src/runtime/types';
import { runBenchmark } from './run-benchmark';
import type { EvalCase } from './types';

const config: RuntimeConfig = {
  temperature: 0.3,
  maxRevisionAttempts: 5,
  maxLengthRatio: 100,
  forbiddenCharacters: ['—', '–'],
  thresholds: { faithfulness: 5, unsupportedClaims: 0, naturalness: 4, cvQuality: 4, terminology: 4 },
};

const checks = { maxLengthRatio: 100, forbiddenCharacters: ['—', '–'], evaluatorTemperature: 0 };

const cases: EvalCase[] = [
  {
    id: 'case-1',
    category: 'faithfulness',
    sourceLanguage: 'de',
    targetLanguage: 'en',
    input: 'Kurzer Lebenslaufabschnitt eins.',
    instructions: 'Translate faithfully.',
  },
  {
    id: 'case-2',
    category: 'faithfulness',
    sourceLanguage: 'de',
    targetLanguage: 'en',
    input: 'Kurzer Lebenslaufabschnitt zwei.',
    instructions: 'Translate faithfully.',
  },
];

const EVALUATOR_JSON = JSON.stringify({
  faithfulness: 5,
  naturalness: 5,
  cvQuality: 5,
  terminology: 5,
  conciseness: 5,
  overall: 5,
  justification: 'fine',
  problems: [],
  missingExpectedFacts: [],
  unsupportedClaims: [],
  seniorityInflationNotes: [],
  terminologyProblems: [],
  naturalnessProblems: [],
});

const PAIRWISE_JSON = JSON.stringify({
  naturalness: 'A',
  faithfulness: 'A',
  cvProfessionalism: 'A',
  conciseness: 'A',
  winner: 'A',
  justification: 'A is fine',
});

/**
 * For variant A/B (single generate call) each case consumes: 1 generate + 1 evaluator call, and
 * (when pairwise runs) 1 pairwise call at the end of that case's two variants.
 */
describe('runBenchmark', () => {
  it('produces one CaseResult per case per variant, tagged with the case id, category and a content hash', async () => {
    const provider = new QueuedResponseProvider([
      { text: 'draft A1' }, { text: EVALUATOR_JSON }, // case-1 / A
      { text: 'draft B1' }, { text: EVALUATOR_JSON }, // case-1 / B
      { text: PAIRWISE_JSON }, // case-1 pairwise
      { text: 'draft A2' }, { text: EVALUATOR_JSON }, // case-2 / A
      { text: 'draft B2' }, { text: EVALUATOR_JSON }, // case-2 / B
      { text: PAIRWISE_JSON }, // case-2 pairwise
    ]);

    const { caseResults } = await runBenchmark({
      cases,
      variants: ['A', 'B'],
      roles: makeUniformRoles(provider),
      runtimeConfig: config,
      checks,
    });

    expect(caseResults).toHaveLength(4);
    expect(caseResults.map((r) => `${r.caseId}/${r.variant}`)).toEqual(['case-1/A', 'case-1/B', 'case-2/A', 'case-2/B']);
    expect(caseResults.every((r) => r.category === 'faithfulness')).toBe(true);
    expect(caseResults.every((r) => typeof r.caseHash === 'string' && r.caseHash.length > 0)).toBe(true);
  });

  it('runs the pairwise judge exactly once per case when exactly two variants are compared', async () => {
    const provider = new QueuedResponseProvider([
      { text: 'draft A1' }, { text: EVALUATOR_JSON },
      { text: 'draft B1' }, { text: EVALUATOR_JSON },
      { text: PAIRWISE_JSON },
    ]);

    const { pairwiseResults } = await runBenchmark({
      cases: [cases[0]],
      variants: ['A', 'B'],
      roles: makeUniformRoles(provider),
      runtimeConfig: config,
      checks,
    });

    expect(pairwiseResults).toHaveLength(1);
    expect(pairwiseResults[0].caseId).toBe('case-1');
  });

  it('skips the pairwise judge for a single-variant run, calling the provider only for generate + evaluate', async () => {
    const provider = new QueuedResponseProvider([{ text: 'draft A1' }, { text: EVALUATOR_JSON }]);

    const { pairwiseResults } = await runBenchmark({
      cases: [cases[0]],
      variants: ['A'],
      roles: makeUniformRoles(provider),
      runtimeConfig: config,
      checks,
    });

    expect(pairwiseResults).toEqual([]);
    expect(provider.callCount).toBe(2);
  });

  it('skips the pairwise judge when explicitly disabled, even with exactly two variants', async () => {
    const provider = new QueuedResponseProvider([
      { text: 'draft A1' }, { text: EVALUATOR_JSON },
      { text: 'draft B1' }, { text: EVALUATOR_JSON },
    ]);

    const { pairwiseResults } = await runBenchmark({
      cases: [cases[0]],
      variants: ['A', 'B'],
      roles: makeUniformRoles(provider),
      runtimeConfig: config,
      checks,
      pairwise: false,
    });

    expect(pairwiseResults).toEqual([]);
    expect(provider.callCount).toBe(4);
  });

  it('attributes every instrumented request made for a case to that case id, in order', async () => {
    const inner = new QueuedResponseProvider([
      { text: 'draft A1' }, { text: EVALUATOR_JSON },
      { text: 'draft A2' }, { text: EVALUATOR_JSON },
    ]);
    const requestLog = new RequestLog();
    const instrumented = new InstrumentingProvider(inner, requestLog);
    const roles = makeUniformRoles(instrumented);

    await runBenchmark({ cases, variants: ['A'], roles, runtimeConfig: config, checks, requestLog });

    expect(requestLog.entries.map((e) => e.caseId)).toEqual(['case-1', 'case-1', 'case-2', 'case-2']);
  });

  it('leaves the request log pointed at no case once the whole benchmark finishes', async () => {
    const inner = new QueuedResponseProvider([{ text: 'draft A1' }, { text: EVALUATOR_JSON }]);
    const requestLog = new RequestLog();
    const instrumented = new InstrumentingProvider(inner, requestLog);
    const roles = makeUniformRoles(instrumented);

    await runBenchmark({ cases: [cases[0]], variants: ['A'], roles, runtimeConfig: config, checks, requestLog });

    // A request made after the benchmark finishes (e.g. a report-building call) must not be
    // mistakenly attributed to whichever case happened to run last.
    requestLog.record({ requestType: 'unclassified' });
    expect(requestLog.entries[requestLog.entries.length - 1].caseId).toBeUndefined();
  });

  it('runs every case even when no requestLog is supplied', async () => {
    const provider = new QueuedResponseProvider([
      { text: 'draft A1' }, { text: EVALUATOR_JSON },
      { text: 'draft A2' }, { text: EVALUATOR_JSON },
    ]);

    const { caseResults } = await runBenchmark({
      cases,
      variants: ['A'],
      roles: makeUniformRoles(provider),
      runtimeConfig: config,
      checks,
    });

    expect(caseResults).toHaveLength(2);
  });

  it('runs the production pipeline (variant C) as one of the compared variants', async () => {
    const passingValidation = JSON.stringify({
      faithfulness: 5, naturalness: 5, cvQuality: 5, terminology: 5, unsupportedClaims: [], hardGuardrailFailures: [],
    });
    const provider = new QueuedResponseProvider([
      { text: 'draft C1' }, { text: passingValidation }, // variant C: generate + validate
      { text: EVALUATOR_JSON }, // evaluator for C
    ]);

    const { caseResults } = await runBenchmark({
      cases: [cases[0]],
      variants: ['C'],
      roles: makeUniformRoles(provider),
      runtimeConfig: config,
      checks,
    });

    expect(caseResults).toHaveLength(1);
    expect(caseResults[0].output.text).toBe('draft C1');
    expect(caseResults[0].output.revisionAttempts).toBe(0);
  });

  it('returns no results at all for an empty case list', async () => {
    const provider = new QueuedResponseProvider([]);

    const { caseResults, pairwiseResults } = await runBenchmark({
      cases: [],
      variants: ['A', 'B'],
      roles: makeUniformRoles(provider),
      runtimeConfig: config,
      checks,
    });

    expect(caseResults).toEqual([]);
    expect(pairwiseResults).toEqual([]);
    expect(provider.callCount).toBe(0);
  });
});
