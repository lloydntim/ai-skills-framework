import path from 'node:path';
import type { RegressionReport } from './regression';
import type { Variant } from './types';

function formatScore(value: number | undefined): string {
  return value === undefined ? 'not run' : value.toFixed(2);
}

function compatibilityLines(report: RegressionReport): string[] {
  const lines: string[] = [];
  lines.push(`Comparability: ${report.comparability}${report.overridden ? ' (OVERRIDDEN by --allow-incompatible)' : ''}`);
  if (report.compatibility.findings.length === 0) {
    lines.push('  no differences found between the two runs\' metadata or case sets');
  }
  for (const finding of report.compatibility.findings) {
    const change =
      finding.previous !== undefined || finding.current !== undefined
        ? ` [${finding.previous ?? '?'} -> ${finding.current ?? '?'}]`
        : '';
    lines.push(`  ${`[${finding.level}]`.padEnd(15)} ${finding.code}: ${finding.message}${change}`);
  }
  lines.push('');
  return lines;
}

/**
 * Renders one variant's regression report. Kept apart from the CLI so the exact text a reader sees
 * is testable, rather than being asserted only by running the suite against a live API.
 */
export function formatRegressionReport(
  variant: Variant,
  report: RegressionReport,
  previousFile: string,
  currentFile: string
): string {
  const lines: string[] = [];
  lines.push(`CV SKILL REGRESSION REPORT — variant ${variant}`);
  lines.push('==========================================');
  lines.push('');
  lines.push(`Compared: ${path.basename(previousFile)} -> ${path.basename(currentFile)}`);
  lines.push('');

  lines.push(...compatibilityLines(report));

  if (report.missingFromCurrent.length > 0) {
    lines.push('Cases in the baseline but NOT in this run — these were not checked:');
    for (const caseId of report.missingFromCurrent) {
      lines.push(`  ${caseId}`);
    }
    lines.push('');
  }

  if (report.deltaCasesCompared === 0) {
    lines.push(`Overall deltas (variant ${variant}): no case was comparable, so no delta was computed.`);
  } else {
    lines.push(
      `Overall deltas (variant ${variant}, over ${report.deltaCasesCompared} comparable case(s)):`
    );
    for (const [key, value] of Object.entries(report.overallDeltas)) {
      lines.push(`  ${key}: ${value >= 0 ? '+' : ''}${value.toFixed(2)}`);
    }
  }
  lines.push('');

  const { tokens } = report;
  if (tokens.casesCompared === 0) {
    lines.push('Tokens: no comparable case, so no token comparison was made.');
  } else {
    const change = tokens.increasePercent === null ? 'n/a' : `${tokens.increasePercent >= 0 ? '+' : ''}${tokens.increasePercent.toFixed(1)}%`;
    const flag = tokens.exceeded ? '  <- beyond tokenIncreasePercent threshold' : '';
    lines.push(`Tokens over ${tokens.casesCompared} comparable case(s): ` +
        `${tokens.previousTotal.toLocaleString('en-GB')} -> ${tokens.currentTotal.toLocaleString('en-GB')} (${change})${flag}`
    );
  }
  lines.push('');

  lines.push('Per-case:');
  for (const c of report.caseComparisons) {
    const suffix = c.reasons.length ? ` (${c.reasons.join(', ')})` : '';
    lines.push(`  ${`[${c.status}]`.padEnd(15)} ${c.caseId}: overall ${formatScore(c.previous?.overall)} -> ${formatScore(c.current?.overall)}${suffix}`
    );
  }
  lines.push('');
  lines.push(`RESULT: ${report.status}`);
  return lines.join('\n');
}
