import type { PairwiseAggregate, PairwiseResult, Variant } from './types';

/**
 * Wins/losses/ties per variant, computed only from each result's canonical, already-unblinded
 * fields (variantA, variantB, winner) — never from the display-slot metadata. Those canonical
 * fields are written once by evaluatePairwise and never subject to the "can this be reconstructed"
 * question that displayedWinner/displayedAsA/displayedAsB are (see position-bias.ts), so every
 * result can always be counted here regardless of whether its display mapping is reconstructable.
 */
export function aggregatePairwiseWins(results: PairwiseResult[]): PairwiseAggregate[] {
  const byVariant = new Map<Variant, { wins: number; losses: number; ties: number; comparisons: number }>();

  const bump = (variant: Variant, key: 'wins' | 'losses' | 'ties') => {
    const entry = byVariant.get(variant) ?? { wins: 0, losses: 0, ties: 0, comparisons: 0 };
    entry[key] += 1;
    entry.comparisons += 1;
    byVariant.set(variant, entry);
  };

  for (const r of results) {
    if (r.winner === 'tie') {
      bump(r.variantA, 'ties');
      bump(r.variantB, 'ties');
    } else if (r.winner === 'A') {
      bump(r.variantA, 'wins');
      bump(r.variantB, 'losses');
    } else {
      bump(r.variantB, 'wins');
      bump(r.variantA, 'losses');
    }
  }

  return [...byVariant.entries()].map(([variant, counts]) => ({ variant, ...counts }));
}
