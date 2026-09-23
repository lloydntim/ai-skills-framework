import type { PairwiseResult } from './types';

/**
 * Cheap position-bias check: does the judge favor whichever candidate happens to land in display
 * slot A, independent of which canonical variant that is? This is raw counts only — no
 * significance testing, no persistence, no dashboard — just enough to flag "the judge picks A
 * suspiciously often" for a human to look into.
 */
export interface PositionBiasSummary {
  /** Non-tie decisions where the display-slot metadata needed to measure bias was present. */
  decidedCount: number;
  slotAWins: number;
  slotBWins: number;
  /** slotAWins / decidedCount, or null when there is nothing decided to measure yet. */
  slotAWinRate: number | null;
  /** Results missing the display-slot metadata: excluded, not guessed at. */
  skippedUnreconstructable: number;
}

/**
 * Never reinterprets a legacy or partial result: a record missing any one of
 * displayedWinner/displayedAsA/displayedAsB is excluded outright rather than reconstructed from
 * the unblinded `winner` field, which would silently conflate the two different A/B alphabets
 * (display slot vs canonical variant) and could misattribute bias to the wrong slot.
 */
export function summarizePositionBias(results: PairwiseResult[]): PositionBiasSummary {
  let slotAWins = 0;
  let slotBWins = 0;
  let decidedCount = 0;
  let skippedUnreconstructable = 0;

  for (const r of results) {
    if (r.displayedWinner === undefined || r.displayedAsA === undefined || r.displayedAsB === undefined) {
      skippedUnreconstructable += 1;
      continue;
    }
    if (r.displayedWinner === 'tie') continue;
    decidedCount += 1;
    if (r.displayedWinner === 'A') slotAWins += 1;
    else slotBWins += 1;
  }

  return {
    decidedCount,
    slotAWins,
    slotBWins,
    slotAWinRate: decidedCount > 0 ? slotAWins / decidedCount : null,
    skippedUnreconstructable,
  };
}
