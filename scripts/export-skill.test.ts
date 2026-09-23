import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSkillDir, writeSkillFile } from '../framework/testing/make-skill-dir';
import { collectFiles, findMissingImports, main, scanForSecrets, type ExportFile } from './export-skill';
import { havePrivateReferenceData, identifiers, privateLines } from './privacy-scan';

/** A small stand-in for the repository: framework/, one skill and the root files. */
function makeRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-'));
  fs.cpSync(makeSkillDir('demo-skill'), path.join(root, 'skills', 'demo-skill'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'other-skill'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'other-skill', 'SKILL.md'), 'other');
  writeSkillFile(root, 'framework/hash.ts', 'export const x = 1;');
  writeSkillFile(root, 'framework/node_modules/dep/index.js', 'x');
  writeSkillFile(root, 'package.json', JSON.stringify({ name: 'skills', scripts: { test: 'x', 'export-skill': 'y' } }));
  writeSkillFile(root, 'pnpm-workspace.yaml', 'packages: []');
  writeSkillFile(root, '.env.example', 'ANTHROPIC_API_KEY=');
  writeSkillFile(root, '.env', 'ANTHROPIC_API_KEY=not-a-real-key-but-long-enough');
  return root;
}

const paths = (files: ExportFile[]) => files.map((f) => f.path);
let root: string;
beforeEach(() => {
  root = makeRepo();
});

