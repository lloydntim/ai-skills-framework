import { describe, expect, it } from 'vitest';
import { BENCHMARK_DIR, GOLDEN_DIR, loadCases, toCheckInput } from './cases-loader';
import { runDeterministicChecks } from '../src/deterministic-checks';
import { parsePhraseBank } from '../src/phrase-bank';
import { parsePreferenceBank } from '../src/preference-bank';
import { PRIVATE_PROFILE_PATH } from '../src/candidate-profile';
import { referenceLeftOutByExport } from '../src/reference-cv';
import { isMarket } from '../src/markets';
import type { EvalCase } from './types';

/**
 * Validates the golden cases themselves. A malformed case is worse than a missing one: it either
 * fails forever or passes vacuously, and either way it is discovered only after it has cost a run
 * of model calls. All of this is free and instant, so it runs with the ordinary unit tests.
 *
 * The golden cases are built from the candidate's real CV, so they are private regression inputs
 * in reference/evals/ and are checked against the candidate's own banks, not the fictional ones
 * the other tests use. An exported copy has neither, and skips this file.
 */
if (!referenceLeftOutByExport) process.env.COVER_LETTER_PROFILE = PRIVATE_PROFILE_PATH;
const cases = referenceLeftOutByExport ? [] : loadCases(GOLDEN_DIR);
const benchmarkCases: EvalCase[] = referenceLeftOutByExport ? [] : loadCases(BENCHMARK_DIR);

