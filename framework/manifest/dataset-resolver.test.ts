import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDatasetDir } from './dataset-resolver';

let skillDir: string;

beforeEach(() => {
  skillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dataset-resolver-'));
});

afterEach(() => {
  fs.rmSync(skillDir, { recursive: true, force: true });
});

function makeDir(rel: string) {
  fs.mkdirSync(path.join(skillDir, rel), { recursive: true });
}

describe('resolveDatasetDir', () => {
  it('uses the declared dir when it exists, even if a publicDir is also declared', () => {
    makeDir('reference/evals/golden');
    makeDir('evals/cases/golden');

    const resolved = resolveDatasetDir(skillDir, { dir: 'reference/evals/golden', publicDir: 'evals/cases/golden' });

    expect(resolved).toEqual({ dir: path.join(skillDir, 'reference/evals/golden'), source: 'declared' });
  });

  it('falls back to publicDir when the declared dir is absent', () => {
    makeDir('evals/cases/golden');

    const resolved = resolveDatasetDir(skillDir, { dir: 'reference/evals/golden', publicDir: 'evals/cases/golden' });

    expect(resolved).toEqual({ dir: path.join(skillDir, 'evals/cases/golden'), source: 'fallback' });
  });

  it('uses the declared dir as-is when no publicDir is declared', () => {
    makeDir('evals/cases/golden');

    const resolved = resolveDatasetDir(skillDir, { dir: 'evals/cases/golden' });

    expect(resolved).toEqual({ dir: path.join(skillDir, 'evals/cases/golden'), source: 'declared' });
  });

  it('fails clearly when neither the declared dir nor publicDir exists', () => {
    expect(() => resolveDatasetDir(skillDir, { dir: 'reference/evals/golden', publicDir: 'evals/cases/golden' })).toThrow(
      /reference\/evals\/golden.*evals\/cases\/golden/s
    );
  });

  it('fails clearly when the declared dir is missing and there is no publicDir to fall back to', () => {
    expect(() => resolveDatasetDir(skillDir, { dir: 'evals/cases/golden' })).toThrow(/evals\/cases\/golden/);
  });
});
