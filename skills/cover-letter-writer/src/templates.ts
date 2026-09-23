import { loadSkillPrompt } from './skill-loader';

export type LetterLanguage = 'en' | 'de';

export interface LetterTemplate {
  language: LetterLanguage;
  body: string;
  /** Slot names in the order they appear, without the braces. */
  slots: string[];
}

/**
 * Reads the letter templates out of SKILL.md, the same file the model is given, so the structure
 * the checks enforce is the structure the model was shown. Fenced blocks are labelled
 * ```cover-letter-en / ```cover-letter-de rather than located by heading, because a heading rename
 * would silently return nothing whereas a missing fence label is caught by the tests.
 */
export function parseTemplates(skillText: string = loadSkillPrompt()): LetterTemplate[] {
  const templates: LetterTemplate[] = [];
  const fence = /```cover-letter-(en|de)\r?\n([\s\S]*?)```/g;

  for (const match of skillText.matchAll(fence)) {
    const language = match[1] as LetterLanguage;
    const body = match[2].replace(/\s+$/, '');
    const slots = [...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    templates.push({ language, body, slots: [...new Set(slots)] });
  }

  return templates;
}

export function getTemplate(
  language: LetterLanguage,
  skillText?: string,
): LetterTemplate | undefined {
  return parseTemplates(skillText).find((t) => t.language === language);
}

/**
 * How each language opens the letter proper. Used both as a structural marker and to find where
 * the letterhead ends, since everything above the salutation is contact and addressing data rather
 * than claims about experience.
 *
 * The German list is what the sent Anschreiben actually use: four open "Hallo <company>-Team," and
 * one opens "Liebes Kranich-Team,". "Sehr geehrte" is kept for a traditional employer.
 */
export const SALUTATION_MARKERS: Record<LetterLanguage, string[]> = {
  en: ['Dear '],
  de: ['Hallo', 'Liebe', 'Sehr geehrte', 'Guten Tag'],
};

/**
 * The structural markers a finished letter in each language must carry. Each entry is a group of
 * alternatives and is satisfied by any one of them.
 *
 * German needs the alternatives. The sent Anschreiben open "Hallo <name> und <company>-Team,"
 * and close "Viele Grüße," which is the normal register for German tech companies, while a
 * traditional employer with a named contact still takes "Sehr geehrte Frau X," and "Mit
 * freundlichen Grüßen". Requiring only the formal pair rejected both real letters.
 */
export const REQUIRED_STRUCTURE: Record<LetterLanguage, string[][]> = {
  en: [['Application for'], ['Dear '], ['Kind regards']],
  de: [['Bewerbung als'], SALUTATION_MARKERS.de, ['Grüße', 'Grüßen']],
};
