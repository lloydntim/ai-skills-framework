// Loads .env, so COVER_LETTER_PROFILE can point at a profile kept outside the repository.
import '@skills/framework/load-env-on-import';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderTemplate } from '@skills/framework/prompts/prompt-file';
import { loadCandidateProfile } from '../src/candidate-profile';
import { loadSkillPrompt } from '../src/skill-loader';

const TEMPLATE_PATH = path.join(__dirname, '..', 'adapters', 'claude', 'skill-template.md');
const DEFAULT_OUT = path.join(os.homedir(), '.claude', 'skills', 'cover-letter-writer', 'SKILL.md');
const DEFAULT_COMMAND_OUT = path.join(os.homedir(), '.claude', 'commands', 'cover-letter-writer.md');

// A skill alone does not appear in Claude Code's "/" menu; that needs a separate slash command
// file. This wrapper holds no rules of its own, only a pointer at the skill, so it cannot drift.
const SLASH_COMMAND = `---
description: Write a tailored cover letter or Anschreiben from a job spec and CV, using the cover-letter-writer skill
argument-hint: paste the job advert or link, plus the CV
---

Use the \`cover-letter-writer\` skill to handle the following request. Follow that skill's rules exactly.

$ARGUMENTS
`;

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=([\s\S]*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = args.out ?? DEFAULT_OUT;

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

  // SKILL.md stays the single source of truth, carrying the hard rules, both banks and both
  // letter templates. Two things are dropped when embedding it in the chat skill:
  //   - the H1, because the template supplies the title and the frontmatter
  //   - "## Output format", because the template's own "## Output" section replaces it with chat
  //     behaviour (asking about a missing input, flagging a gap). Leaving both in would contradict.
  const profile = loadCandidateProfile();
  const rules = loadSkillPrompt(undefined, profile)
    .replace(/^#\s.*\n+/, '')
    .replace(/\n## Output format\n[\s\S]*?(?=\n## |$)/, '');

  if (!template.includes('{{RULES}}')) {
    throw new Error(`Template is missing the {{RULES}} placeholder: ${TEMPLATE_PATH}`);
  }

  // The wrapper names the candidate once, in the saved letter's filename.
  const output = renderTemplate(template, { RULES: rules.trim(), CANDIDATE_NAME: profile.CANDIDATE_NAME }) + '\n';

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output);

  console.log(`Built Claude skill: ${outPath}`);
  console.log(`Size: ${output.length} chars (rules: ${rules.trim().length}, wrapper: ${output.length - rules.trim().length})`);

  if (!args['no-command']) {
    const commandOut = args['command-out'] ?? DEFAULT_COMMAND_OUT;
    fs.mkdirSync(path.dirname(commandOut), { recursive: true });
    fs.writeFileSync(commandOut, SLASH_COMMAND);
    console.log(`Built slash command: ${commandOut}`);
  }
}

main();
