import { describe, expect, it } from 'vitest';
import { contactBlocks, contactRequirements, isMarket, rightToWork } from './markets';
import { loadCandidateProfile, PRIVATE_PROFILE_PATH } from './candidate-profile';
import { loadReferenceCv, referenceLeftOutByExport } from './reference-cv';
import { runDeterministicChecks } from './deterministic-checks';

// These run against the fictional candidate in candidate-profile.example.md (see vitest.config.ts).
const CONTACT_BLOCKS = contactBlocks();
const RIGHT_TO_WORK = rightToWork();
const EMAIL = CONTACT_BLOCKS.uk.email;

describe('contact blocks by market', () => {
  it('uses the UK details for both UK and Irish roles', () => {
    expect(CONTACT_BLOCKS.uk).toEqual(CONTACT_BLOCKS.ie);
    expect(CONTACT_BLOCKS.uk.phone).toBe('+44 7700 900123');
    expect(CONTACT_BLOCKS.uk.location).toBe('London, UK');
  });

  it('keeps the German details for DACH roles', () => {
    expect(CONTACT_BLOCKS.dach.phone).toBe('+49 176 12345678');
  });

  it('rejects a market it does not know', () => {
    expect(isMarket('us')).toBe(false);
    expect(isMarket('uk')).toBe(true);
  });

  it.each(['uk', 'ie', 'dach'] as const)('%s requires its own phone and forbids the other', (m) => {
    const { require, forbid } = contactRequirements(m);

    expect(require).toContain(CONTACT_BLOCKS[m].phone);
    expect(forbid).not.toContain(CONTACT_BLOCKS[m].phone);
    expect(forbid.length).toBeGreaterThan(0);
  });

  it('forbids only the city of the DACH location on a UK letter', () => {
    // The address can sit in the header or in a relocation clause, so the city alone is enough.
    expect(contactRequirements('uk').forbid).toEqual(['+49 176 12345678', 'Leipzig']);
    expect(contactRequirements('dach').forbid).toEqual(['+44 7700 900123', 'London, UK']);
  });

  it('takes the details from whichever profile it is given', () => {
    const other = { ...loadCandidateProfile(), UK_PHONE: '+44 7700 900999', DACH_LOCATION: 'Graz, Austria' };

    expect(contactBlocks(other).ie.phone).toBe('+44 7700 900999');
    expect(contactRequirements('uk', other).forbid).toContain('Graz');
  });
});

describe('the market rule against a letter', () => {
  const ukLetter =
    'JORDAN SAMPLE\nLondon, UK | +44 7700 900123 | jordan.sample@example.com\n\n' +
    'Application for Engineer\n\nDear Team,\n\nBody.\n\nKind regards,\nJordan Sample\nT: +44 7700 900123';
  const dachLetter =
    'JORDAN SAMPLE\nLeipzig, Germany | +49 176 12345678 | jordan.sample@example.com\n\n' +
    'Application for Engineer\n\nDear Team,\n\nBody.\n\nKind regards,\nJordan Sample\nT: +49 176 12345678';

  const check = (output: string, market: 'uk' | 'ie' | 'dach') => {
    const { require, forbid } = contactRequirements(market);
    return runDeterministicChecks({ output, requiredExactStrings: require, forbiddenClaims: forbid });
  };

  it('accepts a UK letter carrying the UK block', () => {
    expect(check(ukLetter, 'uk').pass).toBe(true);
  });

  it('accepts the same letter for an Irish role', () => {
    expect(check(ukLetter, 'ie').pass).toBe(true);
  });

  it('rejects a UK letter carrying the German block', () => {
    const result = check(dachLetter, 'uk');

    expect(result.missingExactStrings).toEqual(['+44 7700 900123', 'London, UK']);
    expect(result.matchedForbiddenClaims).toContain('+49 176 12345678');
    expect(result.pass).toBe(false);
  });

  it('rejects a DACH letter carrying the UK block', () => {
    const result = check(ukLetter, 'dach');

    expect(result.missingExactStrings).toEqual(['+49 176 12345678']);
    expect(result.matchedForbiddenClaims).toContain('+44 7700 900123');
    expect(result.pass).toBe(false);
  });
});

