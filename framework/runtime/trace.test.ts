import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonlTraceSink, MemoryTraceSink, safeCode, spendOf, sumOptional, sumUsage, type ModelCallRecord, type RunTrace } from './trace';
import { DEFAULT_RUNTIME_SETTINGS } from './config';

const trace: RunTrace = {
  runId: 'r1', skill: 's', startedAt: 1, finishedAt: 2, states: [], models: {}, settings: DEFAULT_RUNTIME_SETTINGS,
  attempts: 1, validationResults: [], modelCalls: [], toolCalls: [], tokenUsage: {}, finalStatus: 'completed',
};

describe('trace helpers', () => {
  it('accepts identifier-shaped codes and replaces anything else, so text cannot ride in a code', () => {
    expect(safeCode('low-faithfulness')).toBe('low-faithfulness');
    expect(safeCode('missing_term.v2')).toBe('missing_term.v2');
    expect(safeCode('missing required term: "Kubernetes"')).toBe('unspecified');
    expect(safeCode('')).toBe('unspecified');
    expect(safeCode('a'.repeat(200))).toBe('unspecified');
  });

  it('sums usage treating an unreported figure as zero, and keeps an all-unreported cost undefined', () => {
    expect(sumUsage([{ usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } }, {}, { usage: { inputTokens: 4 } }])).toEqual({
      inputTokens: 5, outputTokens: 2, totalTokens: 3, cachedInputTokens: 0, reasoningTokens: 0,
    });
    expect(sumOptional([undefined, undefined])).toBeUndefined();
    expect(sumOptional([undefined, 0.5, 0.25])).toBe(0.75);
  });
});

describe('spendOf', () => {
  const call = (over: Partial<ModelCallRecord>): ModelCallRecord => ({
    role: 'generator', requestType: 'initial-generation', provider: 'p', model: 'm', ok: true, usedFallback: false, ...over,
  });

  it('totals one role\'s finished calls, or everything when no role is given', () => {
    const calls = [
      call({ usage: { totalTokens: 10 }, cost: 0.01, latencyMs: 5 }),
      call({ role: 'validator', usage: { totalTokens: 4 }, cost: 0.002 }),
      call({ usage: { totalTokens: 6 }, cost: 0.02, latencyMs: 7 }),
    ];
    expect(spendOf(calls, 'generator')).toMatchObject({ requestCount: 2, usage: { totalTokens: 16 }, latencyMs: 12 });
    expect(spendOf(calls, 'generator')!.cost).toBeCloseTo(0.03);
    expect(spendOf(calls)).toMatchObject({ requestCount: 3, usage: { totalTokens: 20 } });
  });

  it('is undefined for a role that made no call, and ignores calls that failed', () => {
    expect(spendOf([call({ role: 'validator' })], 'reviser')).toBeUndefined();
    expect(spendOf([call({ ok: false })], 'generator')).toBeUndefined();
  });

  it('leaves latency and cost undefined when nothing reported them', () => {
    expect(spendOf([call({})], 'generator')).toMatchObject({ latencyMs: undefined, cost: undefined });
  });
});

describe('trace sinks', () => {
  it('keeps traces in memory', () => {
    const sink = new MemoryTraceSink();
    sink.write(trace);
    expect(sink.traces).toEqual([trace]);
  });

  it('appends one JSON line per run, creating the folder', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-'));
    const file = path.join(dir, 'nested', 'runs.jsonl');
    const sink = new JsonlTraceSink(file);
    sink.write(trace);
    sink.write({ ...trace, runId: 'r2' });
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
    expect(lines.map((l) => JSON.parse(l).runId)).toEqual(['r1', 'r2']);
    fs.rmSync(dir, { recursive: true });
  });
});
