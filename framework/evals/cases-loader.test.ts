import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCases } from './cases-loader';

interface EvalCase {
  id: string;
  category: string;
  sourceLanguage: string;
  targetLanguage: string;
  input: string;
  instructions: string;
  [key: string]: unknown;
}


function minimalCase(overrides: Partial<EvalCase> & { id: string }): EvalCase {
  return {
    category: 'translation',
    sourceLanguage: 'de',
    targetLanguage: 'en',
    input: 'Kurzer Lebenslaufabschnitt.',
    instructions: 'Translate faithfully.',
    ...overrides,
  };
}

describe('loadCases', () => {
  let dir: string;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads every .json file in the directory and concatenates their cases', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-loader-'));
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify([minimalCase({ id: 'case-1' })]));
    fs.writeFileSync(
      path.join(dir, 'b.json'),
      JSON.stringify([minimalCase({ id: 'case-2' }), minimalCase({ id: 'case-3' })])
    );

    const cases = loadCases(dir);

    expect(cases.map((c) => c.id)).toEqual(['case-1', 'case-2', 'case-3']);
  });

  it('ignores non-JSON files in the directory', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-loader-'));
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify([minimalCase({ id: 'case-1' })]));
    fs.writeFileSync(path.join(dir, '.gitkeep'), '');
    fs.writeFileSync(path.join(dir, 'README.md'), '# not a case file');

    expect(loadCases(dir).map((c) => c.id)).toEqual(['case-1']);
  });

  it('returns an empty array for a directory with no case files', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-loader-'));
    fs.writeFileSync(path.join(dir, '.gitkeep'), '');

    expect(loadCases(dir)).toEqual([]);
  });

  it('preserves every field of a case exactly as authored', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-loader-'));
    const kase = minimalCase({
      id: 'case-1',
      expectedFacts: ['fact one'],
      requiredExactStrings: ['Northwind Labs'],
      maxLengthRatio: 1.5,
    });
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify([kase]));

    expect(loadCases(dir)[0]).toEqual(kase);
  });

  it('throws a clear error naming both files when a case id repeats within one file', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-loader-'));
    fs.writeFileSync(
      path.join(dir, 'a.json'),
      JSON.stringify([minimalCase({ id: 'dup' }), minimalCase({ id: 'dup' })])
    );

    expect(() => loadCases(dir)).toThrow(/Duplicate case id "dup" in a\.json \(already defined in a\.json\)/);
  });

  it('throws a clear error naming both files when a case id repeats across two files', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-loader-'));
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify([minimalCase({ id: 'dup' })]));
    fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify([minimalCase({ id: 'dup' })]));

    expect(() => loadCases(dir)).toThrow(/Duplicate case id "dup" in b\.json \(already defined in a\.json\)/);
  });

  it('does not throw when ids merely look similar but differ', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-loader-'));
    fs.writeFileSync(
      path.join(dir, 'a.json'),
      JSON.stringify([minimalCase({ id: 'golden-001' }), minimalCase({ id: 'golden-0011' })])
    );

    expect(() => loadCases(dir)).not.toThrow();
  });
});
