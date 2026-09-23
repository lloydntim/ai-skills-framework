import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from '@skills/framework/cli-args';
import { loadSkillPrompt } from '../src/skill-loader';

const TEMPLATE_PATH = path.join(__dirname, '..', 'adapters', 'claude', 'skill-template.md');
const DEFAULT_OUT = path.join(os.homedir(), '.claude', 'skills', 'cv-translator', 'SKILL.md');
const DEFAULT_COMMAND_OUT = path.join(os.homedir(), '.claude', 'commands', 'cv-translator.md');

// A skill alone does not appear in Claude Code's "/" menu — that needs a separate slash command
// file. This wrapper holds no rules of its own, only a pointer at the skill, so it cannot drift.
const SLASH_COMMAND = `---
description: Translate or improve CV text (German <-> English) using the cv-translator skill
argument-hint: e.g. "to German" then paste your CV text
---

Use the \`cv-translator\` skill to handle the following request. Follow that skill's rules exactly.

$ARGUMENTS
`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = args.out ?? DEFAULT_OUT;

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  // The canonical rules are the single source of truth that the eval framework measures.
  // Two things are dropped when embedding them in the chat skill:
  //   - the H1, because the template supplies the title and frontmatter
  //   - the "## Output format" section, because the CLI needs "no commentary at all" (its output
  //     is piped to a file) while chat wants a short note when the source is genuinely ambiguous.
  //     The template's own "## Output" section replaces it; leaving both in would contradict.
  const rules = loadSkillPrompt()
    .replace(/^#\s.*\n+/, '')
    .replace(/\n## Output format\n[\s\S]*?(?=\n## |$)/, '');

  if (!template.includes('{{RULES}}')) {
    throw new Error(`Template is missing the {{RULES}} placeholder: ${TEMPLATE_PATH}`);
  }

  const output = template.replace('{{RULES}}', rules.trim()) + '\n';

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
