import fs from 'node:fs';
import path from 'node:path';
import type { UsageAttemptRecord } from './types';

export interface MalformedLine {
  file: string;
  line: number;
  /** True when this looks like a truncated final line (no trailing newline) rather than corrupt JSON mid-file. */
  interrupted: boolean;
  raw: string;
}

export interface ReportGroup {
  key: string;
  totalAttempts: number;
  successes: number;
  failures: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCostUSD: number;
}

export interface UsageReport {
  totalAttempts: number;
  successes: number;
  failures: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  recordsWithUnavailableUsage: number;
  totalDurationMs: number;
  recordsWithUnavailableDuration: number;
  totalEstimatedCostUSD: number;
  totalProviderReportedCostUSD: number;
  recordsWithUnknownCost: number;
  malformedLines: MalformedLine[];
  groups?: ReportGroup[];
}

export interface BuildReportOptions {
  dir: string;
  /** Inclusive, UTC calendar day, e.g. "2026-09-01". */
  from?: string;
  /** Inclusive, UTC calendar day, e.g. "2026-09-30". */
  to?: string;
  runId?: string;
  groupBy?: 'tool' | 'model';
}

function dayOf(fileName: string): string {
  return fileName.replace(/\.jsonl$/, '');
}

function inRange(day: string, from?: string, to?: string): boolean {
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function readRecords(dir: string, from?: string, to?: string): { records: UsageAttemptRecord[]; malformed: MalformedLine[] } {
  const records: UsageAttemptRecord[] = [];
  const malformed: MalformedLine[] = [];

  if (!fs.existsSync(dir)) {
    return { records, malformed };
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .filter((f) => inRange(dayOf(f), from, to))
    .sort();

  for (const file of files) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
    const lines = raw.split('\n');
    // A well-formed file ends with a trailing newline, so the last split element is ''. If it is
    // not, the file was cut off mid-write (e.g. process killed between write and flush) rather
    // than containing a genuinely malformed final record.
    const endsWithNewline = raw.endsWith('\n') || raw.length === 0;

    lines.forEach((line, index) => {
      const isLastElement = index === lines.length - 1;
      if (isLastElement && line === '') return; // the newline-produced empty tail
      if (line.trim() === '') return;

      try {
        records.push(JSON.parse(line) as UsageAttemptRecord);
      } catch {
        const interrupted = isLastElement && !endsWithNewline;
        malformed.push({ file, line: index + 1, interrupted, raw: line });
      }
    });
  }

  return { records, malformed };
}

function dedupeByAttemptId(records: UsageAttemptRecord[]): UsageAttemptRecord[] {
  const seen = new Map<string, UsageAttemptRecord>();
  for (const record of records) {
    seen.set(record.attemptId, record);
  }
  return [...seen.values()];
}

function assertSingleCurrency(records: UsageAttemptRecord[]): void {
  const currencies = new Set<string>();
  for (const r of records) {
    if (r.estimatedCostCurrency) currencies.add(r.estimatedCostCurrency);
    if (r.providerReportedCostCurrency) currencies.add(r.providerReportedCostCurrency);
  }
  if (currencies.size > 1) {
    throw new Error(
      `Usage records mix currencies (${[...currencies].join(', ')}); refusing to sum them into one total. ` +
        `Filter by --from/--to or --run-id to isolate one currency, or extend the report to break totals out per currency.`
    );
  }
}

function summarize(records: UsageAttemptRecord[]): Omit<UsageReport, 'malformedLines' | 'groups'> {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let recordsWithUnavailableUsage = 0;
  let totalDurationMs = 0;
  let recordsWithUnavailableDuration = 0;
  let totalEstimatedCostUSD = 0;
  let totalProviderReportedCostUSD = 0;
  let recordsWithUnknownCost = 0;
  let successes = 0;
  let failures = 0;

  for (const r of records) {
    if (r.status === 'success') successes += 1;
    else failures += 1;

    if (r.usageUnavailable || !r.usage) {
      recordsWithUnavailableUsage += 1;
    } else {
      totalInputTokens += r.usage.inputTokens ?? 0;
      totalOutputTokens += r.usage.outputTokens ?? 0;
    }

    if (r.durationMs === undefined) recordsWithUnavailableDuration += 1;
    else totalDurationMs += r.durationMs;

    if (r.costUnavailable) recordsWithUnknownCost += 1;
    if (r.estimatedCost !== undefined) totalEstimatedCostUSD += r.estimatedCost;
    if (r.providerReportedCost !== undefined) totalProviderReportedCostUSD += r.providerReportedCost;
  }

  return {
    totalAttempts: records.length,
    successes,
    failures,
    totalInputTokens,
    totalOutputTokens,
    recordsWithUnavailableUsage,
    totalDurationMs,
    recordsWithUnavailableDuration,
    totalEstimatedCostUSD,
    totalProviderReportedCostUSD,
    recordsWithUnknownCost,
  };
}

/**
 * Builds a usage report from every *.jsonl file in `dir`. Never coerces a missing usage or cost
 * figure to zero in a per-record sense — recordsWithUnavailableUsage / recordsWithUnknownCost
 * count those separately, and the totals only ever sum figures that were actually present.
 */
export function buildReport(options: BuildReportOptions): UsageReport {
  const { records: allRecords, malformed } = readRecords(options.dir, options.from, options.to);
  const deduped = dedupeByAttemptId(allRecords);
  const filtered = options.runId ? deduped.filter((r) => r.runId === options.runId) : deduped;

  assertSingleCurrency(filtered);

  const summary = summarize(filtered);

  let groups: ReportGroup[] | undefined;
  if (options.groupBy) {
    const byKey = new Map<string, UsageAttemptRecord[]>();
    for (const r of filtered) {
      const key = options.groupBy === 'tool' ? r.tool : r.model;
      byKey.set(key, [...(byKey.get(key) ?? []), r]);
    }
    groups = [...byKey.entries()].map(([key, records]) => {
      const s = summarize(records);
      return {
        key,
        totalAttempts: s.totalAttempts,
        successes: s.successes,
        failures: s.failures,
        totalInputTokens: s.totalInputTokens,
        totalOutputTokens: s.totalOutputTokens,
        totalEstimatedCostUSD: s.totalEstimatedCostUSD,
      };
    });
  }

  return { ...summary, malformedLines: malformed, groups };
}
