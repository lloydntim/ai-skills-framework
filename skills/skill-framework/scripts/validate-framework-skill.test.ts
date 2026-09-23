import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateFrameworkSkill } from './validate-framework-skill';

const REAL_REPO_ROOT = path.join(__dirname, '..');

let tmpRoot: string;

function writeFixtureRepo(overrides: { template?: string; blueprint?: string } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-framework-validate-fixture-'));
  fs.mkdirSync(path.join(root, 'skill'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });

  const template =
    overrides.template ??
    [
      '---',
      'name: skill-framework',
      'description: A test skill framework template.',
      '---',
      '',
      '# Skill Framework',
      '',
      'See `reference/blueprint.md` for the architecture, and its section 7.15 for what a skill loads.',
      '',
    ].join('\n');

  const blueprint =
    overrides.blueprint ??
    ['# Skill Framework Blueprint', '', 'A minimal blueprint used for testing validation.', '', '### 7.15 Decide what each call sees', ''].join('\n');

  fs.writeFileSync(path.join(root, 'SKILL.md'), template);
  fs.writeFileSync(path.join(root, 'docs', 'skill-framework-blueprint.md'), blueprint);

  return root;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-framework-validate-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('validateFrameworkSkill against the real repo', () => {
  it('reports zero issues for the checked-in source', () => {
    const issues = validateFrameworkSkill({ repoRoot: REAL_REPO_ROOT });
    expect(issues).toEqual([]);
  });
});

describe('validateFrameworkSkill catches each seeded failure', () => {
  it('flags a portable frontmatter field outside the open Agent Skills spec', () => {
    const root = writeFixtureRepo({
      template: [
        '---',
        'name: skill-framework',
        'description: A test template.',
        'disable-model-invocation: true',
        '---',
        '',
        'See `reference/blueprint.md`.',
        '',
      ].join('\n'),
    });

    const issues = validateFrameworkSkill({ repoRoot: root });
    expect(issues.some((i) => i.rule === 'portable-frontmatter')).toBe(true);
    expect(issues.some((i) => i.rule === 'no-accidental-provider-requirement')).toBe(true);
  });

  it('flags a template that never points at the blueprint reference', () => {
    const root = writeFixtureRepo({
      template: ['---', 'name: skill-framework', 'description: A test template.', '---', '', 'No pointer here.', ''].join(
        '\n'
      ),
    });

    // The build itself refuses this template (build-framework-skill.ts's own guard), so validation
    // must surface that failure rather than crash.
    const issues = validateFrameworkSkill({ repoRoot: root });
    expect(issues.some((i) => i.rule === 'build-succeeds')).toBe(true);
  });

  it('flags an unfinished placeholder left in the template', () => {
    const root = writeFixtureRepo({
      template: [
        '---',
        'name: skill-framework',
        'description: A test template.',
        '---',
        '',
        'See `reference/blueprint.md`.',
        '',
        'TODO: finish this section.',
        '',
      ].join('\n'),
    });

    const issues = validateFrameworkSkill({ repoRoot: root });
    expect(issues.some((i) => i.rule === 'no-unfinished-placeholders')).toBe(true);
  });

  it('flags a broken relative reference in the template', () => {
    const root = writeFixtureRepo({
      template: [
        '---',
        'name: skill-framework',
        'description: A test template.',
        '---',
        '',
        'See `reference/blueprint.md` and `reference/does-not-exist.md`.',
        '',
      ].join('\n'),
    });

    const issues = validateFrameworkSkill({ repoRoot: root });
    expect(issues.some((i) => i.rule === 'no-broken-relative-references')).toBe(true);
  });

  it('flags a Superpowers dependency', () => {
    const root = writeFixtureRepo({
      template: [
        '---',
        'name: skill-framework',
        'description: A test template.',
        '---',
        '',
        'See `reference/blueprint.md`. Requires the Superpowers plugin to be installed first.',
        '',
      ].join('\n'),
    });

    const issues = validateFrameworkSkill({ repoRoot: root });
    expect(issues.some((i) => i.rule === 'no-superpowers-dependency')).toBe(true);
  });

  it('flags an obsolete requirement for a separate slash command', () => {
    const root = writeFixtureRepo({
      template: [
        '---',
        'name: skill-framework',
        'description: A test template.',
        '---',
        '',
        'See `reference/blueprint.md`.',
        '',
        'You must also create a separate slash command for this to work.',
        '',
      ].join('\n'),
    });

    const issues = validateFrameworkSkill({ repoRoot: root });
    expect(issues.some((i) => i.rule === 'no-obsolete-slash-command-requirement')).toBe(true);
  });

  it('flags a blueprint paragraph duplicated verbatim into the template', () => {
    const longParagraph =
      'This exact sentence is long enough to count as a duplicated architecture rule once it is ' +
      'copy-pasted somewhere it should only be referenced from instead of repeated in full.';
    const root = writeFixtureRepo({
      blueprint: ['# Skill Framework Blueprint', '', longParagraph, ''].join('\n'),
      template: [
        '---',
        'name: skill-framework',
        'description: A test template.',
        '---',
        '',
        'See `reference/blueprint.md`.',
        '',
        longParagraph,
        '',
      ].join('\n'),
    });

    const issues = validateFrameworkSkill({ repoRoot: root });
    expect(issues.some((i) => i.rule === 'no-duplicated-rules')).toBe(true);
  });

  it('flags an em dash in a file explicitly named as new content', () => {
    const emDash = String.fromCharCode(0x2014);
    const root = writeFixtureRepo();
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scripts', 'new-thing.ts'), `const x = 'a ${emDash} b';\n`);

    const issues = validateFrameworkSkill({ repoRoot: root, newContentFiles: ['scripts/new-thing.ts'] });
    expect(issues.some((i) => i.rule === 'no-em-dashes')).toBe(true);
  });

  it('does not flag an em dash in a file not named as new content', () => {
    const emDash = String.fromCharCode(0x2014);
    const root = writeFixtureRepo({
      blueprint: ['# Skill Framework Blueprint', '', `Some prose with an em dash ${emDash} kept as-is.`, ''].join('\n'),
    });

    const issues = validateFrameworkSkill({ repoRoot: root, newContentFiles: [] });
    expect(issues.some((i) => i.rule === 'no-em-dashes')).toBe(false);
  });

  it('flags instructions that stop pointing at the context section, or a blueprint without it', () => {
    const root = writeFixtureRepo({
      template: ['---', 'name: skill-framework', 'description: A test template.', '---', '', 'See `reference/blueprint.md`.', ''].join('\n'),
      blueprint: ['# Skill Framework Blueprint', '', 'No context section.', ''].join('\n'),
    });

    const issues = validateFrameworkSkill({ repoRoot: root, newContentFiles: [] });
    expect(issues.filter((i) => i.rule === 'context-guidance-reachable')).toHaveLength(2);
  });

  it('passes a well-formed minimal fixture repo cleanly', () => {
    const root = writeFixtureRepo();
    const issues = validateFrameworkSkill({ repoRoot: root, newContentFiles: [] });
    expect(issues).toEqual([]);
  });
});