describe('collectFiles', () => {
  it('includes the skill and the framework, and nothing from another skill', () => {
    const list = paths(collectFiles(root, 'demo-skill'));
    expect(list).toContain('skills/demo-skill/SKILL.md');
    expect(list).toContain('framework/hash.ts');
    expect(list.some((p) => p.includes('other-skill'))).toBe(false);
  });

  it('leaves out .env, node_modules and other build or temporary files, but keeps .env.example', () => {
    writeSkillFile(root, 'skills/demo-skill/.env', 'X=1');
    writeSkillFile(root, 'skills/demo-skill/.DS_Store', '');
    writeSkillFile(root, 'skills/demo-skill/dist/out.js', '');
    writeSkillFile(root, 'skills/demo-skill/debug.log', '');
    writeSkillFile(root, 'skills/demo-skill/.git/config', '');
    const list = paths(collectFiles(root, 'demo-skill'));
    expect(list).toContain('.env.example');
    expect(list).not.toContain('.env');
    expect(list.some((p) => /node_modules|\.DS_Store|\/dist\/|\.log$|\.git\//.test(p))).toBe(false);
    expect(list).not.toContain('skills/demo-skill/.env');
  });

  it("applies the skill's own export.exclude list", () => {
    const manifestPath = path.join(root, 'skills/demo-skill/skill.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.export = { exclude: ['private/**'] };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    writeSkillFile(root, 'skills/demo-skill/private/cv.pdf', 'x');
    expect(paths(collectFiles(root, 'demo-skill'))).not.toContain('skills/demo-skill/private/cv.pdf');
  });

  it('never exports private reference material or documents, even with an empty export.exclude', () => {
    // The leak this guards against: "reference/cv/**" in skill.json did not match reference/cv.md,
    // so the CV text, email and phone number went into the archive. The approved-baseline case
    // guards a second one: an approved eval run is a full record of real candidate letters, so it
    // must never leave reference/evals/results/ for the tracked, exported evals/results/ (see
    // regression.ts's findLatestApproved and run-regression.ts's approve step).
    for (const rel of [
      'reference/cv.md',
      'reference/cv-de.md',
      'reference/cv/cv.pdf',
      'reference/letters/uk/en.pdf',
      'reference/evals/results/approved-baseline.json',
      'data/usage/2026-01-01.jsonl',
      'templates/letter.docx',
    ]) {
      writeSkillFile(root, `skills/demo-skill/${rel}`, 'private');
    }
    writeSkillFile(root, 'skills/demo-skill/reference/README.md', 'what the folder holds');
    const list = paths(collectFiles(root, 'demo-skill'));
    expect(list.filter((p) => /\/(reference|data)\/|\.(pdf|docx)$/.test(p))).toEqual(['skills/demo-skill/reference/README.md']);
    expect(list).toContain('skills/demo-skill/SKILL.md');
  });

  it('keeps the approved baseline but not raw eval runs', () => {
    writeSkillFile(root, 'skills/demo-skill/evals/results/approved-baseline.json', '{}');
    writeSkillFile(root, 'skills/demo-skill/evals/results/2026-01-01-v1.json', '{}');
    const list = paths(collectFiles(root, 'demo-skill'));
    expect(list).toContain('skills/demo-skill/evals/results/approved-baseline.json');
    expect(list).not.toContain('skills/demo-skill/evals/results/2026-01-01-v1.json');
  });

  it('writes a root package.json without the export script', () => {
    const pkg = collectFiles(root, 'demo-skill').find((f) => f.path === 'package.json')!;
    const parsed = JSON.parse('content' in pkg.source ? pkg.source.content : '{}');
    expect(parsed.scripts['export-skill']).toBeUndefined();
    expect(parsed.scripts.test).toBeDefined();
  });
});

describe('scanForSecrets', () => {
  const file = (name: string, content: string): ExportFile => ({ path: name, source: { content } });

  it('flags a key-shaped string with its file and line', () => {
    const found = scanForSecrets([file('src/a.ts', 'ok\nconst k = "sk-ant-api03-abcdefghijklmnop";')]);
    expect(found).toEqual(['src/a.ts:2 (Anthropic key)']);
  });

  it('flags an assigned secret', () => {
    expect(scanForSecrets([file('config.md', 'API_KEY=abcdefghijklmnop1234')])).toHaveLength(1);
  });

  it('does not flag an empty placeholder', () => {
    expect(scanForSecrets([file('.env.example', 'ANTHROPIC_API_KEY=\n')])).toEqual([]);
  });
});

describe('findMissingImports', () => {
  function withFiles(entries: Record<string, string>): ExportFile[] {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imports-'));
    return Object.entries(entries).map(([rel, content]) => {
      writeSkillFile(dir, rel, content);
      return { path: rel, source: { file: path.join(dir, rel) } };
    });
  }

  it('accepts imports that resolve inside the archive, including @skills/framework', () => {
    const files = withFiles({
      'framework/hash.ts': 'export {}',
      'skills/a/src/x.ts': "import { h } from '@skills/framework/hash'; import y from './y'; import c from '../config.json';",
      'skills/a/src/y.ts': 'export {}',
      'skills/a/config.json': '{}',
    });
    expect(findMissingImports(files)).toEqual([]);
  });

  it('reports an import of a file that would be left out', () => {
    const files = withFiles({ 'skills/a/src/x.ts': "import z from '../../b/src/z';" });
    expect(findMissingImports(files)[0]).toMatch(/skills\/a\/src\/x\.ts imports \.\.\/\.\.\/b\/src\/z/);
  });
});

describe('exporting the real skills', () => {
  function exportTo(skill: string): { dir: string; files: string[] } {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'exported-')), 'out');
    main([skill, `--to=${dir}`]);
    const files: string[] = [];
    const walk = (d: string) =>
      fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.relative(dir, path.join(d, e.name)))));
    walk(dir);
    return { dir, files };
  }

  it.each(['cv-translator', 'cover-letter-writer'])('%s exports cleanly and self-contained', (skill) => {
    const { files } = exportTo(skill);
    expect(files).toContain('EXPORT.md');
    expect(files).toContain('export-manifest.json');
    expect(files).toContain(`skills/${skill}/SKILL.md`);
    expect(files).toContain('framework/provider/types.ts');
    expect(files.filter((f) => /(^|\/)\.env$|node_modules|\.git\/|\.pdf$|\/reference\/(?!README\.md$)/.test(f))).toEqual([]);
    const otherSkill = skill === 'cv-translator' ? 'cover-letter-writer' : 'cv-translator';
    expect(files.some((f) => f.includes(otherSkill))).toBe(false);
  });

  describe('personal data', () => {
    // Everything private about the candidate lives in cover-letter-writer's reference/ folder: the
    // profile the skill is filled from, the reference CVs, and the eval cases built from the CV.
    // These tests read it and check that none of it reaches an export. They name what leaked by key
    // and source line, never by value, so a failure does not print the data it found.
    // identifiers() and privateLines() are shared with scripts/tracked-tree-privacy.test.ts, which
    // runs the same detectors over the tracked working tree instead of an export.
    const havePrivate = havePrivateReferenceData;

    const textFiles = (dir: string, files: string[]) =>
      files.filter((f) => /\.(ts|js|json|md|ya?ml|txt|sh|py|example)$/.test(f)).map((f) => ({ file: f, text: fs.readFileSync(path.join(dir, f), 'utf-8') }));

    it.skipIf(!havePrivate).each(['cover-letter-writer', 'cv-translator'])(
      '%s ships none of the candidate\'s contact details',
      (skill) => {
        const { dir, files } = exportTo(skill);
        const found = textFiles(dir, files).flatMap(({ file, text }) =>
          identifiers().filter(({ pattern }) => pattern.test(text)).map(({ label }) => `${file}: ${label}`),
        );
        expect(found).toEqual([]);
      },
    );

    it.skipIf(!havePrivate).each(['cover-letter-writer', 'cv-translator'])(
      '%s ships no text from the profile, the CVs or the eval cases built from them',
      (skill) => {
        const { dir, files } = exportTo(skill);
        const lines = privateLines();
        expect(lines.size).toBeGreaterThan(100);
        const found = textFiles(dir, files).flatMap(({ file, text }) =>
          [...lines].filter(([line]) => text.includes(line)).map(([, source]) => `${file} repeats ${source}`),
        );
        expect(found).toEqual([]);
      },
    );

    it.skipIf(!havePrivate)('cover-letter-writer ships the synthetic profile that says what the skill needs', () => {
      const { dir, files } = exportTo('cover-letter-writer');
      expect(files).toContain('skills/cover-letter-writer/candidate-profile.example.md');
      expect(files).not.toContain('skills/cover-letter-writer/reference/candidate-profile.md');
      const skill = fs.readFileSync(path.join(dir, 'skills/cover-letter-writer/SKILL.md'), 'utf-8');
      expect(skill).toContain('{{CANDIDATE_NAME}}');
      expect(skill).toContain('{{STANDARD_PHRASES}}');
    });
  });

  it('replaces its own earlier export and refuses a folder it did not make', () => {
    const { dir } = exportTo('cv-translator');
    main(['cv-translator', `--to=${dir}`]);
    const stranger = fs.mkdtempSync(path.join(os.tmpdir(), 'stranger-'));
    fs.writeFileSync(path.join(stranger, 'notes.txt'), 'mine');
    expect(() => main(['cv-translator', `--to=${stranger}`])).toThrow(/not empty/);
    expect(fs.readFileSync(path.join(stranger, 'notes.txt'), 'utf-8')).toBe('mine');
  });

  it('names the skills that exist when given an unknown name', () => {
    expect(() => main(['no-such-skill'])).toThrow(/cv-translator/);
  });
});
