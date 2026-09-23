import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatTerminalReport, saveRunResult } from './reporter';
import type { EvalRunResult } from './types';

function makeRun(overrides: Partial<EvalRunResult> = {}): EvalRunResult {
  return {
    schemaVersion: 5,
    skillName: 'cover-letter-writer',
    skillVersion: '0.1.0',
    dataset: 'benchmark',
    versions: {
      skill: { name: 'cover-letter-writer', version: '0.1.0', hash: 'skill-hash' },
      prompts: {},
      datasets: {},
    },
    timestamp: '2026-01-01T00:00:00.000Z',
    gitCommit: 'abc123def4560000000000000000000000000000',
    gitDirty: false,
    runId: null,
    skillHash: 'skill-hash',
    caseInputHash: 'case-hash',
    configHash: 'config-hash',
    evaluatorPromptHash: 'evaluator-prompt-hash',
    modelRoles: {
      generator: { provider: 'fake', model: 'fake-model' },
      validator: { provider: 'fake', model: 'fake-model' },
      reviser: { provider: 'fake', model: 'fake-model' },
      evaluator: { provider: 'fake', model: 'fake-model' },
      pairwiseJudge: { provider: 'fake', model: 'fake-model' },
    },
    benchmarkVersion: 'v1',
    variants: ['A', 'B'],
    caseResults: [],
    pairwiseResults: [],
    pairwiseAggregates: [],
    aggregates: [
      {
        variant: 'A',
        cases: 1,
        avgFactualGrounding: 5,
        avgJobRelevance: 4,
        avgProfessionalTone: 5,
        avgSpecificity: 4,
        avgNaturalness: 5,
        avgConciseness: 4,
        avgOverall: 5,
        avgTokens: 120,
        avgLatencyMs: 200,
        deterministicPassRate: 1,
      },
      {
        variant: 'B',
        cases: 1,
        avgFactualGrounding: 5,
        avgJobRelevance: 5,
        avgProfessionalTone: 5,
        avgSpecificity: 5,
        avgNaturalness: 5,
        avgConciseness: 5,
        avgOverall: 5,
        avgTokens: 150,
        avgLatencyMs: 250,
        deterministicPassRate: 1,
      },
    ],
    totals: {
      requestCount: 4,
      totalUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cachedInputTokens: 0, reasoningTokens: 0 },
      totalLatencyMs: 450,
      totalCost: 0.01,
    },
    ...overrides,
  };
}

describe('formatTerminalReport', () => {
  it('includes every requested variant and the run totals', () => {
    const report = formatTerminalReport(makeRun());
    expect(report).toContain('A');
    expect(report).toContain('B');
    expect(report).toContain('4 requests');
    expect(report).toContain('150 tokens');
  });
});

describe('saveRunResult', () => {
  let resultsDir: string;

  afterEach(() => {
    if (resultsDir) fs.rmSync(resultsDir, { recursive: true, force: true });
  });

  it('writes a new file readable back as the same run', () => {
    resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-results-'));
    const run = makeRun();

    const filePath = saveRunResult(run, resultsDir);

    expect(fs.existsSync(filePath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual(run);
  });

  it('never overwrites a previous run — a second save with the same timestamp/commit throws', () => {
    resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-results-'));
    const run = makeRun();

    saveRunResult(run, resultsDir);

    expect(() => saveRunResult(run, resultsDir)).toThrow(/Refusing to overwrite/);
  });

  it('saves two runs with different timestamps as two distinct files', () => {
    resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-results-'));
    const first = makeRun({ timestamp: '2026-01-01T00:00:00.000Z' });
    const second = makeRun({ timestamp: '2026-01-01T00:05:00.000Z' });

    const firstPath = saveRunResult(first, resultsDir);
    const secondPath = saveRunResult(second, resultsDir);

    expect(firstPath).not.toBe(secondPath);
    expect(fs.readdirSync(resultsDir)).toHaveLength(2);
  });
});
