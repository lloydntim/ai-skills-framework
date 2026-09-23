import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv } from './load-env';

const KEYS = ['LOAD_ENV_TEST_A', 'LOAD_ENV_TEST_B', 'LOAD_ENV_TEST_C'];
afterEach(() => KEYS.forEach((k) => delete process.env[k]));

function makeRepo(): { root: string; skill: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'env-'));
  const skill = path.join(root, 'skills', 'demo');
  fs.mkdirSync(skill, { recursive: true });
  return { root, skill };
}

describe('loadEnv', () => {
  it('reads the skill .env and then the root .env', () => {
    const { root, skill } = makeRepo();
    fs.writeFileSync(path.join(skill, '.env'), 'LOAD_ENV_TEST_A=from-skill\n');
    fs.writeFileSync(path.join(root, '.env'), 'LOAD_ENV_TEST_B=from-root\n');
    loadEnv(skill);
    expect(process.env.LOAD_ENV_TEST_A).toBe('from-skill');
    expect(process.env.LOAD_ENV_TEST_B).toBe('from-root');
  });

  it('prefers the skill value over the root value', () => {
    const { root, skill } = makeRepo();
    fs.writeFileSync(path.join(skill, '.env'), 'LOAD_ENV_TEST_A=from-skill\n');
    fs.writeFileSync(path.join(root, '.env'), 'LOAD_ENV_TEST_A=from-root\n');
    loadEnv(skill);
    expect(process.env.LOAD_ENV_TEST_A).toBe('from-skill');
  });

  it('never replaces a value that is already set', () => {
    const { skill } = makeRepo();
    process.env.LOAD_ENV_TEST_C = 'from-shell';
    fs.writeFileSync(path.join(skill, '.env'), 'LOAD_ENV_TEST_C=from-file\n');
    loadEnv(skill);
    expect(process.env.LOAD_ENV_TEST_C).toBe('from-shell');
  });

  it('does nothing when there is no .env', () => {
    const { skill } = makeRepo();
    expect(() => loadEnv(skill)).not.toThrow();
  });
});
