import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFrameworkSkill } from './build-framework-skill';

const REPO_TEMPLATE_PATH = path.join(__dirname, '..', 'SKILL.md');
const REPO_BLUEPRINT_PATH = path.join(__dirname, '..', 'docs', 'skill-framework-blueprint.md');

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-framework-build-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function readFrontmatter(skillMd: string): string {
  const match = skillMd.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error('No frontmatter found');
  return match[1];
}

describe('buildFrameworkSkill', () => {
  it('portable frontmatter contains only standard fields', () => {
    const out = path.join(tmpRoot, 'portable');
    const result = buildFrameworkSkill({ target: 'portable', out });

    const frontmatter = readFrontmatter(fs.readFileSync(result.skillPath, 'utf-8'));
    const keys = frontmatter
      .split('\n')
      .filter((line) => /^[A-Za-z-]+:/.test(line))
      .map((line) => line.split(':')[0]);

    expect(keys).toEqual(['name', 'description']);
    expect(frontmatter).not.toContain('disable-model-invocation');
  });

  it('Claude Code output sets manual invocation', () => {
    const out = path.join(tmpRoot, 'claude-code');
    const result = buildFrameworkSkill({ target: 'claude-code', out });

    const frontmatter = readFrontmatter(fs.readFileSync(result.skillPath, 'utf-8'));
    expect(frontmatter).toMatch(/^disable-model-invocation: true$/m);
  });

  it('both outputs contain the exact source blueprint', () => {
    const sourceBlueprint = fs.readFileSync(REPO_BLUEPRINT_PATH, 'utf-8').trimEnd() + '\n';

    const portable = buildFrameworkSkill({ target: 'portable', out: path.join(tmpRoot, 'portable') });
    const claudeCode = buildFrameworkSkill({ target: 'claude-code', out: path.join(tmpRoot, 'claude-code') });

    expect(fs.readFileSync(portable.referencePath, 'utf-8')).toBe(sourceBlueprint);
    expect(fs.readFileSync(claudeCode.referencePath, 'utf-8')).toBe(sourceBlueprint);
  });

  it('does not generate a separate command by default', () => {
    const commandOut = path.join(tmpRoot, 'commands', 'skill-framework.md');
    const result = buildFrameworkSkill({
      target: 'claude-code',
      out: path.join(tmpRoot, 'claude-code'),
      commandOut,
    });

    expect(result.commandPath).toBeUndefined();
    expect(fs.existsSync(commandOut)).toBe(false);
  });

  it('generates the legacy command only when explicitly requested', () => {
    const commandOut = path.join(tmpRoot, 'commands', 'skill-framework.md');
    const result = buildFrameworkSkill({
      target: 'claude-code',
      out: path.join(tmpRoot, 'claude-code'),
      legacyCommand: true,
      commandOut,
    });

    expect(result.commandPath).toBe(commandOut);
    expect(fs.existsSync(commandOut)).toBe(true);
    expect(fs.readFileSync(commandOut, 'utf-8')).toContain('skill-framework');
  });

  it('reports an existing legacy command file as redundant without deleting it', () => {
    const commandOut = path.join(tmpRoot, 'commands', 'skill-framework.md');
    fs.mkdirSync(path.dirname(commandOut), { recursive: true });
    fs.writeFileSync(commandOut, 'pre-existing legacy command');

    const result = buildFrameworkSkill({
      target: 'claude-code',
      out: path.join(tmpRoot, 'claude-code'),
      commandOut,
    });

    expect(result.legacyCommandFound).toBe(commandOut);
    expect(fs.readFileSync(commandOut, 'utf-8')).toBe('pre-existing legacy command');
  });

  it('rejects --legacy-command for the portable target', () => {
    expect(() =>
      buildFrameworkSkill({
        target: 'portable',
        out: path.join(tmpRoot, 'portable'),
        legacyCommand: true,
        commandOut: path.join(tmpRoot, 'commands', 'skill-framework.md'),
      })
    ).toThrow(/legacy slash command/);
  });

  it('honours a custom output directory', () => {
    const out = path.join(tmpRoot, 'custom', 'nested', 'dir');
    const result = buildFrameworkSkill({ target: 'portable', out });

    expect(result.skillPath).toBe(path.join(out, 'SKILL.md'));
    expect(result.referencePath).toBe(path.join(out, 'reference', 'blueprint.md'));
    expect(fs.existsSync(result.skillPath)).toBe(true);
    expect(fs.existsSync(result.referencePath)).toBe(true);
  });

  it('fails loudly when the blueprint is missing', () => {
    expect(() =>
      buildFrameworkSkill({
        out: path.join(tmpRoot, 'claude-code'),
        blueprintPath: path.join(tmpRoot, 'does-not-exist.md'),
      })
    ).toThrow(/Blueprint not found/);
  });

  it('fails loudly when the template is invalid', () => {
    const badTemplate = path.join(tmpRoot, 'bad-template.md');
    fs.writeFileSync(badTemplate, '---\nname: skill-framework\n---\n\nNo blueprint pointer here.\n');

    expect(() =>
      buildFrameworkSkill({
        out: path.join(tmpRoot, 'claude-code'),
        templatePath: badTemplate,
      })
    ).toThrow(/reference\/blueprint\.md/);
  });

  it('fails loudly when the template is missing required frontmatter fields', () => {
    const badTemplate = path.join(tmpRoot, 'no-description.md');
    fs.writeFileSync(
      badTemplate,
      '---\nname: skill-framework\n---\n\nSee reference/blueprint.md for the architecture.\n'
    );

    expect(() =>
      buildFrameworkSkill({
        out: path.join(tmpRoot, 'claude-code'),
        templatePath: badTemplate,
      })
    ).toThrow(/must declare both "name" and "description"/);
  });

  it('produces byte-identical output across repeated builds', () => {
    const first = buildFrameworkSkill({ target: 'claude-code', out: path.join(tmpRoot, 'run1') });
    const second = buildFrameworkSkill({ target: 'claude-code', out: path.join(tmpRoot, 'run2') });

    expect(fs.readFileSync(first.skillPath, 'utf-8')).toBe(fs.readFileSync(second.skillPath, 'utf-8'));
    expect(fs.readFileSync(first.referencePath, 'utf-8')).toBe(
      fs.readFileSync(second.referencePath, 'utf-8')
    );
  });

  it('uses the real repo template and blueprint by default', () => {
    expect(fs.existsSync(REPO_TEMPLATE_PATH)).toBe(true);
    expect(fs.existsSync(REPO_BLUEPRINT_PATH)).toBe(true);
  });
});
