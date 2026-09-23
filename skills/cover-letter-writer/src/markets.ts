import { loadCandidateProfile, type CandidateProfile } from './candidate-profile';
import { splitTriggers } from './skill-tables';

/**
 * The contact block that belongs on a letter, chosen by the market of the role.
 *
 * Sending a London application with a German mobile and a German address is an easy mistake and an
 * expensive one: it reads as an applicant who is somewhere else. Both blocks are exact strings, so
 * the rule is enforced with the checks that already exist, requiring the market's own details and
 * forbidding the other market's.
 *
 * The details themselves are the candidate's, so they come from the candidate profile (see
 * candidate-profile.ts). The same profile keys fill the market table in SKILL.md, so the block the
 * model is shown is the block the checks enforce.
 */
export interface ContactBlock {
  location: string;
  phone: string;
  email: string;
}

export const MARKETS = ['uk', 'ie', 'dach'] as const;

export type Market = (typeof MARKETS)[number];

export function isMarket(value: string): value is Market {
  return (MARKETS as readonly string[]).includes(value);
}

/**
 * One address across every market and both languages. A letter and a CV that disagree hand the
 * reader two ways to reply, and the reply goes to whichever they happen to pick. A test asserts
 * the profile's address matches the one in reference/cv.md.
 */
export function contactBlocks(profile: CandidateProfile = loadCandidateProfile()): Record<Market, ContactBlock> {
  const uk = { location: profile.UK_LOCATION, phone: profile.UK_PHONE, email: profile.EMAIL };
  return {
    uk,
    ie: { ...uk },
    dach: { location: profile.DACH_LOCATION, phone: profile.DACH_PHONE, email: profile.EMAIL },
  };
}

/**
 * The right-to-work statement each market expects, as groups of acceptable wordings.
 *
 * It is the first thing both markets screen for and the cheapest doubt to remove, so a letter that
 * omits it has left its strongest practical argument on the table. Several wordings are accepted
 * because the sentence is adapted to the advert rather than pasted. Which wordings are true depends
 * on the candidate's status, so they come from the profile.
 */
export function rightToWork(profile: CandidateProfile = loadCandidateProfile()): Record<Market, string[][]> {
  return {
    uk: [splitTriggers(profile.UK_RIGHT_TO_WORK_WORDINGS)],
    ie: [splitTriggers(profile.IE_RIGHT_TO_WORK_WORDINGS)],
    dach: [],
  };
}

/**
 * What a letter for this market must contain, and what it must not. Only the city of the DACH
 * location is forbidden on a UK letter rather than the whole location line, because the address
 * can appear in either the header or a relocation clause.
 */
export function contactRequirements(
  market: Market,
  profile: CandidateProfile = loadCandidateProfile(),
): { require: string[]; forbid: string[] } {
  const blocks = contactBlocks(profile);
  const mine = blocks[market];
  const other = market === 'dach' ? blocks.uk : blocks.dach;
  const dachCity = blocks.dach.location.split(',')[0].trim();

  return {
    require: [mine.phone, mine.email, ...(market === 'dach' ? [] : [mine.location])],
    forbid: [other.phone, ...(market === 'dach' ? [other.location] : [dachCity])],
  };
}