describe.skipIf(referenceLeftOutByExport)('golden cases', () => {
  it('loads every golden case file', () => {
    expect(cases.length).toBeGreaterThanOrEqual(5);
  });

  it('gives every case a unique id', () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(cases.map((c) => [c.id, c] as const))('%s is well formed', (_id, evalCase) => {
    expect(evalCase.category.length).toBeGreaterThan(0);
    expect(['en', 'de']).toContain(evalCase.language);
    expect(evalCase.cvText.length).toBeGreaterThan(0);
    expect(evalCase.roleDescription.length).toBeGreaterThan(0);
    expect(evalCase.instructions.length).toBeGreaterThan(0);
  });

  it.each(cases.map((c) => [c.id, c] as const))(
    '%s exists to prevent something specific',
    (_id, evalCase) => {
      // A golden case with nothing forbidden cannot catch a regression, which is its only job.
      expect(evalCase.forbiddenClaims?.length ?? 0).toBeGreaterThan(0);
    },
  );

  it.each(cases.map((c) => [c.id, c] as const))(
    '%s does not forbid something its own CV says',
    (_id, evalCase) => {
      // Self-contradictory cases can never be passed: the letter would have to omit a fact the CV
      // states in order to avoid a phrase the CV itself uses.
      const cv = evalCase.cvText.toLowerCase();
      const contradictions = (evalCase.forbiddenClaims ?? []).filter((claim) =>
        cv.includes(claim.toLowerCase()),
      );
      expect(contradictions).toEqual([]);
    },
  );

  it.each(cases.map((c) => [c.id, c] as const))(
    '%s uses a CV excerpt a faithful letter can quote without breaking the dash rule',
    (_id, evalCase) => {
      expect(evalCase.cvText).not.toMatch(/[—–]/);
    },
  );

  it.each(cases.map((c) => [c.id, c] as const))(
    '%s sets a coherent length range',
    (_id, evalCase) => {
      if (evalCase.minWords !== undefined && evalCase.maxWords !== undefined) {
        expect(evalCase.minWords).toBeLessThan(evalCase.maxWords);
      }
    },
  );

  it.each(cases.map((c) => [c.id, c] as const))(
    '%s names a known market when one is given',
    (_id, evalCase) => {
      if (evalCase.market !== undefined) expect(isMarket(evalCase.market)).toBe(true);
    },
  );
});

/**
 * The 'by-task' skill-context selector (src/skill-sections.ts) keys on a case's language and
 * market together, so the suite must actually contain both a DACH and a UK/Ireland case, in both
 * languages where the case's language permits — otherwise a regression in market-specific
 * selection could pass unnoticed. This does not duplicate the per-case checks above; it only
 * asserts the combinations exist across the suite.
 */
describe.skipIf(referenceLeftOutByExport)('market coverage across golden and benchmark cases', () => {
  const allCases = [...cases, ...benchmarkCases];

  it('includes at least one DACH case in English and one in German', () => {
    expect(allCases.some((c) => c.market === 'dach' && c.language === 'en')).toBe(true);
    expect(allCases.some((c) => c.market === 'dach' && c.language === 'de')).toBe(true);
  });

  it('includes at least one UK or Ireland case', () => {
    expect(allCases.some((c) => c.market === 'uk' || c.market === 'ie')).toBe(true);
  });
});

describe.skipIf(referenceLeftOutByExport)('benchmark cases', () => {
  it('loads every benchmark case file', () => {
    expect(benchmarkCases.length).toBeGreaterThanOrEqual(5);
  });

  it('gives every case a unique id', () => {
    const ids = benchmarkCases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(benchmarkCases.map((c) => [c.id, c] as const))('%s names a known market when one is given', (_id, evalCase) => {
    if (evalCase.market !== undefined) expect(isMarket(evalCase.market)).toBe(true);
  });
});

describe.skipIf(referenceLeftOutByExport)('golden cases against the checks', () => {
  it('reports a fabricated letter as failing on the case that guards it', () => {
    const ownership = cases.find((c) => c.id === 'golden-ownership-001');
    expect(ownership).toBeDefined();

    const badDraft =
      'Dear Hiring Manager, I led the launch of a crypto gaming wallet in React ' +
      'Native, shipping 45 screens to 2 million users.';
    const result = runDeterministicChecks(toCheckInput(ownership!, badDraft));

    expect(result.matchedForbiddenClaims).toContain('led the launch');
    expect(result.unsupportedNumbers).toEqual(expect.arrayContaining(['45', '2']));
    expect(result.missingExactStrings).toContain('Northwind Labs');
    expect(result.pass).toBe(false);
  });

  it('accepts a draft that keeps the CV ownership level and invents nothing', () => {
    const ownership = cases.find((c) => c.id === 'golden-ownership-001');
    // The employer is one of the case's required terms; read from the private case, not repeated here.
    const employer = ownership!.requiredTerms!.find((term) => term !== 'React Native');
    // A full house-format letter, not a fragment: the case opts in to the structural check, so a
    // draft without the format's fixed markers is correctly rejected however clean its claims are.
    const goodDraft = [
      'Application for Senior Product Engineer',
      'Northwind Labs',
      '',
      'Dear Northwind Labs Team,',
      '',
      `At ${employer} I helped take a crypto gaming wallet from early development to beta release,`,
      'building the React Native iOS and web wallet across roughly 20 screens.',
      '',
      'Kind regards,',
      'The Candidate',
    ].join('\n');
    const result = runDeterministicChecks(toCheckInput(ownership!, goodDraft));

    expect(result.matchedForbiddenClaims).toEqual([]);
    expect(result.unsupportedNumbers).toEqual([]);
    expect(result.unsupportedTechnologies).toEqual([]);
    expect(result.pass).toBe(true);
  });
});

describe.skipIf(referenceLeftOutByExport)('the phrase bank against the golden cases', () => {
  it('accepts a phrase whose triggers the spec actually contains', () => {
    const metric = cases.find((c) => c.id === 'golden-metric-001');
    const performance = parsePhraseBank().find((p) => p.id === 'performance-seo');
    expect(performance).toBeDefined();

    // This advert asks about Core Web Vitals and CMS authoring, so the performance phrase applies.
    const draft = `I am applying to Cadence Commerce. ${performance!.phrase}`;
    const result = runDeterministicChecks(toCheckInput(metric!, draft));

    expect(result.usedStandardPhrases).toContain('performance-seo');
    expect(result.untriggeredPhrases).toEqual([]);
  });

  it('flags a phrase dropped into a spec that never asked for it', () => {
    const metric = cases.find((c) => c.id === 'golden-metric-001');
    const bilingual = parsePhraseBank().find((p) => p.id === 'bilingual-dach');

    // The Cadence Commerce advert says nothing about German or DACH. Pasting this phrase in is
    // how a letter stops answering the advert and starts listing the candidate's greatest hits.
    const draft = `I am applying to Cadence Commerce. ${bilingual!.phrase}`;
    const result = runDeterministicChecks(toCheckInput(metric!, draft));

    expect(result.untriggeredPhrases).toEqual(['bilingual-dach']);
  });

  it('applies the German advert to the bilingual phrase, which it does trigger', () => {
    const german = cases.find((c) => c.id === 'golden-german-001');
    const bilingual = parsePhraseBank().find((p) => p.id === 'bilingual-dach');

    const draft = `Hanseatic Digital. ${bilingual!.phrase}`;
    const result = runDeterministicChecks(toCheckInput(german!, draft));

    expect(result.usedStandardPhrases).toContain('bilingual-dach');
    expect(result.untriggeredPhrases).toEqual([]);
  });
});

describe.skipIf(referenceLeftOutByExport)('the preference bank against the golden cases', () => {
  it('fails a letter claiming remote work at an on-site employer', () => {
    const onSite = cases.find((c) => c.id === 'golden-preference-001')!;
    const remote = parsePreferenceBank().find((p) => p.id === 'remote-work')!;

    const draft = [
      'Application for Senior Frontend Engineer',
      'Kirchner Systeme GmbH',
      '',
      'Dear Kirchner Systeme Team,',
      '',
      `I established a React architecture. ${remote.sentence}`,
      '',
      'Kind regards,',
      'The Candidate',
    ].join('\n');

    const result = runDeterministicChecks(toCheckInput(onSite, draft));

    expect(result.unofferedPreferences).toEqual(['remote-work']);
    expect(result.pass).toBe(false);
  });

  it('accepts the benefits that employer does offer', () => {
    const onSite = cases.find((c) => c.id === 'golden-preference-001')!;
    const bank = parsePreferenceBank();
    const offered = ['learning-budget', 'international-team', 'flexible-hours'].map(
      (id) => bank.find((p) => p.id === id)!.sentence,
    );

    const draft = [
      'Application for Senior Frontend Engineer',
      'Kirchner Systeme GmbH',
      '',
      'Dear Kirchner Systeme Team,',
      '',
      `I established a React architecture. ${offered.join(' ')}`,
      '',
      'Kind regards,',
      'The Candidate',
    ].join('\n');

    const result = runDeterministicChecks(toCheckInput(onSite, draft));

    expect(result.unofferedPreferences).toEqual([]);
    expect(result.usedPreferences).toEqual(
      expect.arrayContaining(['learning-budget', 'international-team', 'flexible-hours']),
    );
  });
});
