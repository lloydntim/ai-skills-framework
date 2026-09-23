import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePhraseBank } from './phrase-bank';
import { loadSkillPrompt } from './skill-loader';
import { loadCandidateProfile, PRIVATE_PROFILE_PATH } from './candidate-profile';
import { loadReferenceCv, referenceLeftOutByExport } from './reference-cv';
import { runDeterministicChecks } from './deterministic-checks';

/**
 * The phrase bank as the model sees it: the table in SKILL.md, filled with the profile's rows. The
 * format tests run against the fictional candidate (see vitest.config.ts); the tests further down
 * check the real candidate's bank against their real CV and are skipped in an exported copy.
 */
const CV_FACTS_PATH = path.join(__dirname, '..', 'reference', 'evals', 'cv-facts.json');
const realBank = () => parsePhraseBank(loadSkillPrompt(undefined, loadCandidateProfile(PRIVATE_PROFILE_PATH)));

describe('parsing the shipped phrase bank', () => {
  const bank = parsePhraseBank();

  it('reads the phrases out of the skill', () => {
    expect(bank.length).toBeGreaterThan(0);
  });

  it('gives every phrase a unique id', () => {
    const ids = bank.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('drops the header and separator rows', () => {
    expect(bank.map((p) => p.id)).not.toContain('ID');
    expect(bank.every((p) => !/^-+$/.test(p.id))).toBe(true);
  });

  it.each(parsePhraseBank().map((p) => [p.id, p] as const))(
    '%s has triggers, a phrase, and a CV anchor',
    (_id, phrase) => {
      expect(phrase.triggers.length).toBeGreaterThan(0);
      expect(phrase.phrase.length).toBeGreaterThan(20);
      expect(phrase.cvAnchor.length).toBeGreaterThan(0);
    },
  );

  it.each(parsePhraseBank().map((p) => [p.id, p] as const))(
    '%s does not smuggle in a dash the skill forbids',
    (_id, phrase) => {
      expect(phrase.phrase).not.toMatch(/[—–]/);
    },
  );

  it('keeps the bank in the skill the model is given, so there is one source to edit', () => {
    expect(loadSkillPrompt()).toContain('## Standard phrases');
  });
});

describe('parser robustness', () => {
  const table = (rows: string) => `## Standard phrases

| ID | Spec triggers | Phrase | German | CV anchor |
|---|---|---|---|---|
${rows}

## Next section
Not part of the bank.
`;

  it('splits comma-separated triggers and trims them', () => {
    const bank = parsePhraseBank(
      table('| perf |  speed , Lighthouse ,SEO | A phrase long enough to be real. | - | Northwind |'),
    );

    expect(bank).toHaveLength(1);
    expect(bank[0].triggers).toEqual(['speed', 'Lighthouse', 'SEO']);
  });

  it('skips a row with the wrong number of columns rather than guessing', () => {
    const bank = parsePhraseBank(
      table(
        '| broken | speed | missing the anchor column |\n' +
          '| good | speed | A phrase long enough to be real. | - | Northwind |',
      ),
    );

    expect(bank.map((p) => p.id)).toEqual(['good']);
  });

  it('skips a row with no phrase text', () => {
    const bank = parsePhraseBank(table('| empty | speed |  | - | Northwind |'));

    expect(bank).toEqual([]);
  });

  it('stops at the next heading and does not absorb later sections', () => {
    const bank = parsePhraseBank(
      table('| good | speed | A phrase long enough to be real. | - | Northwind |') +
        '\n| stray | x | This row is after the section. | - | Y |\n',
    );

    expect(bank.map((p) => p.id)).toEqual(['good']);
  });

  it('returns nothing when the document has no phrase bank', () => {
    expect(parsePhraseBank('# A skill with no phrases\n\n## Role\nDo the thing.')).toEqual([]);
  });
});

describe.skipIf(referenceLeftOutByExport)("the candidate's phrase bank against the reference CV", () => {
  const bank = referenceLeftOutByExport ? [] : realBank();
  const cv = referenceLeftOutByExport ? '' : loadReferenceCv();

  it('reads every row out of the profile', () => {
    expect(bank.length).toBeGreaterThanOrEqual(10);
  });

  it.each(bank.map((p) => [p.id, p] as const))(
    '%s is anchored to evidence the CV still contains',
    (_id, phrase) => {
      // The check that makes reference/cv.md worth keeping. Drop a role from the CV and the phrase
      // anchored to it fails here in under a second, rather than going out inside a letter.
      const result = runDeterministicChecks({
        output: phrase.phrase,
        cvText: cv,
        standardPhrases: [phrase],
      });

      expect(result.phrasesWithoutCvSupport).toEqual([]);
    },
  );

  it.each(bank.map((p) => [p.id, p] as const))(
    '%s names no technology the CV lacks',
    (_id, phrase) => {
      const result = runDeterministicChecks({ output: phrase.phrase, cvText: cv });

      expect(result.unsupportedTechnologies).toEqual([]);
    },
  );

  it.each(bank.map((p) => [p.id, p] as const))(
    '%s quotes no number the CV lacks',
    (_id, phrase) => {
      const result = runDeterministicChecks({ output: phrase.phrase, cvText: cv });

      expect(result.unsupportedNumbers).toEqual([]);
    },
  );

  it('fails loudly if the reference CV goes missing', () => {
    expect(() => loadReferenceCv('/no/such/cv.md')).toThrow(/Reference CV not found/);
  });
});

describe.skipIf(referenceLeftOutByExport)('the reference CV transcription', () => {
  // The load-bearing facts. reference/cv.md is generated from a PDF, so it can drift from the real
  // CV. The golden cases and the profile's hard-rule examples are built on specific numbers and
  // ownership wordings, listed in reference/evals/cv-facts.json (private, like the CV itself): if
  // one changes, the cases are testing against a fiction. A transcription that upgraded an
  // ownership wording would quietly authorise the letter to upgrade it too.
  const cv = referenceLeftOutByExport ? '' : loadReferenceCv();
  const pinned: { facts: [string, string][]; ownershipWordings: [string, string][] } = referenceLeftOutByExport
    ? { facts: [], ownershipWordings: [] }
    : JSON.parse(fs.readFileSync(CV_FACTS_PATH, 'utf-8'));

  it.each(pinned.facts)('still states the %s', (_label, fact) => {
    expect(cv).toContain(fact);
  });

  it.each(pinned.ownershipWordings)('preserves the %s ownership wording', (_label, wording) => {
    expect(cv).toContain(wording);
  });
});

describe('the German column', () => {
  const bank = parsePhraseBank();

  it('carries the approved German for the rows that have one', () => {
    const testing = bank.find((p) => p.id === 'testing-quality')!;
    expect(testing.phraseDe).toContain('Testabdeckung');
  });

  it('leaves German undefined rather than storing the "-" placeholder', () => {
    const noGerman = bank.filter((p) => p.phraseDe === undefined);
    expect(noGerman.length).toBeGreaterThan(0);
    expect(bank.every((p) => p.phraseDe !== '-')).toBe(true);
  });

  it('detects a German letter using the approved German wording', () => {
    const testing = bank.find((p) => p.id === 'testing-quality')!;
    const result = runDeterministicChecks({
      output: `Bewerbung. ${testing.phraseDe}`,
      cvText: 'CONTOSO BANK. Introduced Vitest and code reviews, coverage from 20% to 65%.',
      standardPhrases: [testing],
      roleDescription: 'Wir legen Wert auf Testabdeckung und Code Review.',
    });

    expect(result.usedStandardPhrases).toEqual(['testing-quality']);
    expect(result.untriggeredPhrases).toEqual([]);
  });
});

describe.skipIf(referenceLeftOutByExport)("the candidate's German column", () => {
  const bank = referenceLeftOutByExport ? [] : realBank();

  it('carries the approved German for the testing row', () => {
    expect(bank.find((p) => p.id === 'testing-quality')?.phraseDe).toBeDefined();
  });

  it.each(bank.filter((p) => p.phraseDe).map((p) => [p.id, p] as const))(
    '%s German wording carries no dash the skill forbids',
    (_id, phrase) => {
      expect(phrase.phraseDe).not.toMatch(/[—–]/);
    },
  );

  it('holds the phrase moved out of the preference bank', () => {
    // The product-ownership sentence replaced one that asked the employer for a permanent
    // position. The new wording claims nothing about the employer, so gating it on "permanent"
    // appearing in a spec would fail letters it is perfectly true for.
    expect(bank.find((p) => p.id === 'product-ownership')).toBeDefined();
  });

  it('detects a German letter using the approved German wording', () => {
    const testing = bank.find((p) => p.id === 'testing-quality')!;
    const result = runDeterministicChecks({
      output: `Bewerbung. ${testing.phraseDe}`,
      cvText: loadReferenceCv(),
      standardPhrases: [testing],
      roleDescription: 'Wir legen Wert auf Testabdeckung und Code Review.',
    });

    expect(result.usedStandardPhrases).toEqual(['testing-quality']);
    expect(result.untriggeredPhrases).toEqual([]);
  });
});
