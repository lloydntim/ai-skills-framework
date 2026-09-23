import { loadSkillPrompt } from './skill-loader';
import { parseSkillTable, splitTriggers } from './skill-tables';

export interface StandardPhrase {
  id: string;
  /** Words or terms in the job spec that make this phrase applicable. */
  triggers: string[];
  phrase: string;
  /** The approved German wording, where one exists. Undefined means translate at write time. */
  phraseDe?: string;
  /** A term that must be present in the CV for this phrase to be true of this candidate. */
  cvAnchor: string;
}

/**
 * Evidence about the candidate, grounded in the CV. Parsed from the table in SKILL.md rather than
 * kept as a second copy in code, so the bank the model is shown is the bank the checks enforce.
 */
export function parsePhraseBank(skillText: string = loadSkillPrompt()): StandardPhrase[] {
  return parseSkillTable('## Standard phrases', 5, skillText).map(
    ([id, triggers, phrase, german, cvAnchor]) => ({
      id,
      triggers: splitTriggers(triggers),
      phrase,
      phraseDe: german === '-' ? undefined : german,
      cvAnchor,
    }),
  );
}
