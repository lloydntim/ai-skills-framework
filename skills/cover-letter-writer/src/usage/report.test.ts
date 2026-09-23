import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildReport } from './report';
import type { UsageAttemptRecord } from './types';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-report-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeDay(day: string, records: Partial<UsageAttemptRecord>[]): void {
  const lines = records.map((r) =>
    JSON.stringify({
      schemaVersion: 1,
      attemptId: r.attemptId ?? `${day}-${Math.random()}`,
      runId: null,
      timestamp: `${day}T12:00:00.000Z`,
      source: 'writer',
      tool: 'initial-generation',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      status: 'success',
      usageUnavailable: false,
      costUnavailable: false,
      ...r,
    })
  );
  fs.writeFileSync(path.join(dir, `${day}.jsonl`), lines.join('\n') + '\n');
}

describe('buildReport', () => {
  it('sums attempts, successes and failures across every file in the directory', () => {
    writeDay('2026-09-01', [{ status: 'success' }, { status: 'failure', errorMessage: 'x', usage: undefined, usageUnavailable: true }]);
    writeDay('2026-09-02', [{ status: 'success' }]);

    const report = buildReport({ dir });

    expect(report.totalAttempts).toBe(3);
    expect(report.successes).toBe(2);
    expect(report.failures).toBe(1);
  });

  it('filters by inclusive UTC date range', () => {
    writeDay('2026-09-01', [{ status: 'success' }]);
    writeDay('2026-09-15', [{ status: 'success' }]);
    writeDay('2026-09-30', [{ status: 'success' }]);

    const report = buildReport({ dir, from: '2026-09-02', to: '2026-09-29' });

    expect(report.totalAttempts).toBe(1);
  });

  it('deduplicates by attemptId across files', () => {
    writeDay('2026-09-01', [{ attemptId: 'dupe', status: 'success' }]);
    writeDay('2026-09-02', [{ attemptId: 'dupe', status: 'success' }]);

    const report = buildReport({ dir });

    expect(report.totalAttempts).toBe(1);
  });

  it('sums input and output tokens, and counts records with unavailable usage separately', () => {
    writeDay('2026-09-01', [
      { status: 'success', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, usageUnavailable: false },
      { status: 'success', usage: undefined, usageUnavailable: true },
    ]);

    const report = buildReport({ dir });

    expect(report.totalInputTokens).toBe(100);
    expect(report.totalOutputTokens).toBe(50);
    expect(report.recordsWithUnavailableUsage).toBe(1);
  });

  it('sums estimated and provider-reported cost separately, and counts unknown-cost records', () => {
    writeDay('2026-09-01', [
      { status: 'success', estimatedCost: 1, estimatedCostCurrency: 'USD', costUnavailable: false },
      { status: 'success', providerReportedCost: 2, providerReportedCostCurrency: 'USD', costUnavailable: false },
      { status: 'success', costUnavailable: true },
    ]);

    const report = buildReport({ dir });

    expect(report.totalEstimatedCostUSD).toBe(1);
    expect(report.totalProviderReportedCostUSD).toBe(2);
    expect(report.recordsWithUnknownCost).toBe(1);
  });

  it('throws rather than silently dropping a record in a mixed currency, naming both currencies', () => {
    writeDay('2026-09-01', [
      { status: 'success', estimatedCost: 1, estimatedCostCurrency: 'USD', costUnavailable: false },
      { status: 'success', estimatedCost: 1, estimatedCostCurrency: 'EUR', costUnavailable: false },
    ]);

    expect(() => buildReport({ dir })).toThrow(/USD.*EUR|EUR.*USD/);
  });

  it('filters by runId', () => {
    writeDay('2026-09-01', [{ runId: 'run-a', status: 'success' } as Partial<UsageAttemptRecord>, { runId: 'run-b', status: 'success' } as Partial<UsageAttemptRecord>]);

    const report = buildReport({ dir, runId: 'run-a' });

    expect(report.totalAttempts).toBe(1);
  });

  it('groups by tool', () => {
    writeDay('2026-09-01', [
      { tool: 'ask', status: 'success' },
      { tool: 'ask', status: 'success' },
      { tool: 'review', status: 'failure' },
    ]);

    const report = buildReport({ dir, groupBy: 'tool' });

    expect(report.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'ask', totalAttempts: 2, successes: 2, failures: 0 }),
        expect.objectContaining({ key: 'review', totalAttempts: 1, successes: 0, failures: 1 }),
      ])
    );
  });

  it('groups by model', () => {
    writeDay('2026-09-01', [{ model: 'claude-sonnet-5' }, { model: 'claude-opus-5' }]);

    const report = buildReport({ dir, groupBy: 'model' });

    expect(report.groups?.map((g) => g.key).sort()).toEqual(['claude-opus-5', 'claude-sonnet-5']);
  });

  it('reports malformed JSON lines instead of silently dropping them from the total', () => {
    fs.writeFileSync(path.join(dir, '2026-09-01.jsonl'), '{"not valid json\n');

    const report = buildReport({ dir });

    expect(report.malformedLines).toHaveLength(1);
    expect(report.malformedLines[0]).toMatchObject({ file: '2026-09-01.jsonl', line: 1 });
    expect(report.totalAttempts).toBe(0);
  });

  it('reports an interrupted final line separately from a fully malformed one', () => {
    writeDay('2026-09-01', [{ status: 'success' }]);
    fs.appendFileSync(path.join(dir, '2026-09-01.jsonl'), '{"attemptId":"cut-off","source":"writer"');

    const report = buildReport({ dir });

    expect(report.totalAttempts).toBe(1);
    expect(report.malformedLines).toHaveLength(1);
  });

  it('returns zero totals with no records when the directory does not exist', () => {
    const report = buildReport({ dir: path.join(dir, 'does-not-exist') });

    expect(report.totalAttempts).toBe(0);
  });
});
