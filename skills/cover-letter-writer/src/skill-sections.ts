import type { Market } from './markets';
import type { LetterLanguage } from './templates';

/**
 * How much of SKILL.md the generator and reviser see.
 *
 * - 'full': the whole file, whatever the letter. What production has always sent.
 * - 'by-task': the whole file minus the sections this letter's language and market cannot use.
 *
 * 'by-task' changes the production prompt, so it stays opt-in until a paid golden run shows no
 * regression against 'full' (see README, "What each call sees").
 */
export type SkillContext = 'full' | 'by-task';

interface TaskSpecificSection {
  /** The heading line exactly as it appears in SKILL.md. */
  heading: string;
  /** True when a letter with this language and market has no use for the section. */
  notNeeded: (task: SectionTask) => boolean;
}

export interface SectionTask {
  language: LetterLanguage;
  market?: Market;
}

/**
 * The only sections that some letters cannot use. Everything else in SKILL.md (hard rules, voice,
 * both banks, the paragraph plan, citation, slot filling, gaps, length) applies to every letter and
 * is always sent. Selection keys on the input's own fields, never on the model's reading of the
 * advert, so it is testable.
 *
 * The UK and Ireland section is kept when no market is given: the model may still have to place the
 * role. A DACH letter does not need it: its contact block is already in the user prompt, and the
 * checks for DACH (contact block, no UK phone) can be met from that block alone.
 */
const TASK_SPECIFIC_SECTIONS: TaskSpecificSection[] = [
  { heading: '### English', notNeeded: (t) => t.language === 'de' },
  { heading: '### German', notNeeded: (t) => t.language === 'en' },
  { heading: '## German Anschreiben conventions', notNeeded: (t) => t.language === 'en' },
  { heading: '## Applying in the UK and Ireland', notNeeded: (t) => t.market === 'dach' },
];

function headingLevel(heading: string): number {
  return heading.match(/^#+/)![0].length;
}

/**
 * Removes one section: from its heading line up to the next heading of the same or a higher level
 * (or the end of the file). Throws when the heading is missing, so renaming a section in SKILL.md
 * cannot silently turn selection off for it.
 */
function removeSection(text: string, heading: string): string {
  const lines = text.split('\n');
  const start = lines.indexOf(heading);
  if (start === -1) throw new Error(`SKILL.md has no "${heading}" section to select on`);
  const level = headingLevel(heading);
  let end = start + 1;
  let inFence = false;
  while (end < lines.length) {
    if (lines[end].startsWith('```')) inFence = !inFence;
    const match = inFence ? null : lines[end].match(/^(#+) /);
    if (match && match[1].length <= level) break;
    end += 1;
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n');
}

export interface SectionSelection {
  text: string;
  /** Headings of the sections left out, in SKILL.md order of the table above. */
  omitted: string[];
}

/** The skill text a letter with this language and market needs. See TASK_SPECIFIC_SECTIONS. */
export function selectSkillSections(skillText: string, task: SectionTask): SectionSelection {
  let text = skillText;
  const omitted: string[] = [];
  for (const section of TASK_SPECIFIC_SECTIONS) {
    if (!section.notNeeded(task)) continue;
    text = removeSection(text, section.heading);
    omitted.push(section.heading);
  }
  return { text, omitted };
}

/**
 * Reads a --skill-context=<value> command-line option into a RuntimeConfig override. Absent means
 * no override. An unknown value throws rather than falling back, so a typo cannot quietly run 'full'.
 */
export function skillContextOption(value: string | undefined): { skillContext?: SkillContext } {
  if (value === undefined) return {};
  if (value !== 'full' && value !== 'by-task') {
    throw new Error(`--skill-context must be "full" or "by-task" (got "${value}")`);
  }
  return { skillContext: value };
}
