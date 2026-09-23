import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeSkillDir, writeSkillFile } from '../testing/make-skill-dir';
import { buildRunMetadata } from './run-metadata';

let skillDir: string;
let baseOptions: Parameters<typeof buildRunMetadata>[0];

beforeEach(() => {
  skillDir = makeSkillDir();
  baseOptions = {
    skillDir,
    dataset: 'golden',
    schemaVersion: 3,
    cases: [{ id: 'g1', input: 'Kurzer Text.' }],
    config: { temperature: 0.3 },
    provider: 'anthropic',
    // The temporary skill folder is not in a git repo, so nothing here depends on one.
    cwd: skillDir,
    watchPaths: [skillDir],
  };
});

describe('buildRunMetadata', () => {
  it('records the provider, the schema version and the skill name and version', () => {
    const metadata = buildRunMetadata(baseOptions);
    expect(metadata).toMatchObject({ provider: 'anthropic', schemaVersion: 3, skillName: 'demo-skill', skillVersion: '1.0.0' });
  });

  it('records the version and hash of every prompt and dataset, and names the dataset that ran', () => {
    const metadata = buildRunMetadata(baseOptions);
    expect(metadata.versions.prompts.validator.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(metadata.versions.datasets.golden).toMatchObject({ version: '1', caseCount: 1 });
    expect(metadata.dataset).toBe('golden');
    expect(metadata.benchmarkVersion).toBe('golden-v1');
    expect(metadata.evaluatorPromptHash).toBe(metadata.versions.prompts.evaluator.hash);
    expect(metadata.skillHash).toBe(metadata.versions.skill.hash);
  });

  it('refuses a dataset the skill does not declare', () => {
    expect(() => buildRunMetadata({ ...baseOptions, dataset: 'benchmark' })).toThrow(/benchmark/);
  });

  it('changes the skill hash when SKILL.md changes and the evaluator hash when that prompt changes', () => {
    const before = buildRunMetadata(baseOptions);
    writeSkillFile(skillDir, 'SKILL.md', '# Demo\nDifferent rules.');
    writeSkillFile(skillDir, 'prompts/evaluator.md', 'Score differently {{OUTPUT}}\n');
    const after = buildRunMetadata(baseOptions);
    expect(after.skillHash).not.toBe(before.skillHash);
    expect(after.evaluatorPromptHash).not.toBe(before.evaluatorPromptHash);
  });

  it('gives the same case and config hash for equivalent input, and a different one when it changes', () => {
    const a = buildRunMetadata(baseOptions);
    const b = buildRunMetadata({ ...baseOptions, cases: [{ input: 'Kurzer Text.', id: 'g1' }] });
    const c = buildRunMetadata({ ...baseOptions, cases: [{ id: 'g2', input: 'Anderer Text.' }] });
    const d = buildRunMetadata({ ...baseOptions, config: { temperature: 0 } });
    expect(a.caseInputHash).toBe(b.caseInputHash);
    expect(a.caseInputHash).not.toBe(c.caseInputHash);
    expect(a.configHash).not.toBe(d.configHash);
  });

  it('uses the injected clock', () => {
    const metadata = buildRunMetadata({ ...baseOptions, now: () => new Date('2026-09-20T10:00:00.000Z') });
    expect(metadata.timestamp).toBe('2026-09-20T10:00:00.000Z');
  });

  describe('outside a git checkout', () => {
    it('reports null commit and null dirty state', () => {
      const metadata = buildRunMetadata(baseOptions);
      expect(metadata.gitCommit).toBeNull();
      expect(metadata.gitDirty).toBeNull();
    });
  });

  describe('inside a real git checkout', () => {
    let repoDir: string;

    function makeRepo(): void {
      repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-metadata-git-'));
      const git = (...args: string[]) => execFileSync('git', args, { cwd: repoDir, stdio: 'ignore' });
      git('init');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'Test');
      fs.writeFileSync(path.join(repoDir, 'file.txt'), 'hello');
      git('add', 'file.txt');
      git('commit', '-m', 'initial');
    }

    afterEach(() => {
      if (repoDir) fs.rmSync(repoDir, { recursive: true, force: true });
    });

    it('records the current commit and a clean tree', () => {
      makeRepo();
      const metadata = buildRunMetadata({ ...baseOptions, cwd: repoDir, watchPaths: [repoDir] });
      const expected = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf-8' }).trim();
      expect(metadata.gitCommit).toBe(expected);
      expect(metadata.gitDirty).toBe(false);
    });

    it('flags an uncommitted change as dirty', () => {
      makeRepo();
      fs.writeFileSync(path.join(repoDir, 'file.txt'), 'changed');
      const metadata = buildRunMetadata({ ...baseOptions, cwd: repoDir, watchPaths: [repoDir] });
      expect(metadata.gitDirty).toBe(true);
    });

    it('ignores changes outside the watched paths', () => {
      makeRepo();
      fs.mkdirSync(path.join(repoDir, 'other'));
      fs.writeFileSync(path.join(repoDir, 'other', 'x.txt'), 'new');
      const metadata = buildRunMetadata({ ...baseOptions, cwd: repoDir, watchPaths: [path.join(repoDir, 'file.txt')] });
      expect(metadata.gitDirty).toBe(false);
    });
  });
});
