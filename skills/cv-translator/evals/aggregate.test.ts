import { describe, expect, it } from 'vitest';
import { aggregateForVariant } from './aggregate';
import type { CaseResult, QualityScore, Variant } from './types';

function quality(overrides: Partial<QualityScore> = {}): QualityScore {
  return {
    faithfulness: 4,
    naturalness: 4,
    cvQuality: 4,
    terminology: 4,
    conciseness: 4,
    overall: 4,
    justification: '',
    problems: [],
    missingExpectedFacts: [],
    unsupportedClaims: [],
    seniorityInflationNotes: [],
    terminologyProblems: [],
    naturalnessProblems: [],
    ...overrides,
  };
}

function result(variant: Variant, overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    caseId: 'case-1',
    category: 'translation',
    variant,
    output: { variant, caseId: 'case-1', text: 'output' },
    deterministic: {
      pass: true,
      missingExactStrings: [],
      missingTerms: [],
      matchedForbiddenClaims: [],
      matchedForbiddenCharacters: [],
      lengthExceeded: false,
      boldMarkerMismatch: false,
      paragraphBreakMismatch: false,
      repeatedEntryOpeners: [],
    },
    quality: quality(),
    ...overrides,
  };
}

describe('aggregateForVariant', () => {
  it('averages every score dimension over only the results for the requested variant', () => {
    const results: CaseResult[] = [
      result('A', { quality: quality({ overall: 3, faithfulness: 2 }) }),
      result('A', { quality: quality({ overall: 5, faithfulness: 4 }) }),
      result('B', { quality: quality({ overall: 1, faithfulness: 1 }) }),
    ];

    const agg = aggregateForVariant('A', results);

    expect(agg.variant).toBe('A');
    expect(agg.cases).toBe(2);
    expect(agg.avgOverall).toBe(4);
    expect(agg.avgFaithfulness).toBe(3);
  });

  it('averages tokens and latency, treating a missing value as zero rather than excluding the case', () => {
    const results: CaseResult[] = [
      result('A', { output: { variant: 'A', caseId: 'c1', text: 'x', usage: { totalTokens: 200 }, latencyMs: 400 } }),
      result('A', { output: { variant: 'A', caseId: 'c2', text: 'x' } }), // no usage or latency at all
    ];

    const agg = aggregateForVariant('A', results);

    expect(agg.avgTokens).toBe(100);
    expect(agg.avgLatencyMs).toBe(200);
  });

  it('returns zeroed averages and zero cases for a variant with no results', () => {
    const agg = aggregateForVariant('C', [result('A'), result('B')]);

    expect(agg.cases).toBe(0);
    expect(agg.avgOverall).toBe(0);
    expect(agg.avgTokens).toBe(0);
    expect(agg.avgLatencyMs).toBe(0);
  });

  it('handles an empty result set for the whole run', () => {
    const agg = aggregateForVariant('A', []);
    expect(agg.cases).toBe(0);
    expect(agg.avgOverall).toBe(0);
  });
});
