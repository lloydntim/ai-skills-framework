import { describe, expect, it } from 'vitest';
import { summarizePositionBias } from './position-bias';
import type { PairwiseResult } from './types';

function pairwise(overrides: Partial<PairwiseResult>): PairwiseResult {
  return {
    caseId: 'case-1',
    variantA: 'A',
    variantB: 'B',
    winner: 'A',
    naturalness: 'A',
    faithfulness: 'A',
    cvProfessionalism: 'A',
    conciseness: 'A',
    justification: 'irrelevant for this test',
    ...overrides,
  };
}

describe('summarizePositionBias', () => {
  it('counts slot A and slot B wins from displayedWinner, not the canonical winner', () => {
    const results: PairwiseResult[] = [
      pairwise({ displayedWinner: 'A', displayedAsA: 'A', displayedAsB: 'B' }),
      pairwise({ displayedWinner: 'A', displayedAsA: 'B', displayedAsB: 'A' }),
      pairwise({ displayedWinner: 'B', displayedAsA: 'A', displayedAsB: 'B' }),
    ];

    const summary = summarizePositionBias(results);

    expect(summary.slotAWins).toBe(2);
    expect(summary.slotBWins).toBe(1);
    expect(summary.decidedCount).toBe(3);
    expect(summary.slotAWinRate).toBeCloseTo(2 / 3);
  });

  it('excludes ties from the decided count and rate', () => {
    const results: PairwiseResult[] = [
      pairwise({ displayedWinner: 'A', displayedAsA: 'A', displayedAsB: 'B' }),
      pairwise({ displayedWinner: 'tie', displayedAsA: 'A', displayedAsB: 'B' }),
    ];

    const summary = summarizePositionBias(results);

    expect(summary.decidedCount).toBe(1);
    expect(summary.slotAWinRate).toBe(1);
  });

  it('excludes and separately counts older results that predate displayedWinner, rather than guessing', () => {
    const oldResult = pairwise({});
    delete (oldResult as Partial<PairwiseResult>).displayedWinner;
    delete (oldResult as Partial<PairwiseResult>).displayedAsA;
    delete (oldResult as Partial<PairwiseResult>).displayedAsB;

    const newResult = pairwise({ displayedWinner: 'A', displayedAsA: 'A', displayedAsB: 'B' });

    const summary = summarizePositionBias([oldResult, newResult]);

    expect(summary.skippedUnreconstructable).toBe(1);
    expect(summary.decidedCount).toBe(1);
    expect(summary.slotAWins).toBe(1);
  });

  it('excludes a partial record (displayedWinner present, display mapping missing) as unreconstructable', () => {
    // All three fields are always written together in practice; this guards against a record that
    // is otherwise incomplete (e.g. hand-edited, or from some future partial-write bug) being
    // treated as reconstructable just because one of the three fields happens to be present.
    const partial = pairwise({ displayedWinner: 'A' });
    delete (partial as Partial<PairwiseResult>).displayedAsA;
    delete (partial as Partial<PairwiseResult>).displayedAsB;

    const summary = summarizePositionBias([partial]);

    expect(summary.skippedUnreconstructable).toBe(1);
    expect(summary.decidedCount).toBe(0);
  });

  it('reports a null rate, not a divide-by-zero artifact, when nothing is decided', () => {
    expect(summarizePositionBias([]).slotAWinRate).toBeNull();

    const onlyOld = pairwise({});
    delete (onlyOld as Partial<PairwiseResult>).displayedWinner;
    expect(summarizePositionBias([onlyOld]).slotAWinRate).toBeNull();

    const onlyTies = pairwise({ displayedWinner: 'tie', displayedAsA: 'A', displayedAsB: 'B' });
    expect(summarizePositionBias([onlyTies]).slotAWinRate).toBeNull();
  });
});
