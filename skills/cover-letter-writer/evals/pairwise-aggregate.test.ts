import { describe, expect, it } from 'vitest';
import { aggregatePairwiseWins } from './pairwise-aggregate';
import type { PairwiseResult } from './types';

function pairwise(overrides: Partial<PairwiseResult>): PairwiseResult {
  return {
    caseId: 'case-1',
    variantA: 'B',
    variantB: 'C',
    winner: 'A',
    factualGrounding: 'A',
    jobRelevance: 'A',
    professionalTone: 'A',
    naturalness: 'A',
    justification: 'irrelevant for this test',
    ...overrides,
  };
}

describe('aggregatePairwiseWins', () => {
  it('counts a win for variantA and a loss for variantB when the canonical winner is "A"', () => {
    const results = [pairwise({ variantA: 'B', variantB: 'C', winner: 'A' })];

    const aggregates = aggregatePairwiseWins(results);

    const b = aggregates.find((a) => a.variant === 'B')!;
    const c = aggregates.find((a) => a.variant === 'C')!;
    expect(b).toMatchObject({ wins: 1, losses: 0, ties: 0, comparisons: 1 });
    expect(c).toMatchObject({ wins: 0, losses: 1, ties: 0, comparisons: 1 });
  });

  it('counts a win for variantB and a loss for variantA when the canonical winner is "B"', () => {
    const results = [pairwise({ variantA: 'B', variantB: 'C', winner: 'B' })];

    const aggregates = aggregatePairwiseWins(results);

    const b = aggregates.find((a) => a.variant === 'B')!;
    const c = aggregates.find((a) => a.variant === 'C')!;
    expect(b).toMatchObject({ wins: 0, losses: 1 });
    expect(c).toMatchObject({ wins: 1, losses: 0 });
  });

  it('counts a tie for both variants', () => {
    const results = [pairwise({ variantA: 'B', variantB: 'C', winner: 'tie' })];

    const aggregates = aggregatePairwiseWins(results);

    const b = aggregates.find((a) => a.variant === 'B')!;
    const c = aggregates.find((a) => a.variant === 'C')!;
    expect(b).toMatchObject({ wins: 0, losses: 0, ties: 1 });
    expect(c).toMatchObject({ wins: 0, losses: 0, ties: 1 });
  });

  it('accumulates across multiple cases and multiple pairings, using only canonical fields', () => {
    const results = [
      pairwise({ caseId: 'c1', variantA: 'B', variantB: 'C', winner: 'A' }), // B wins
      pairwise({ caseId: 'c2', variantA: 'B', variantB: 'C', winner: 'B' }), // C wins
      pairwise({ caseId: 'c3', variantA: 'B', variantB: 'C', winner: 'tie' }),
      // Uses the display-slot fields in a way that would flip the result if aggregation ever read
      // them instead of the canonical winner/variantA/variantB — it must not.
      pairwise({
        caseId: 'c4',
        variantA: 'B',
        variantB: 'C',
        winner: 'A',
        displayedWinner: 'B',
        displayedAsA: 'C',
        displayedAsB: 'B',
      }),
    ];

    const aggregates = aggregatePairwiseWins(results);
    const b = aggregates.find((a) => a.variant === 'B')!;
    const c = aggregates.find((a) => a.variant === 'C')!;

    expect(b).toMatchObject({ wins: 2, losses: 1, ties: 1, comparisons: 4 });
    expect(c).toMatchObject({ wins: 1, losses: 2, ties: 1, comparisons: 4 });
  });

  it('returns an empty array for no results', () => {
    expect(aggregatePairwiseWins([])).toEqual([]);
  });
});
