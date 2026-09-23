import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findLatestApproved, loadRun } from './regression';

describe('loadRun', () => {
  let dir: string;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads and parses a saved run file', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'regression-io-'));
    const filePath = path.join(dir, 'run.json');
    const run = { timestamp: '2026-01-01T00:00:00.000Z', model: 'claude-sonnet-5', caseResults: [] };
    fs.writeFileSync(filePath, JSON.stringify(run));

    expect(loadRun(filePath)).toEqual(run);
  });

  it('loads a legacy-shaped file that predates newer optional fields without error', () => {
    // Backward compatibility: a result saved before schemaVersion/skillHash/caseHash/modelRoles
    // etc. existed is still plain JSON with those keys simply absent — loadRun must not require them.
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'regression-io-'));
    const filePath = path.join(dir, 'legacy.json');
    const legacyRun = {
      timestamp: '2025-01-01T00:00:00.000Z',
      model: 'claude-sonnet-5',
      evaluatorModel: 'claude-sonnet-5',
      benchmarkVersion: 'golden-v1',
      variants: ['B'],
      caseResults: [{ caseId: 'golden-001', category: 'x', variant: 'B', output: { variant: 'B', caseId: 'golden-001', text: 'y' } }],
      pairwiseResults: [],
      aggregates: [],
    };
    fs.writeFileSync(filePath, JSON.stringify(legacyRun));

    const loaded = loadRun(filePath);
    expect(loaded.schemaVersion).toBeUndefined();
    expect(loaded.caseResults[0].caseHash).toBeUndefined();
    expect(loaded.caseResults).toHaveLength(1);
  });
});

describe('findLatestApproved', () => {
  let dir: string;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('throws a clear, actionable error when no baseline has ever been approved', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'regression-io-'));

    expect(() => findLatestApproved(dir)).toThrow(/No approved baseline found/);
    expect(() => findLatestApproved(dir)).toThrow(/npm run eval:approve/);
  });

  it('resolves the pointer file to the results directory', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'regression-io-'));
    fs.writeFileSync(path.join(dir, 'approved-baseline.json'), JSON.stringify({ file: 'some-run.json' }));

    expect(findLatestApproved(dir)).toBe(path.join(dir, 'some-run.json'));
  });

  it('uses the baseline file itself when it holds a whole run', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'regression-io-'));
    fs.writeFileSync(path.join(dir, 'approved-baseline.json'), JSON.stringify({ caseResults: [] }));

    expect(findLatestApproved(dir)).toBe(path.join(dir, 'approved-baseline.json'));
  });

  // The approved baseline is a full record of real translated CV text, so run-regression.ts writes
  // and reads it from a separate, private baselineDir (reference/evals/results/), never from the
  // tracked, exported resultsDir (evals/results/) that raw runs live in.
  function makeDirs(): { resultsDir: string; baselineDir: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-'));
    const resultsDir = path.join(root, 'evals', 'results');
    const baselineDir = path.join(root, 'reference', 'evals', 'results');
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.mkdirSync(baselineDir, { recursive: true });
    return { resultsDir, baselineDir };
  }

  it('reads the pointer from baselineDir, not resultsDir, when they differ', () => {
    const { resultsDir, baselineDir } = makeDirs();
    fs.writeFileSync(path.join(baselineDir, 'approved-baseline.json'), JSON.stringify({ caseResults: [] }));

    expect(findLatestApproved(resultsDir, baselineDir)).toBe(path.join(baselineDir, 'approved-baseline.json'));
  });

  it('throws, rather than silently falling back to resultsDir, when baselineDir has no approved baseline', () => {
    const { resultsDir, baselineDir } = makeDirs();
    fs.writeFileSync(path.join(resultsDir, 'approved-baseline.json'), JSON.stringify({ caseResults: [] }));

    expect(() => findLatestApproved(resultsDir, baselineDir)).toThrow(/No approved baseline found/);
  });

  it('still resolves a legacy pointer baseline against resultsDir, not baselineDir', () => {
    const { resultsDir, baselineDir } = makeDirs();
    fs.writeFileSync(path.join(resultsDir, 'a-real-run.json'), JSON.stringify({ caseResults: [] }));
    fs.writeFileSync(path.join(baselineDir, 'approved-baseline.json'), JSON.stringify({ file: 'a-real-run.json' }));

    expect(findLatestApproved(resultsDir, baselineDir)).toBe(path.join(resultsDir, 'a-real-run.json'));
  });
});