describe('right to work', () => {
  const ukBody =
    'Dear Team,\n\nBody about the role.\n\nAs a British citizen I have the right to work in the UK, ' +
    'so no visa sponsorship is required.\n\nKind regards,\nJordan Sample';

  it("accepts a UK letter that states the candidate's status", () => {
    const result = runDeterministicChecks({ output: ukBody, requiredAnyOf: RIGHT_TO_WORK.uk });

    expect(result.missingRequiredGroups).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('accepts the alternative wording, since the sentence is adapted not pasted', () => {
    const result = runDeterministicChecks({
      output: 'Dear Team,\n\nNo visa sponsorship is needed.\n\nKind regards,',
      requiredAnyOf: RIGHT_TO_WORK.uk,
    });

    expect(result.missingRequiredGroups).toEqual([]);
  });

  it('fails a UK letter that says nothing about it', () => {
    const result = runDeterministicChecks({
      output: 'Dear Team,\n\nBody about the role.\n\nKind regards,\nJordan Sample',
      requiredAnyOf: RIGHT_TO_WORK.uk,
    });

    expect(result.missingRequiredGroups).toEqual([
      'British citizen or right to work in the UK or no visa sponsorship',
    ]);
    expect(result.pass).toBe(false);
  });

  it('asks an Irish letter for its own wording rather than the UK one', () => {
    const result = runDeterministicChecks({
      output: 'Dear Team,\n\nUnder the Common Travel Area I can work in Ireland.',
      requiredAnyOf: RIGHT_TO_WORK.ie,
    });

    expect(result.missingRequiredGroups).toEqual([]);
  });

  it('requires nothing of a DACH letter', () => {
    const result = runDeterministicChecks({
      output: 'Sehr geehrte Damen und Herren,\n\nText.',
      requiredAnyOf: RIGHT_TO_WORK.dach,
    });

    expect(result.missingRequiredGroups).toEqual([]);
  });
});

describe('the email address', () => {
  it('is the same in every market', () => {
    expect(new Set(Object.values(CONTACT_BLOCKS).map((b) => b.email)).size).toBe(1);
  });

  it('is required by the market check, so a different address fails', () => {
    const wrong =
      'JORDAN SAMPLE\nLondon, UK | +44 7700 900123 | someone.else@example.com\n\nDear Team,\n\nBody.';
    const { require, forbid } = contactRequirements('uk');
    const result = runDeterministicChecks({
      output: wrong,
      requiredExactStrings: require,
      forbiddenClaims: forbid,
    });

    expect(result.missingExactStrings).toContain(EMAIL);
    expect(result.pass).toBe(false);
  });
});

/**
 * The candidate's own contact details against their own CV. Private regression checks: they read
 * reference/, so an exported copy skips them, and they hold no personal data themselves.
 */
describe.skipIf(referenceLeftOutByExport)("the candidate's profile against their CV", () => {
  const profile = referenceLeftOutByExport ? {} as Record<string, string> : loadCandidateProfile(PRIVATE_PROFILE_PATH);
  const cv = referenceLeftOutByExport ? '' : loadReferenceCv();

  it('uses the email address on the CV', () => {
    // The binding constraint on which address to use. A letter and a CV that disagree give the
    // reader two ways to reply and the reply lands wherever they pick. Change the CV and this
    // fails here, in under a second, rather than on an application.
    expect(cv).toContain(profile.EMAIL);
  });

  it.each(['LINKEDIN', 'GITHUB'])('uses the %s link on the CV', (key) => {
    expect(cv).toContain(profile[key]);
  });

  it('records that the portfolio is on the letters but not on the CV', () => {
    // Not a defect in the skill. The CV header carries GitHub and LinkedIn and no portfolio URL,
    // while every sent letter carries the portfolio. Pinned here so that adding it to the CV
    // fails this test and prompts a decision, rather than the two documents silently diverging
    // further.
    expect(cv).not.toContain(profile.PORTFOLIO);
  });
});
