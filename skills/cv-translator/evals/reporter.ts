import fs from 'node:fs';
import path from 'node:path';
import { summarizePositionBias } from './position-bias';
import type { AggregateScore, EvalRunResult, PairwiseResult } from './types';

export function formatTerminalReport(run: EvalRunResult): string {
  const lines: string[] = [];
  lines.push('CV SKILL EVALUATION');
  lines.push('===================');
  lines.push('');
  lines.push(`Cases: ${run.caseResults.length / run.variants.length}`);
  lines.push('');

  const byVariant = new Map(run.aggregates.map((a) => [a.variant, a]));
  lines.push(['Metric', ...run.variants].join('\t'));

  const metricRows: [string, keyof AggregateScore][] = [
    ['Naturalness', 'avgNaturalness'],
    ['Faithfulness', 'avgFaithfulness'],
    ['CV Quality', 'avgCvQuality'],
    ['Terminology', 'avgTerminology'],
    ['Conciseness', 'avgConciseness'],
    ['Overall', 'avgOverall'],
    ['Avg tokens', 'avgTokens'],
  ];

  for (const [label, key] of metricRows) {
    const values = run.variants.map((v) => {
      const agg = byVariant.get(v);
      const value = agg ? (agg[key] as number) : 0;
      return key === 'avgTokens' ? value.toFixed(0) : value.toFixed(2);
    });
    lines.push([label, ...values].join('\t'));
  }

  if (run.pairwiseResults.length > 0) {
    lines.push('');
    lines.push('Pairwise results:');
    for (const [variant, count] of countPairwiseWins(run.pairwiseResults).entries()) {
      lines.push(`${variant} wins: ${count}`);
    }

    const bias = summarizePositionBias(run.pairwiseResults);
    if (bias.slotAWinRate !== null) {
      const skippedNote = bias.skippedUnreconstructable > 0 ? `, ${bias.skippedUnreconstructable} older result(s) skipped` : '';
      lines.push(
        `Position bias: display slot A won ${bias.slotAWins}/${bias.decidedCount} decided pairs ` +
          `(${(bias.slotAWinRate * 100).toFixed(0)}%)${skippedNote}`
      );
    }
  }

  return lines.join('\n');
}

export function countPairwiseWins(results: PairwiseResult[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of results) {
    const winnerVariant = r.winner === 'tie' ? 'tie' : r.winner === 'A' ? r.variantA : r.variantB;
    counts.set(winnerVariant, (counts.get(winnerVariant) ?? 0) + 1);
  }
  return counts;
}

/**
 * Saves one run. `filename` overrides the default timestamp-based name — the matrix runner passes a
 * per-configuration name so its runs group into one directory with readable names instead of
 * several near-identical timestamps.
 */
export function saveRunResult(run: EvalRunResult, resultsDir: string, filename?: string): string {
  fs.mkdirSync(resultsDir, { recursive: true });
  const name = filename ?? `${run.timestamp.replace(/[:.]/g, '-')}-${run.skillVersion ?? 'unversioned'}.json`;
  const filePath = path.join(resultsDir, name);
  fs.writeFileSync(filePath, JSON.stringify(run, null, 2));
  return filePath;
}
