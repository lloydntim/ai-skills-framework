import fs from 'node:fs';

/**
 * A prompt is a plain Markdown file with up to two parts:
 *
 *   ## System      the system prompt sent to the model
 *   ## Task        the text sent as the user message, with {{PLACEHOLDERS}} to fill in
 *
 * Either part may be left out. A file with no headings is treated as a task with no system prompt.
 * Trailing blank lines are ignored, so an editor adding a final newline changes nothing.
 * The version of a prompt is not stored in the file. It lives in skill.json, so that changing a
 * version number never changes the hash of what the model actually sees.
 */
export interface PromptFile {
  system?: string;
  task: string;
}

const SYSTEM_HEADING = '## System\n';
const TASK_HEADING = '## Task\n';

export function parsePromptFile(raw: string): PromptFile {
  if (raw.startsWith(SYSTEM_HEADING)) {
    const split = raw.indexOf('\n' + TASK_HEADING);
    if (split === -1) return { system: raw.slice(SYSTEM_HEADING.length).trim(), task: '' };
    return {
      system: raw.slice(SYSTEM_HEADING.length, split).trim(),
      task: raw.slice(split + 1 + TASK_HEADING.length).trimEnd(),
    };
  }
  if (raw.startsWith(TASK_HEADING)) return { task: raw.slice(TASK_HEADING.length).trimEnd() };
  return { task: raw.trimEnd() };
}

export function readPromptFile(file: string): PromptFile {
  if (!fs.existsSync(file)) throw new Error(`Prompt file not found: ${file}`);
  return parsePromptFile(fs.readFileSync(file, 'utf-8'));
}

const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

export function placeholdersIn(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

/**
 * Fills {{PLACEHOLDERS}} in one pass. Text that is inserted is never searched again, so a CV that
 * happens to contain "{{OUTPUT}}" or "$&" is inserted exactly as written. Throws if the template
 * has a placeholder with no value, or a value is given for a placeholder the template lacks, so a
 * typo fails loudly instead of sending a broken prompt.
 */
export function renderTemplate(template: string, values: Record<string, string>): string {
  const wanted = placeholdersIn(template);
  const missing = wanted.filter((name) => !(name in values));
  if (missing.length > 0) throw new Error(`No value given for placeholder(s): ${missing.join(', ')}`);
  const unused = Object.keys(values).filter((name) => !wanted.includes(name));
  if (unused.length > 0) throw new Error(`The prompt has no placeholder for: ${unused.join(', ')}`);
  return template.replace(PLACEHOLDER, (_match, name: string) => values[name]);
}
