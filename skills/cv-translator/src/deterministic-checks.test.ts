import { describe, expect, it } from 'vitest';
import { runDeterministicChecks } from './deterministic-checks';

describe('required exact strings', () => {
  it('passes when every required string appears verbatim', () => {
    const result = runDeterministicChecks({
      output: 'Reduced build times by 40% across 12 services.',
      requiredExactStrings: ['40%', '12'],
    });

    expect(result.missingExactStrings).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('reports a required string that is absent', () => {
    const result = runDeterministicChecks({
      output: 'Reduced build times substantially.',
      requiredExactStrings: ['40%'],
    });

    expect(result.missingExactStrings).toEqual(['40%']);
    expect(result.pass).toBe(false);
  });

  it('is case-sensitive, so a changed capitalisation counts as missing', () => {
    const result = runDeterministicChecks({
      output: 'Built the platform in typescript.',
      requiredExactStrings: ['TypeScript'],
    });

    expect(result.missingExactStrings).toEqual(['TypeScript']);
  });
});

describe('required terms', () => {
  it('matches regardless of capitalisation', () => {
    const result = runDeterministicChecks({
      output: 'Migrated the estate to Kubernetes.',
      requiredTerms: ['kubernetes'],
    });

    expect(result.missingTerms).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('reports a term that is absent in any casing', () => {
    const result = runDeterministicChecks({
      output: 'Migrated the estate to containers.',
      requiredTerms: ['kubernetes'],
    });

    expect(result.missingTerms).toEqual(['kubernetes']);
    expect(result.pass).toBe(false);
  });
});

describe('forbidden claims', () => {
  it('flags a forbidden claim regardless of capitalisation', () => {
    const result = runDeterministicChecks({
      output: 'Was the Sole Architect of the payments platform.',
      forbiddenClaims: ['sole architect'],
    });

    expect(result.matchedForbiddenClaims).toEqual(['sole architect']);
    expect(result.pass).toBe(false);
  });

  it('passes when no forbidden claim appears', () => {
    const result = runDeterministicChecks({
      output: 'Contributed to the architecture of the payments platform.',
      forbiddenClaims: ['sole architect'],
    });

    expect(result.matchedForbiddenClaims).toEqual([]);
    expect(result.pass).toBe(true);
  });
});

describe('forbidden characters', () => {
  it('flags a forbidden character and fails the check', () => {
    const result = runDeterministicChecks({
      output: 'Led the team — and shipped on time.',
      forbiddenCharacters: ['—'],
    });

    expect(result.matchedForbiddenCharacters).toEqual(['—']);
    expect(result.pass).toBe(false);
  });

  it('passes when the character is absent', () => {
    const result = runDeterministicChecks({
      output: 'Led the team and shipped on time.',
      forbiddenCharacters: ['—'],
    });

    expect(result.matchedForbiddenCharacters).toEqual([]);
    expect(result.pass).toBe(true);
  });
});

describe('length ratio', () => {
  it('reports the output-to-source ratio and flags an overlong output', () => {
    const result = runDeterministicChecks({
      output: 'a'.repeat(150),
      sourceText: 'b'.repeat(100),
      maxLengthRatio: 1.2,
    });

    expect(result.lengthRatio).toBeCloseTo(1.5);
    expect(result.lengthExceeded).toBe(true);
  });

  it('does not fail the overall check when only the length is exceeded', () => {
    const result = runDeterministicChecks({
      output: 'a'.repeat(150),
      sourceText: 'b'.repeat(100),
      maxLengthRatio: 1.2,
    });

    expect(result.lengthExceeded).toBe(true);
    expect(result.pass).toBe(true);
  });

  it('leaves the ratio undefined when no maximum is configured', () => {
    const result = runDeterministicChecks({
      output: 'a'.repeat(150),
      sourceText: 'b'.repeat(100),
    });

    expect(result.lengthRatio).toBeUndefined();
    expect(result.lengthExceeded).toBe(false);
  });

  it('leaves the ratio undefined when no source text is given', () => {
    const result = runDeterministicChecks({
      output: 'a'.repeat(150),
      maxLengthRatio: 1.2,
    });

    expect(result.lengthRatio).toBeUndefined();
    expect(result.lengthExceeded).toBe(false);
  });
});

describe('bold markers', () => {
  it('passes when the output keeps the same number of bold markers', () => {
    const result = runDeterministicChecks({
      sourceText: '- **Führung**: Team von acht Entwicklern geleitet.',
      output: '- **Leadership**: Led a team of eight engineers.',
    });

    expect(result.sourceBoldMarkerCount).toBe(2);
    expect(result.outputBoldMarkerCount).toBe(2);
    expect(result.boldMarkerMismatch).toBe(false);
    expect(result.pass).toBe(true);
  });

  it('fails when the output drops the bold label', () => {
    const result = runDeterministicChecks({
      sourceText: '- **Führung**: Team von acht Entwicklern geleitet.',
      output: '- Leadership: Led a team of eight engineers.',
    });

    expect(result.outputBoldMarkerCount).toBe(0);
    expect(result.boldMarkerMismatch).toBe(true);
    expect(result.pass).toBe(false);
  });

  it('fails when the output adds bold formatting the source did not have', () => {
    const result = runDeterministicChecks({
      sourceText: 'Team von acht Entwicklern geleitet.',
      output: '**Led** a team of eight engineers.',
    });

    expect(result.boldMarkerMismatch).toBe(true);
    expect(result.pass).toBe(false);
  });

  it('does not flag plain prose that uses no bold markers at all', () => {
    const result = runDeterministicChecks({
      sourceText: 'Team von acht Entwicklern geleitet.',
      output: 'Led a team of eight engineers.',
    });

    expect(result.sourceBoldMarkerCount).toBe(0);
    expect(result.outputBoldMarkerCount).toBe(0);
    expect(result.boldMarkerMismatch).toBe(false);
    expect(result.pass).toBe(true);
  });
});

describe('paragraph and entry structure', () => {
  it('passes when the output keeps the same number of blocks', () => {
    const result = runDeterministicChecks({
      sourceText: '- Erster Punkt\n- Zweiter Punkt\n- Dritter Punkt',
      output: '- First point\n- Second point\n- Third point',
    });

    expect(result.sourceParagraphBreakCount).toBe(2);
    expect(result.outputParagraphBreakCount).toBe(2);
    expect(result.paragraphBreakMismatch).toBe(false);
    expect(result.pass).toBe(true);
  });

  it('fails when the output merges two entries into one', () => {
    const result = runDeterministicChecks({
      sourceText: '- Erster Punkt\n- Zweiter Punkt\n- Dritter Punkt',
      output: '- First point and second point\n- Third point',
    });

    expect(result.outputParagraphBreakCount).toBe(1);
    expect(result.paragraphBreakMismatch).toBe(true);
    expect(result.pass).toBe(false);
  });

  it('treats single and blank-line separators as equivalent', () => {
    const result = runDeterministicChecks({
      sourceText: 'Erster Absatz.\nZweiter Absatz.',
      output: 'First paragraph.\n\nSecond paragraph.',
    });

    expect(result.paragraphBreakMismatch).toBe(false);
    expect(result.pass).toBe(true);
  });

  it('ignores trailing whitespace-only lines', () => {
    const result = runDeterministicChecks({
      sourceText: 'Erster Absatz.\n\nZweiter Absatz.',
      output: 'First paragraph.\n\nSecond paragraph.\n   \n',
    });

    expect(result.paragraphBreakMismatch).toBe(false);
    expect(result.pass).toBe(true);
  });

  it('does not flag single-block prose', () => {
    const result = runDeterministicChecks({
      sourceText: 'Ein einzelner Absatz ohne Umbrueche.',
      output: 'A single paragraph with no breaks.',
    });

    expect(result.sourceParagraphBreakCount).toBe(0);
    expect(result.outputParagraphBreakCount).toBe(0);
    expect(result.paragraphBreakMismatch).toBe(false);
  });
});

describe('repeated entry openers', () => {
  it('flags a word that opens more than one entry', () => {
    const result = runDeterministicChecks({
      output: ['- Led the platform migration', '- Led the design system rollout', '- Shipped 12 releases'].join('\n'),
    });

    expect(result.repeatedEntryOpeners).toEqual(['led']);
  });

  it('ignores the capitalisation of the opening word', () => {
    const result = runDeterministicChecks({
      output: ['- Led the platform migration', '- led the design system rollout', '- Shipped 12 releases'].join('\n'),
    });

    expect(result.repeatedEntryOpeners).toEqual(['led']);
  });

  it('stays quiet on a list of fewer than three entries', () => {
    const result = runDeterministicChecks({
      output: ['- Led the platform migration', '- Led the design system rollout'].join('\n'),
    });

    expect(result.repeatedEntryOpeners).toEqual([]);
  });

  it('compares the first word after a bold label, not the label itself', () => {
    const result = runDeterministicChecks({
      output: [
        '- **Delivery**: Led the platform migration',
        '- **Design**: Led the design system rollout',
        '- **Releases**: Shipped 12 releases',
      ].join('\n'),
      sourceText: [
        '- **Delivery**: Led the platform migration',
        '- **Design**: Led the design system rollout',
        '- **Releases**: Shipped 12 releases',
      ].join('\n'),
    });

    expect(result.repeatedEntryOpeners).toEqual(['led']);
  });

  it('allows an entry to echo a word from its own label', () => {
    const result = runDeterministicChecks({
      output: [
        '- **Leadership**: Leadership of a team of eight engineers',
        '- **Delivery**: Shipped 12 releases',
        '- **Mentoring**: Coached three junior developers',
      ].join('\n'),
    });

    expect(result.repeatedEntryOpeners).toEqual([]);
  });

  it('recognises bullet, dash and asterisk markers alike', () => {
    const result = runDeterministicChecks({
      output: ['• Led the migration', '- Led the rollout', '* Shipped 12 releases'].join('\n'),
    });

    expect(result.repeatedEntryOpeners).toEqual(['led']);
  });

  it('reports every repeated opener in a longer list', () => {
    const result = runDeterministicChecks({
      output: [
        '- Led the platform migration',
        '- Led the design system rollout',
        '- Built the reporting pipeline',
        '- Built the alerting stack',
      ].join('\n'),
    });

    expect(result.repeatedEntryOpeners.sort()).toEqual(['built', 'led']);
  });

  it('does not flag prose that has no bullet list', () => {
    const result = runDeterministicChecks({
      output: 'Led the platform migration. Led the design system rollout. Led the hiring round.',
    });

    expect(result.repeatedEntryOpeners).toEqual([]);
  });

  it('never affects the overall pass flag', () => {
    const result = runDeterministicChecks({
      output: ['- Led the platform migration', '- Led the design system rollout', '- Led the hiring round'].join('\n'),
    });

    expect(result.repeatedEntryOpeners).toEqual(['led']);
    expect(result.pass).toBe(true);
  });
});

describe('defaults', () => {
  it('passes an empty output when nothing is required or forbidden', () => {
    const result = runDeterministicChecks({ output: '' });

    expect(result).toMatchObject({
      pass: true,
      missingExactStrings: [],
      missingTerms: [],
      matchedForbiddenClaims: [],
      matchedForbiddenCharacters: [],
      lengthExceeded: false,
      boldMarkerMismatch: false,
      paragraphBreakMismatch: false,
      repeatedEntryOpeners: [],
    });
  });

  it('leaves the source-dependent counts undefined when no source text is given', () => {
    const result = runDeterministicChecks({ output: 'Led a team of eight engineers.' });

    expect(result.sourceBoldMarkerCount).toBeUndefined();
    expect(result.outputBoldMarkerCount).toBeUndefined();
    expect(result.sourceParagraphBreakCount).toBeUndefined();
    expect(result.outputParagraphBreakCount).toBeUndefined();
  });

  it('collects every kind of failure at once', () => {
    const result = runDeterministicChecks({
      output: 'Sole architect of the platform — delivered fast.',
      sourceText: '**Alleiniger** Architekt der Plattform.',
      requiredExactStrings: ['40%'],
      requiredTerms: ['kubernetes'],
      forbiddenClaims: ['sole architect'],
      forbiddenCharacters: ['—'],
    });

    expect(result.missingExactStrings).toEqual(['40%']);
    expect(result.missingTerms).toEqual(['kubernetes']);
    expect(result.matchedForbiddenClaims).toEqual(['sole architect']);
    expect(result.matchedForbiddenCharacters).toEqual(['—']);
    expect(result.boldMarkerMismatch).toBe(true);
    expect(result.pass).toBe(false);
  });
});
