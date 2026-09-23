import { describe, expect, it } from 'vitest';
import { parsePreferenceBank } from './preference-bank';
import { runDeterministicChecks } from './deterministic-checks';
import { loadCandidateProfile, PRIVATE_PROFILE_PATH } from './candidate-profile';
import { loadSkillPrompt } from './skill-loader';
import { referenceLeftOutByExport } from './reference-cv';

// Runs against the fictional candidate (see vitest.config.ts), except where it says otherwise.
describe('the shipped preference bank', () => {
  const bank = parsePreferenceBank();

  it('reads the preferences out of the skill', () => {
    expect(bank.length).toBeGreaterThan(0);
  });

  it('gives every preference a unique id', () => {
    const ids = bank.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers the preferences that were asked for by name', () => {
    const ids = bank.map((p) => p.id);
    expect(ids).toContain('remote-work');
    expect(ids).toContain('learning-budget');
    expect(ids).toContain('international-team');
  });

  it.each(parsePreferenceBank().map((p) => [p.id, p] as const))(
    '%s has signals in both languages and a usable sentence',
    (_id, pref) => {
      expect(pref.signals.length).toBeGreaterThanOrEqual(5);
      expect(pref.sentence.length).toBeGreaterThan(30);
      expect(pref.sentence).not.toMatch(/[—–]/);
    },
  );

  it.each(parsePreferenceBank().map((p) => [p.id, p] as const))(
    '%s states a want rather than an unverifiable metric',
    (_id, pref) => {
      // Preferences are about what the candidate wants, so they carry no CV anchor. That only
      // holds while they avoid factual claims, which would then be ungrounded. A number in a
      // preference sentence is the signal that one has crept in.
      const result = runDeterministicChecks({ output: pref.sentence, cvText: 'irrelevant' });
      expect(result.unsupportedNumbers).toEqual([]);
    },
  );
});

