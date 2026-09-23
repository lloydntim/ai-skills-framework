import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSkillDir, writeSkillFile } from '../testing/make-skill-dir';
import { checkSkillPackage } from './check-skill-package';
import { snapshotVersions } from './versions';

let dir: string;

function write(rel: string, content: string) {
  writeSkillFile(dir, rel, content);
}

beforeEach(() => {
  dir = makeSkillDir();
});

describe('checkSkillPackage', () => {
  it('accepts a skill that follows the standard', () => {
    expect(checkSkillPackage(dir)).toEqual([]);
  });

  it('reports a name that does not match the folder', () => {
    write('skill.json', fs.readFileSync(path.join(dir, 'skill.json'), 'utf-8').replace('demo-skill', 'other-name'));
    expect(checkSkillPackage(dir).join('\n')).toMatch(/must match the folder name/);
  });

  it('reports a missing prompt file', () => {
    fs.rmSync(path.join(dir, 'prompts/validator.md'));
    expect(checkSkillPackage(dir).join('\n')).toMatch(/prompt "validator".*does not exist/);
  });

  it('reports a missing role in models.json', () => {
    write('config/models.json', JSON.stringify({ generator: { provider: 'anthropic', model: 'm' } }));
    expect(checkSkillPackage(dir).join('\n')).toMatch(/role "validator"/);
  });

  it('reports a missing models.json when the skill declares prompts', () => {
    fs.rmSync(path.join(dir, 'config/models.json'));
    expect(checkSkillPackage(dir)).toContain('config/models.json is missing');
  });

  it('accepts a skill that is only instructions, with no prompts and no models.json', () => {
    write('skill.json', JSON.stringify({ name: 'demo-skill', version: '1.0.0', description: 'A demo', domain: 'test', prompts: {}, datasets: {} }));
    fs.rmSync(path.join(dir, 'config/models.json'));
    expect(checkSkillPackage(dir)).toEqual([]);
  });

  it('reports an import that reaches outside the skill folder', () => {
    write('src/bad.ts', "import x from '../../other-skill/src/x';");
    expect(checkSkillPackage(dir).join('\n')).toMatch(/outside the skill folder/);
  });

  it('reports an import of a sibling skill package', () => {
    write('src/bad.ts', "import x from '@skills/other-skill/x';");
    expect(checkSkillPackage(dir).join('\n')).toMatch(/only @skills\/framework/);
  });

  it('reports a manifest with an unknown key instead of ignoring it', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'skill.json'), 'utf-8'));
    manifest.prompts.validatr = { file: 'x', version: '1' };
    write('skill.json', JSON.stringify(manifest));
    expect(checkSkillPackage(dir).join('\n')).toMatch(/validatr|Unrecognized/i);
  });
});

describe('snapshotVersions', () => {
  it('records versions and content hashes', () => {
    const v = snapshotVersions(dir);
    expect(v.skill).toMatchObject({ name: 'demo-skill', version: '1.0.0' });
    expect(v.prompts.validator.version).toBe('1');
    expect(v.prompts.validator.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(v.datasets.golden).toMatchObject({ version: '1', caseCount: 1 });
  });

  it('changes a prompt hash when its text changes, but not when only the version changes', () => {
    const before = snapshotVersions(dir);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'skill.json'), 'utf-8'));
    manifest.prompts.validator.version = '2';
    write('skill.json', JSON.stringify(manifest));
    expect(snapshotVersions(dir).prompts.validator.hash).toBe(before.prompts.validator.hash);

    write('prompts/validator.md', '## System\nBe stricter.\n\n## Task\nCheck {{OUTPUT}}\n');
    expect(snapshotVersions(dir).prompts.validator.hash).not.toBe(before.prompts.validator.hash);
  });

  it('changes a dataset hash when a case changes', () => {
    const before = snapshotVersions(dir);
    write('evals/cases/golden/a.json', JSON.stringify([{ id: 'c1', input: 'y' }]));
    expect(snapshotVersions(dir).datasets.golden.hash).not.toBe(before.datasets.golden.hash);
  });
});
