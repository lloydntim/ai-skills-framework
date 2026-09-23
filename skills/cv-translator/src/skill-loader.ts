import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SKILL_PATH = path.join(__dirname, '..', 'SKILL.md');

export function loadSkillPrompt(skillPath: string = DEFAULT_SKILL_PATH): string {
  if (!fs.existsSync(skillPath)) {
    throw new Error(`Skill file not found at ${skillPath}`);
  }
  return fs.readFileSync(skillPath, 'utf-8');
}

export { baselineSystemPrompt as BASELINE_SYSTEM_PROMPT } from './prompts';
