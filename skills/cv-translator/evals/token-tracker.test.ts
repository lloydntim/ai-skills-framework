import { describe, expect, it } from 'vitest';
import { aggregateTokensByVariant, qualityPerThousandTokens, tokenDeltaPercent } from './token-tracker';
import type { CaseResult, QualityScore, Variant } from './types';

function quality(): QualityScore {
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
  };
}

function result(variant: Variant, caseId: string, usage?: { inputTokens: number; outputTokens: number; totalTokens: number }): CaseResult {
  return {
    caseId,
    category: 'translation',
    variant,
    output: { variant, caseId, text: 'output', usage },
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
  };
}

describe('aggregateTokensByVariant', () => {
  it('groups by variant and averages/sums token usage independently per group', () => {
    const results: CaseResult[] = [
      result('A', 'c1', { inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
      result('A', 'c2', { inputTokens: 200, outputTokens: 100, totalTokens: 300 }),
      result('B', 'c1', { inputTokens: 40, outputTokens: 10, totalTokens: 50 }),
    ];

    const agg = aggregateTokensByVariant(results);
    const a = agg.find((v) => v.variant === 'A')!;
    const b = agg.find((v) => v.variant === 'B')!;

    expect(a.avgInputTokens).toBe(150);
    expect(a.avgOutputTokens).toBe(75);
    expect(a.avgTotalTokens).toBe(225);
    expect(a.totalTokens).toBe(450);
    expect(b.totalTokens).toBe(50);
  });

  it('treats a result with no usage at all as contributing zero, not as excluded', () => {
    const results: CaseResult[] = [result('A', 'c1', { inputTokens: 100, outputTokens: 50, totalTokens: 150 }), result('A', 'c2')];

    const agg = aggregateTokensByVariant(results);
    const a = agg.find((v) => v.variant === 'A')!;

    expect(a.avgTotalTokens).toBe(75); // (150 + 0) / 2, not 150 / 1
  });

  it('returns one entry per distinct variant present, in first-seen order', () => {
    const results: CaseResult[] = [result('B', 'c1'), result('A', 'c1'), result('B', 'c2')];
    expect(aggregateTokensByVariant(results).map((v) => v.variant)).toEqual(['B', 'A']);
  });

  it('returns an empty array for no results', () => {
    expect(aggregateTokensByVariant([])).toEqual([]);
  });
});

describe('tokenDeltaPercent', () => {
  it('computes a positive percentage increase', () => {
    expect(tokenDeltaPercent(100, 150)).toBeCloseTo(50, 10);
  });

  it('computes a negative percentage decrease', () => {
    expect(tokenDeltaPercent(200, 100)).toBeCloseTo(-50, 10);
  });

  it('returns 0 rather than dividing by zero when the baseline used no tokens', () => {
    expect(tokenDeltaPercent(0, 100)).toBe(0);
  });

  it('returns 0 for two equal values', () => {
    expect(tokenDeltaPercent(100, 100)).toBe(0);
  });
});

describe('qualityPerThousandTokens', () => {
  it('divides the quality gain by the token increase in thousands', () => {
    expect(qualityPerThousandTokens(1, 500)).toBeCloseTo(2, 10);
  });

  it('returns 0 rather than dividing by zero when there was no token increase', () => {
    expect(qualityPerThousandTokens(1, 0)).toBe(0);
  });

  it('is negative when quality dropped while tokens increased', () => {
    expect(qualityPerThousandTokens(-0.5, 1000)).toBeCloseTo(-0.5, 10);
  });
});
