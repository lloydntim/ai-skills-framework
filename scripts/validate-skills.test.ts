import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeSkillFile } from '../framework/testing/make-skill-dir';
import { main, typecheckAgainstFramework, validateSkills } from './validate-skills';

const REAL_REPO_ROOT = path.resolve(__dirname, '..');
// A typecheck builds a whole program, which takes a few seconds.
const TYPECHECK_TIMEOUT = 60_000;

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/**
 * A stand-in for the sibling private repository, holding one instructions-only skill whose code
 * imports the real framework. `frameworkImport` is what that code asks the framework for.
 */
function privateRepo(options: { name?: string; folder?: string; frameworkImport?: string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'private-skills-'));
  made.push(root);
  const name = options.name ?? 'private-demo';
  const skillDir = path.join(root, 'skills', options.folder ?? name);
  const write = (rel: string, content: string) => writeSkillFile(skillDir, rel, content);
  write('SKILL.md', '# Private demo\nRules.');
  write('README.md', '# Private demo');
  write('skill.json', JSON.stringify({ name, version: '1.0.0', description: 'A demo', domain: 'test', prompts: {}, datasets: {} }));
  write('src/roles.ts', `import { ${options.frameworkImport ?? 'MODEL_ROLES'} as roles } from '@skills/framework/provider/model-roles';\nexport const roleCount: number = roles.length;\n`);
  write('src/roles.test.ts', "import { roleCount } from './roles';\nexport const checked = roleCount > 0;\n");
  return { root, skillDir };
}

/** Every file under a folder with its content, to show that validation changed nothing. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(dir, full)] = fs.readFileSync(full, 'utf-8');
    }
  };
  walk(dir);
  return out;
}

const gitStatus = () => execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: REAL_REPO_ROOT, encoding: 'utf-8' });

describe('validateSkills', () => {
  it('validates only the public skills when no private root is configured', () => {
    const { privateRoot, reports, notes } = validateSkills({ repoRoot: REAL_REPO_ROOT, env: { PRIVATE_SKILLS_ROOT: '' }, typecheck: false });
    expect(privateRoot).toEqual({ state: 'unset' });
    expect(reports.map((r) => [r.skill.label, r.problems])).toEqual([
      ['public/cover-letter-writer', []],
      ['public/cv-translator', []],
      ['public/skill-builder', []],
    ]);
    expect(notes).toEqual([]);
  });

  it('adds a compatible private skill, checked by the same rules', () => {
    const { root } = privateRepo();
    const { reports } = validateSkills({ repoRoot: REAL_REPO_ROOT, env: { PRIVATE_SKILLS_ROOT: root }, typecheck: false });
    expect(reports.find((r) => r.skill.label === 'private/private-demo')?.problems).toEqual([]);
  });

  it('names the private skill that breaks a framework rule, without printing its folder', () => {
    const { root } = privateRepo({ name: 'renamed', folder: 'private-demo' });
    const { reports } = validateSkills({ repoRoot: REAL_REPO_ROOT, env: { PRIVATE_SKILLS_ROOT: root }, typecheck: false });
    const report = reports.find((r) => r.skill.label === 'private/private-demo')!;
    expect(report.problems).toEqual(['skill.json name "renamed" must match the folder name "private-demo"']);
    expect(report.problems.join('\n')).not.toContain(root);
  });

  it('notes a private skill that shares a public skill\'s name, without failing it', () => {
    const { root } = privateRepo({ name: 'cv-translator' });
    const { reports, notes } = validateSkills({ repoRoot: REAL_REPO_ROOT, env: { PRIVATE_SKILLS_ROOT: root }, typecheck: false });
    expect(reports.find((r) => r.skill.label === 'private/cv-translator')?.problems).toEqual([]);
    expect(notes).toEqual([expect.stringContaining('private/cv-translator has the same name as public/cv-translator')]);
  });

  it('reads the private repository without writing to it or to this one', () => {
    const { root } = privateRepo();
    const before = snapshot(root);
    const status = gitStatus();
    validateSkills({ repoRoot: REAL_REPO_ROOT, env: { PRIVATE_SKILLS_ROOT: root }, typecheck: false });
    typecheckAgainstFramework(path.join(root, 'skills', 'private-demo'), REAL_REPO_ROOT);
    expect(snapshot(root)).toEqual(before);
    expect(gitStatus()).toEqual(status);
  }, TYPECHECK_TIMEOUT);
});

describe('typecheckAgainstFramework', () => {
  it('passes a private skill whose code matches this framework', () => {
    const { skillDir } = privateRepo();
    expect(typecheckAgainstFramework(skillDir, REAL_REPO_ROOT)).toEqual([]);
  }, TYPECHECK_TIMEOUT);

  it('fails a private skill that uses something this framework does not export, naming the file', () => {
    const { skillDir } = privateRepo({ frameworkImport: 'MODEL_ROLES_V0' });
    const problems = typecheckAgainstFramework(skillDir, REAL_REPO_ROOT);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^src\/roles\.ts\(1,\d+\): TS2\d+: .*MODEL_ROLES_V0/);
  }, TYPECHECK_TIMEOUT);
});

describe('main', () => {
  const run = (env: NodeJS.ProcessEnv) => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(line));
    const code = main({ repoRoot: REAL_REPO_ROOT, env, typecheck: false });
    return { code, lines };
  };

  it('says quietly that private skills are not configured, and succeeds', () => {
    // Empty rather than absent, so a PRIVATE_SKILLS_ROOT in this checkout's own .env is not read.
    const { code, lines } = run({ PRIVATE_SKILLS_ROOT: '' });
    expect(code).toBe(0);
    expect(lines[0]).toBe('PRIVATE_SKILLS_ROOT is not set: public skills only.');
  });

  it('carries on with public skills when the configured root is missing', () => {
    const { code, lines } = run({ PRIVATE_SKILLS_ROOT: '../no-such-private-repository' });
    expect(code).toBe(0);
    expect(lines[0]).toMatch(/does not exist: public skills only/);
  });

  it('fails when a private skill fails, and when the root is inside this repository', () => {
    const { root } = privateRepo({ name: 'renamed', folder: 'private-demo' });
    const failing = run({ PRIVATE_SKILLS_ROOT: root });
    expect(failing.code).toBe(1);
    expect(failing.lines).toContain('FAIL private/private-demo');
    expect(run({ PRIVATE_SKILLS_ROOT: 'skills' }).code).toBe(1);
  });
});
