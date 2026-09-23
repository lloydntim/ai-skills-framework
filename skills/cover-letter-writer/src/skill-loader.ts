import fs from 'node:fs';
import path from 'node:path';
import { placeholdersIn, renderTemplate } from '@skills/framework/prompts/prompt-file';
import { loadCandidateProfile, type CandidateProfile } from './candidate-profile';

const DEFAULT_SKILL_PATH = path.join(__dirname, '..', 'SKILL.md');

/**
 * The skill as the model sees it: SKILL.md with its {{PLACEHOLDERS}} filled from the candidate
 * profile. A placeholder the profile does not fill throws, naming it. Lower-case slots such as
 * {{location}} are the letter template's own and are left for the model to fill.
 */
export function loadSkillPrompt(
  skillPath: string = DEFAULT_SKILL_PATH,
  profile?: CandidateProfile,
): string {
  if (!fs.existsSync(skillPath)) {
    throw new Error(`Skill file not found at ${skillPath}`);
  }
  const template = fs.readFileSync(skillPath, 'utf-8');
  const wanted = placeholdersIn(template);
  if (wanted.length === 0) return template;

  const values = profile ?? loadCandidateProfile();
  // Only the keys this file uses: the profile also carries keys read by code, not by the skill.
  const used = Object.fromEntries(wanted.filter((key) => key in values).map((key) => [key, values[key]]));
  return renderTemplate(template, used);
}

export { baselineSystemPrompt as BASELINE_SYSTEM_PROMPT } from './prompts';
