import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { allAvailableSkills, privateSkills, publicSkills, resolvePrivateSkillsRoot } from './skill-sources';

const REAL_REPO_ROOT = path.resolve(__dirname, '..');

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A parent folder holding a fake public repository and, optionally, a sibling private one. */
function siblings(options: { privateRepo?: boolean; publicEnv?: string } = {}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-sources-'));
  made.push(parent);
  const publicRoot = path.join(parent, 'public');
  const privateRoot = path.join(parent, 'private');
  fs.mkdirSync(path.join(publicRoot, 'skills', 'alpha'), { recursive: true });
  fs.writeFileSync(path.join(publicRoot, 'skills', 'alpha', 'skill.json'), '{}');
  if (options.publicEnv !== undefined) fs.writeFileSync(path.join(publicRoot, '.env'), options.publicEnv);
  if (options.privateRepo) {
    fs.mkdirSync(path.join(privateRoot, 'skills', 'beta'), { recursive: true });
    fs.writeFileSync(path.join(privateRoot, 'skills', 'beta', 'skill.json'), '{}');
    // A folder without skill.json (for example, reference material for a public skill) is not a skill.
    fs.mkdirSync(path.join(privateRoot, 'skills', 'alpha', 'reference'), { recursive: true });
  }
  return { parent, publicRoot, privateRoot };
}

describe('resolvePrivateSkillsRoot', () => {
  it('is unset when the variable is absent from the environment and from .env', () => {
    const { publicRoot } = siblings({ privateRepo: true });
    expect(resolvePrivateSkillsRoot({ repoRoot: publicRoot, env: {} })).toEqual({ state: 'unset' });
  });

  it('treats an empty value as unset, so the shell can switch a configured .env off', () => {
    const { publicRoot } = siblings({ privateRepo: true, publicEnv: 'PRIVATE_SKILLS_ROOT=../private\n' });
    expect(resolvePrivateSkillsRoot({ repoRoot: publicRoot, env: { PRIVATE_SKILLS_ROOT: '' } })).toEqual({ state: 'unset' });
  });

  it('resolves a relative value against the repository root, not the current directory', () => {
    const { publicRoot, privateRoot } = siblings({ privateRepo: true });
    const cwd = process.cwd();
    try {
      process.chdir(os.tmpdir());
      expect(resolvePrivateSkillsRoot({ repoRoot: publicRoot, env: { PRIVATE_SKILLS_ROOT: '../private' } })).toEqual({
        state: 'found',
        configured: '../private',
        root: privateRoot,
      });
    } finally {
      process.chdir(cwd);
    }
  });

  it("reads the root .env when the shell does not set it, without loading .env into the environment", () => {
    const { publicRoot, privateRoot } = siblings({ privateRepo: true, publicEnv: 'PRIVATE_SKILLS_ROOT=../private\nOTHER=x\n' });
    const env: NodeJS.ProcessEnv = {};
    expect(resolvePrivateSkillsRoot({ repoRoot: publicRoot, env })).toMatchObject({ state: 'found', root: privateRoot });
    expect(env).toEqual({});
  });

  it('reports a configured root that does not exist as unusable, not as an error', () => {
    const { publicRoot, privateRoot } = siblings();
    expect(resolvePrivateSkillsRoot({ repoRoot: publicRoot, env: { PRIVATE_SKILLS_ROOT: '../private' } })).toEqual({
      state: 'unusable',
      configured: '../private',
      resolved: privateRoot,
      reason: 'missing',
    });
  });

  it('refuses a root inside the public repository, which would be a nested checkout', () => {
    const { publicRoot } = siblings();
    for (const value of ['.', 'skills']) {
      expect(resolvePrivateSkillsRoot({ repoRoot: publicRoot, env: { PRIVATE_SKILLS_ROOT: value } })).toMatchObject({
        state: 'unusable',
        reason: 'inside-public-repository',
      });
    }
  });
});

describe('skill discovery', () => {
  it('finds the same public skills as before, whether or not a private root is configured', () => {
    const names = publicSkills(REAL_REPO_ROOT).map((s) => s.label);
    expect(names).toEqual(['public/cover-letter-writer', 'public/cv-translator', 'public/skill-builder']);
    const { skills } = allAvailableSkills({ repoRoot: REAL_REPO_ROOT, env: { PRIVATE_SKILLS_ROOT: '' } });
    expect(skills.map((s) => s.label)).toEqual(names);
  });

  it('adds only the private folders that have a skill.json when the root is found', () => {
    const { publicRoot, privateRoot } = siblings({ privateRepo: true });
    const { skills } = allAvailableSkills({ repoRoot: publicRoot, env: { PRIVATE_SKILLS_ROOT: '../private' } });
    expect(skills.map((s) => [s.label, s.dir])).toEqual([
      ['public/alpha', path.join(publicRoot, 'skills', 'alpha')],
      ['private/beta', path.join(privateRoot, 'skills', 'beta')],
    ]);
  });

  it('has no private skills when the root is unset or missing', () => {
    expect(privateSkills({ state: 'unset' })).toEqual([]);
    const { publicRoot } = siblings();
    const { skills } = allAvailableSkills({ repoRoot: publicRoot, env: { PRIVATE_SKILLS_ROOT: '../private' } });
    expect(skills.map((s) => s.label)).toEqual(['public/alpha']);
  });
});
