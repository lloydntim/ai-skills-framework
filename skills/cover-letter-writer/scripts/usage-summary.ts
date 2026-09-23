/**
 * Prints a usage report built from data/usage/*.jsonl (see src/usage/report.ts).
 *
 *   npx tsx scripts/usage-summary.ts --from=2026-09-01 --to=2026-09-30
 *   npx tsx scripts/usage-summary.ts --group-by=tool
 *   npx tsx scripts/usage-summary.ts --group-by=model
 *   npx tsx scripts/usage-summary.ts --run-id=<run-id>
 *
 * Reads every day-file, deduplicates by attemptId across files, and never silently substitutes 0
 * for usage or cost that was not reported. Dates are UTC calendar days, inclusive.
 */
import path from 'node:path';
import { buildReport } from '../src/usage/report';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

function formatCost(amount: number, label: string): string {
  return `${label}: $${amount.toFixed(4)} USD`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const groupBy = args['group-by'];
  if (groupBy !== undefined && groupBy !== 'tool' && groupBy !== 'model') {
    console.error(`--group-by must be "tool" or "model" (got "${groupBy}")`);
    process.exit(2);
  }

  const dir = process.env.MODEL_USAGE_DIR ? path.resolve(process.env.MODEL_USAGE_DIR) : path.resolve(__dirname, '..', 'data', 'usage');

  const report = buildReport({
    dir,
    from: args.from,
    to: args.to,
    runId: args['run-id'],
    groupBy,
  });

  console.log(`Usage report — ${dir}`);
  if (args.from || args.to) console.log(`Date range (UTC, inclusive): ${args.from ?? '(start)'} .. ${args.to ?? '(end)'}`);
  if (args['run-id']) console.log(`Run ID: ${args['run-id']}`);
  console.log('');
  console.log(`Attempts: ${report.totalAttempts} (${report.successes} success, ${report.failures} failure)`);
  console.log(`Tokens: ${report.totalInputTokens} in / ${report.totalOutputTokens} out`);
  console.log(`  (${report.recordsWithUnavailableUsage} record(s) with unavailable usage — not counted above)`);
  console.log(`Duration: ${report.totalDurationMs}ms total`);
  console.log(`  (${report.recordsWithUnavailableDuration} record(s) with unavailable duration — not counted above)`);
  console.log(formatCost(report.totalEstimatedCostUSD, 'Estimated cost'));
  console.log(formatCost(report.totalProviderReportedCostUSD, 'Provider-reported cost'));
  console.log(`  (${report.recordsWithUnknownCost} record(s) with unknown cost — not counted above)`);

  if (report.malformedLines.length > 0) {
    console.log('');
    console.log(`Malformed lines (${report.malformedLines.length}):`);
    for (const m of report.malformedLines) {
      console.log(`  ${m.file}:${m.line}${m.interrupted ? ' (interrupted final line)' : ''}`);
    }
  }

  if (report.groups) {
    console.log('');
    console.log(`Grouped by ${groupBy}:`);
    for (const g of report.groups) {
      console.log(`  ${g.key}: ${g.totalAttempts} attempts (${g.successes} ok, ${g.failures} failed), ${g.totalInputTokens}in/${g.totalOutputTokens}out tokens, $${g.totalEstimatedCostUSD.toFixed(4)} USD`);
    }
  }
}

main();
