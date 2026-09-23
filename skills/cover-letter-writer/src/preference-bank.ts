import { loadSkillPrompt } from './skill-loader';
import { parseSkillTable, splitTriggers } from './skill-tables';

export interface JobPreference {
  id: string;
  /** Signals in the job spec showing the employer actually offers this. */
  signals: string[];
  sentence: string;
  /** The approved German wording, where one exists. Undefined means translate at write time. */
  sentenceDe?: string;
}

/**
 * What the candidate wants from an employer, as opposed to what the candidate has done.
 *
 * The distinction from the phrase bank matters for how failures are graded. A standard phrase used
 * without its trigger is merely off-target: it stays true of the candidate. A preference used
 * without its signal is a false statement about the employer, since it credits them with something
 * their advert never offered, so it fails the checks outright.
 */
export function parsePreferenceBank(skillText: string = loadSkillPrompt()): JobPreference[] {
  return parseSkillTable('## Job preferences', 4, skillText).map(
    ([id, signals, sentence, german]) => ({
      id,
      signals: splitTriggers(signals),
      sentence,
      sentenceDe: german === '-' ? undefined : german,
    }),
  );
}
