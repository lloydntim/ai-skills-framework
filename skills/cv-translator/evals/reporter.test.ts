import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { countPairwiseWins, formatTerminalReport, saveRunResult } from './reporter';
import type { EvalRunResult, PairwiseResult } from './types';

function pairwise(overrides: Partial<PairwiseResult>): PairwiseResult {
  return {
    caseId: 'case-1',
    variantA: 'C',
    variantB: 'D',
    winner: 'A',
    naturalness: 'A',
    faithfulness: 'A',
    cvProfessionalism: 'A',
    conciseness: 'A',
    justification: 'irrelevant for this test',
    ...overrides,
  };
}

describe('countPairwiseWins — aggregates by canonical variant, never a display label', () => {
  it('keys wins by the canonical variant (e.g. "D"), not the literal "A"/"B" the winner field holds', () => {
    // winner: 'B' here is canonical shorthand for "variantB won" — variantB is 'D' in this fixture,
    // a variant identifier that shares no letters with "A"/"B" display slots. If aggregation ever
    // regressed to keying off the raw display label instead of resolving it through variantA/
    // variantB, this would surface as a wrong or nonsensical key.
    const results: PairwiseResult[] = [pairwise({ winner: 'B', variantA: 'C', variantB: 'D' })];

    const counts = countPairwiseWins(results);

    expect(counts.get('D')).toBe(1);
    expect(counts.get('C')).toBeUndefined();
    expect(counts.get('B')).toBeUndefined(); // the raw display label must never leak in as a key
  });

  it('resolves winner "A" to variantA regardless of which concrete variant that is', () => {
    const results: PairwiseResult[] = [pairwise({ winner: 'A', variantA: 'C', variantB: 'D' })];
    expect(countPairwiseWins(results).get('C')).toBe(1);
  });

  it('counts ties under the literal "tie" key, separate from any variant', () => {
    const results: PairwiseResult[] = [pairwise({ winner: 'tie', variantA: 'C', variantB: 'D' })];
    const counts = countPairwiseWins(results);
    expect(counts.get('tie')).toBe(1);
    expect(counts.get('C')).toBeUndefined();
    expect(counts.get('D')).toBeUndefined();
  });

  it('accumulates across multiple results for the same canonical variant', () => {
    const results: PairwiseResult[] = [
      pairwise({ winner: 'A', variantA: 'C', variantB: 'D' }),
      pairwise({ winner: 'B', variantA: 'D', variantB: 'C' }), // variantB is 'C' here — still the same winner
      pairwise({ winner: 'A', variantA: 'C', variantB: 'D' }),
    ];

    expect(countPairwiseWins(results).get('C')).toBe(3);
  });
});

function minimalRun(overrides: Partial<EvalRunResult> = {}): EvalRunResult {
  return {
    timestamp: '2026-09-13T10:00:00.000Z',
    model: 'claude-sonnet-5',
    evaluatorModel: 'claude-sonnet-5',
    benchmarkVersion: 'v1',
    variants: ['A', 'B'],
    caseResults: [],
    pairwiseResults: [],
    aggregates: [
      {
        variant: 'A',
        cases: 2,
        avgFaithfulness: 4,
        avgNaturalness: 4,
        avgCvQuality: 4,
        avgTerminology: 4,
        avgConciseness: 4,
        avgOverall: 4,
        avgTokens: 150,
        avgLatencyMs: 200,
      },
      {
        variant: 'B',
        cases: 2,
        avgFaithfulness: 4.5,
        avgNaturalness: 4.5,
        avgCvQuality: 4.5,
        avgTerminology: 4.5,
        avgConciseness: 4.5,
        avgOverall: 4.5,
        avgTokens: 300,
        avgLatencyMs: 400,
      },
    ],
    ...overrides,
  };
}

describe('formatTerminalReport', () => {
  it('names every variant and its metric rows', () => {
    const report = formatTerminalReport(minimalRun());

    expect(report).toContain('CV SKILL EVALUATION');
    expect(report).toContain('Naturalness');
    expect(report).toContain('Overall');
    expect(report).toMatch(/4\.00/);
    expect(report).toMatch(/4\.50/);
  });

  it('reports the case count as caseResults length divided by variant count', () => {
    const run = minimalRun({
      variants: ['A', 'B'],
      caseResults: [
        { caseId: 'c1', category: 'x', variant: 'A' } as never,
        { caseId: 'c1', category: 'x', variant: 'B' } as never,
        { caseId: 'c2', category: 'x', variant: 'A' } as never,
        { caseId: 'c2', category: 'x', variant: 'B' } as never,
      ],
    });

    expect(formatTerminalReport(run)).toContain('Cases: 2');
  });

  it('adds a pairwise section with per-variant win counts only when pairwise results exist', () => {
    const withoutPairwise = formatTerminalReport(minimalRun());
    expect(withoutPairwise).not.toContain('Pairwise results');

    const withPairwise = formatTerminalReport(
      minimalRun({
        pairwiseResults: [
          {
            caseId: 'c1',
            variantA: 'A',
            variantB: 'B',
            winner: 'B',
            naturalness: 'B',
            faithfulness: 'B',
            cvProfessionalism: 'B',
            conciseness: 'B',
            justification: 'B reads better',
            displayedWinner: 'A',
            displayedAsA: 'B',
            displayedAsB: 'A',
          },
        ],
      })
    );
    expect(withPairwise).toContain('Pairwise results');
    expect(withPairwise).toContain('B wins: 1');
  });

  it('never throws for a run with zero cases and zero aggregates', () => {
    expect(() => formatTerminalReport(minimalRun({ variants: ['A'], aggregates: [] }))).not.toThrow();
  });
});

describe('saveRunResult', () => {
  let dir: string;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes the run as JSON that reloads to an equal object', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-save-'));
    const run = minimalRun();

    const filePath = saveRunResult(run, dir);
    const reloaded = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    expect(reloaded).toEqual(run);
  });

  it('derives the default filename from the timestamp and skill version', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-save-'));
    const filePath = saveRunResult(minimalRun({ skillVersion: 'v2.3' }), dir);

    expect(path.basename(filePath)).toBe('2026-09-13T10-00-00-000Z-v2.3.json');
  });

  it('falls back to "unversioned" in the filename when no skill version is set', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-save-'));
    const filePath = saveRunResult(minimalRun(), dir);

    expect(path.basename(filePath)).toBe('2026-09-13T10-00-00-000Z-unversioned.json');
  });

  it('uses an explicit filename override instead of deriving one', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-save-'));
    const filePath = saveRunResult(minimalRun(), dir, 'custom-name.json');

    expect(path.basename(filePath)).toBe('custom-name.json');
  });

  it('creates the results directory when it does not already exist', () => {
    dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-save-')), 'nested', 'results');
    expect(fs.existsSync(dir)).toBe(false);

    const filePath = saveRunResult(minimalRun(), dir, 'run.json');

    expect(fs.existsSync(filePath)).toBe(true);
  });
});