describe('preferences against the spec', () => {
  const remote = parsePreferenceBank().find((p) => p.id === 'remote-work')!;
  const learning = parsePreferenceBank().find((p) => p.id === 'learning-budget')!;

  it('accepts a preference the spec actually offers', () => {
    const result = runDeterministicChecks({
      output: `I am applying. ${remote.sentence}`,
      roleDescription: 'Senior Engineer, fully remote across the EU.',
      preferences: [remote],
    });

    expect(result.usedPreferences).toEqual(['remote-work']);
    expect(result.unofferedPreferences).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('fails a preference the spec never offered, unlike an off-target phrase', () => {
    // Telling a five-days-on-site employer that their remote culture appeals is not a relevance
    // miss, it is a false statement about them. That is why this is hard and untriggeredPhrases
    // is soft.
    const result = runDeterministicChecks({
      output: `I am applying. ${remote.sentence}`,
      roleDescription: 'Senior Engineer, on site in Munich five days a week.',
      preferences: [remote],
    });

    expect(result.unofferedPreferences).toEqual(['remote-work']);
    expect(result.pass).toBe(false);
  });

  it('matches a German signal for the same preference', () => {
    const result = runDeterministicChecks({
      output: `Bewerbung. ${learning.sentence}`,
      roleDescription: 'Wir bieten ein jährliches Weiterbildungsbudget und Gleitzeit.',
      preferences: [learning],
    });

    expect(result.unofferedPreferences).toEqual([]);
  });

  it('does not credit an employer on a word that only looks like a signal', () => {
    const result = runDeterministicChecks({
      output: `Hello. ${remote.sentence}`,
      roleDescription: 'You will work on remotely triggered firmware updates, on site in Bern.',
      preferences: [remote],
    });

    // "remotely" is not "remote": the word-boundary check is what keeps this from passing.
    expect(result.unofferedPreferences).toEqual(['remote-work']);
  });

  it('skips the check when no spec is supplied', () => {
    const result = runDeterministicChecks({
      output: `I am applying. ${remote.sentence}`,
      preferences: [remote],
    });

    expect(result.usedPreferences).toEqual(['remote-work']);
    expect(result.unofferedPreferences).toEqual([]);
  });

  it('does not report a preference the model adapted to the employer wording', () => {
    const result = runDeterministicChecks({
      output: 'Your remote-first setup is a real draw, and it is how I already work.',
      roleDescription: 'Fully remote team.',
      preferences: [remote],
    });

    expect(result.usedPreferences).toEqual([]);
  });
});

describe('German spelling variants', () => {
  const early = parsePreferenceBank().find((p) => p.id === 'early-stage')!;
  const learning = parsePreferenceBank().find((p) => p.id === 'learning-budget')!;

  it.each([
    ['umlaut spelling', 'Du arbeitest direkt mit unserem Gründer zusammen.'],
    ['transcribed spelling', 'Du arbeitest direkt mit unserem Gruender zusammen.'],
  ])('matches a signal written with the %s', (_label, spec) => {
    const result = runDeterministicChecks({
      output: `Bewerbung. ${early.sentence}`,
      roleDescription: spec,
      preferences: [early],
    });

    expect(result.unofferedPreferences).toEqual([]);
  });

  it.each([
    ['umlaut spelling', 'Wir bieten ein jährliches Weiterbildungsbudget.'],
    ['transcribed spelling', 'Wir bieten ein jaehrliches Weiterbildungsbudget.'],
  ])('matches a budget signal written with the %s', (_label, spec) => {
    const result = runDeterministicChecks({
      output: `Bewerbung. ${learning.sentence}`,
      roleDescription: spec,
      preferences: [learning],
    });

    expect(result.unofferedPreferences).toEqual([]);
  });

  it('still refuses a preference the spec genuinely does not offer', () => {
    const result = runDeterministicChecks({
      output: `Bewerbung. ${learning.sentence}`,
      roleDescription: 'Wir suchen Verstaerkung fuer unser Team in Muenchen. Vor Ort.',
      preferences: [learning],
    });

    expect(result.unofferedPreferences).toEqual(['learning-budget']);
  });
});

describe('the German column', () => {
  const bank = parsePreferenceBank();

  it('carries the approved German for the collaboration preference', () => {
    const collab = bank.find((p) => p.id === 'design-product-collaboration')!;
    expect(collab.sentenceDe).toBeDefined();
  });

  it('no longer asks the employer for a permanent position', () => {
    // The replacement wording states how the candidate likes to work rather than what they want
    // from the employer, so it belongs in the phrase bank where relevance is soft, not here where
    // an absent spec signal is a hard failure.
    expect(bank.map((p) => p.id)).not.toContain('permanent-long-term');
  });

  it('gates the German wording on the same spec signals as the English', () => {
    const collab = bank.find((p) => p.id === 'design-product-collaboration')!;
    const result = runDeterministicChecks({
      output: `Bewerbung. ${collab.sentenceDe}`,
      roleDescription: 'Wir suchen jemanden fuer die Wartung unserer Server. Keine Produktarbeit.',
      preferences: [collab],
    });

    expect(result.unofferedPreferences).toEqual(['design-product-collaboration']);
    expect(result.pass).toBe(false);
  });
});

describe('inflected forms in the spec', () => {
  const collab = parsePreferenceBank().find((p) => p.id === 'design-product-collaboration')!;

  it.each([
    ['singular', 'You will work with a product manager and a designer.'],
    ['plural', 'Collaborate closely with product managers, designers, and engineers.'],
    ['German plural', 'Du arbeitest eng mit Designern und dem Produktteam zusammen.'],
  ])('matches a signal written in the %s', (_label, spec) => {
    const result = runDeterministicChecks({
      output: `Applying. ${collab.sentence}`,
      roleDescription: spec,
      preferences: [collab],
    });

    expect(result.unofferedPreferences).toEqual([]);
  });

  it('still refuses a spec that genuinely has no such signal', () => {
    const result = runDeterministicChecks({
      output: `Applying. ${collab.sentence}`,
      roleDescription: 'You will maintain our servers and on-call rotation.',
      preferences: [collab],
    });

    expect(result.unofferedPreferences).toEqual(['design-product-collaboration']);
  });
});

/** The real candidate's bank. Private: skipped in an exported copy, which has no reference/. */
describe.skipIf(referenceLeftOutByExport)("the candidate's preference bank", () => {
  const bank = referenceLeftOutByExport
    ? []
    : parsePreferenceBank(loadSkillPrompt(undefined, loadCandidateProfile(PRIVATE_PROFILE_PATH)));

  it('reads every row out of the profile', () => {
    expect(bank.length).toBeGreaterThanOrEqual(10);
  });

  it('covers the preferences that were asked for by name', () => {
    const ids = bank.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['remote-work', 'learning-budget', 'international-team']));
  });

  it('carries the approved German for the collaboration preference', () => {
    expect(bank.find((p) => p.id === 'design-product-collaboration')?.sentenceDe).toBeDefined();
  });

  it.each(bank.map((p) => [p.id, p] as const))('%s has signals in both languages and a usable sentence', (_id, pref) => {
    expect(pref.signals.length).toBeGreaterThanOrEqual(5);
    expect(pref.sentence.length).toBeGreaterThan(30);
    expect(pref.sentence).not.toMatch(/[—–]/);
  });

  it.each(bank.map((p) => [p.id, p] as const))('%s states a want rather than an unverifiable metric', (_id, pref) => {
    const result = runDeterministicChecks({ output: pref.sentence, cvText: 'irrelevant' });
    expect(result.unsupportedNumbers).toEqual([]);
  });
});
