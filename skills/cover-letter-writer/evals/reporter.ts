import fs from 'node:fs';
import path from 'node:path';
import { summarizePositionBias } from './position-bias';
import type { AggregateScore, EvalRunResult } from './types';

export function formatTerminalReport(run: EvalRunResult): string {
  const lines: string[] = [];
  lines.push('COVER LETTER WRITER — BENCHMARK EVALUATION');
  lines.push('===========================================');
  lines.push('');
  lines.push(`Cases: ${run.caseResults.length / run.variants.length}`);
  lines.push(`Variants: ${run.variants.join(', ')}`);
  lines.push('');

  const byVariant = new Map(run.aggregates.map((a) => [a.variant, a]));
  lines.push(['Metric', ...run.variants].join('\t'));

  const metricRows: [string, keyof AggregateScore][] = [
    ['Factual grounding', 'avgFactualGrounding'],
    ['Job relevance', 'avgJobRelevance'],
    ['Professional tone', 'avgProfessionalTone'],
    ['Specificity', 'avgSpecificity'],
    ['Naturalness', 'avgNaturalness'],
    ['Conciseness', 'avgConciseness'],
    ['Overall', 'avgOverall'],
    ['Deterministic pass rate', 'deterministicPassRate'],
    ['Avg tokens', 'avgTokens'],
    ['Avg latency (ms)', 'avgLatencyMs'],
  ];

  for (const [label, key] of metricRows) {
    const values = run.variants.map((v) => {
      const agg = byVariant.get(v);
      const value = agg ? (agg[key] as number) : 0;
      if (key === 'avgTokens' || key === 'avgLatencyMs') return value.toFixed(0);
      if (key === 'deterministicPassRate') return `${(value * 100).toFixed(0)}%`;
      return value.toFixed(2);
    });
    lines.push([label, ...values].join('\t'));
  }

  lines.push('');
  lines.push(
    `Totals: ${run.totals.requestCount} requests, ${run.totals.totalUsage.totalTokens ?? 0} tokens` +
      (run.totals.totalLatencyMs !== undefined ? `, ${run.totals.totalLatencyMs}ms` : '') +
      (run.totals.totalCost !== undefined ? `, $${run.totals.totalCost.toFixed(4)}` : ', cost unknown')
  );

  if (run.pairwiseResults.length > 0) {
    lines.push('');
    lines.push('Pairwise results (from canonical variants, never the display-slot fields):');
    for (const agg of run.pairwiseAggregates) {
      lines.push(`  ${agg.variant}: ${agg.wins}W / ${agg.losses}L / ${agg.ties}T over ${agg.comparisons} comparison(s)`);
    }

    const bias = summarizePositionBias(run.pairwiseResults);
    if (bias.slotAWinRate !== null) {
      const skippedNote = bias.skippedUnreconstructable > 0 ? `, ${bias.skippedUnreconstructable} result(s) skipped as unreconstructable` : '';
      lines.push(
        `Position bias: display slot A won ${bias.slotAWins}/${bias.decidedCount} decided pairs ` +
          `(${(bias.slotAWinRate * 100).toFixed(0)}%)${skippedNote}`
      );
    }
  }

  return lines.join('\n');
}

/**
 * Saves one run to a new timestamped file. Never overwrites a previous run: the filename embeds
 * the run's own timestamp (to millisecond resolution) plus its git commit, so two runs started in
 * the same process cannot collide, and it is always obvious which commit a result was produced
 * against without opening the file.
 */
export function saveRunResult(run: EvalRunResult, resultsDir: string): string {
  fs.mkdirSync(resultsDir, { recursive: true });
  const commit = run.gitCommit ? run.gitCommit.slice(0, 12) : 'no-git';
  const name = `${run.timestamp.replace(/[:.]/g, '-')}-${commit}.json`;
  const filePath = path.join(resultsDir, name);
  if (fs.existsSync(filePath)) {
    throw new Error(`Refusing to overwrite an existing eval result: ${filePath}`);
  }
  fs.writeFileSync(filePath, JSON.stringify(run, null, 2));
  return filePath;
}
