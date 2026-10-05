import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(__dirname, '..');

/** True when git would ignore the path, i.e. `git add` would skip it without -f. */
function ignored(relative: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', relative], { cwd: ROOT });
    return true;
  } catch {
    return false;
  }
}

describe('where run traces are written', () => {
  it.each(['cv-translator', 'cover-letter-writer', 'any-future-skill'])(
    'a trace file under skills/%s/data/ is ignored by git',
    (skill) => {
      expect(ignored(`skills/${skill}/data/traces/runs.jsonl`)).toBe(true);
    }
  );
});
