import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from '@skills/framework/cli-args';

const TEMPLATE_PATH = path.join(__dirname, '..', 'SKILL.md');
const BLUEPRINT_PATH = path.join(__dirname, '..', 'docs', 'skill-builder-blueprint.md');
const DEFAULT_CLAUDE_CODE_OUT = path.join(os.homedir(), '.claude', 'skills', 'skill-builder');
const DEFAULT_PORTABLE_OUT = path.join(__dirname, '..', 'dist', 'skill-builder-portable');
const DEFAULT_COMMAND_OUT = path.join(os.homedir(), '.claude', 'commands', 'skill-builder.md');

// The blueprint is the single source of truth (its own rule 4.1) — it is copied verbatim into
// every build target at build time rather than rewritten there, so no target can drift from it.
const REFERENCE_RELATIVE = path.join('reference', 'blueprint.md');

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;

// Claude Code alone does not appear in Claude Code's "/" menu without this file — older Claude
// Code versions needed a separate slash command to make a skill invocable. Current Claude Code
// invokes installed skills directly via "/<skill-name>", so this is legacy-only support kept for
// anyone still relying on the old mechanism.
const LEGACY_SLASH_COMMAND = `---
description: Structure, evaluate or restructure a model skill using the skill-builder blueprint
argument-hint: e.g. "restructure the skill in ./my-skill" or "add tests to this skill"
---

Use the \`skill-builder\` skill to handle the following request. Read its
\`reference/blueprint.md\` first and follow both files exactly.

$ARGUMENTS
`;

export type BuildTarget = 'claude-code' | 'portable';

export interface BuildBuilderSkillOptions {
  target?: BuildTarget;
  out?: string;
  legacyCommand?: boolean;
  commandOut?: string;
  templatePath?: string;
  blueprintPath?: string;
}

export interface BuildBuilderSkillResult {
  target: BuildTarget;
  skillPath: string;
  referencePath: string;
  commandPath?: string;
  legacyCommandFound?: string;
}

function assertValidTemplate(template: string, templatePath: string): void {
  // The wrapper deliberately carries no architecture rules of its own — it must point at the
  // blueprint instead. If that pointer is ever dropped, the installed skill silently loses
  // everything that matters, so fail loudly rather than ship a wrapper with nothing behind it.
  if (!template.includes('reference/blueprint.md')) {
    throw new Error(
      `Template does not reference reference/blueprint.md, so the installed skill would have no ` +
        `architecture behind it: ${templatePath}`
    );
  }

  const frontmatterMatch = template.match(FRONTMATTER_RE);
  if (!frontmatterMatch) {
    throw new Error(`Template is missing YAML frontmatter: ${templatePath}`);
  }
  const frontmatter = frontmatterMatch[1];
  if (!/^name:/m.test(frontmatter) || !/^description:/m.test(frontmatter)) {
    throw new Error(
      `Template frontmatter must declare both "name" and "description": ${templatePath}`
    );
  }
}

// Adds the Claude Code-specific manual-invocation field. This field has no meaning under the open
// Agent Skills specification, so it is injected at build time rather than kept in the portable
// source template — the portable target must never see it.
function withClaudeCodeFrontmatter(template: string): string {
  const match = template.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error('Template is missing YAML frontmatter');
  }
  const frontmatter = match[1];
  if (/^disable-model-invocation:/m.test(frontmatter)) {
    return template;
  }
  const updated = `---\n${frontmatter}\ndisable-model-invocation: true\n---\n`;
  return match[0] === updated ? template : template.replace(match[0], updated);
}

export function buildBuilderSkill(
  options: BuildBuilderSkillOptions = {}
): BuildBuilderSkillResult {
  const target: BuildTarget = options.target ?? 'claude-code';
  const templatePath = options.templatePath ?? TEMPLATE_PATH;
  const blueprintPath = options.blueprintPath ?? BLUEPRINT_PATH;

  if (!fs.existsSync(blueprintPath)) {
    throw new Error(`Blueprint not found at ${blueprintPath}`);
  }
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found at ${templatePath}`);
  }

  const rawTemplate = fs.readFileSync(templatePath, 'utf-8');
  const blueprint = fs.readFileSync(blueprintPath, 'utf-8');

  assertValidTemplate(rawTemplate, templatePath);

  const template = target === 'claude-code' ? withClaudeCodeFrontmatter(rawTemplate) : rawTemplate;

  const outDir = options.out ?? (target === 'claude-code' ? DEFAULT_CLAUDE_CODE_OUT : DEFAULT_PORTABLE_OUT);
  const skillPath = path.join(outDir, 'SKILL.md');
  const referencePath = path.join(outDir, REFERENCE_RELATIVE);

  fs.mkdirSync(path.dirname(skillPath), { recursive: true });
  fs.mkdirSync(path.dirname(referencePath), { recursive: true });
  fs.writeFileSync(skillPath, template.trimEnd() + '\n');
  fs.writeFileSync(referencePath, blueprint.trimEnd() + '\n');

  const result: BuildBuilderSkillResult = { target, skillPath, referencePath };

  const commandOut = options.commandOut ?? DEFAULT_COMMAND_OUT;

  if (options.legacyCommand) {
    if (target !== 'claude-code') {
      throw new Error(
        'The legacy slash command is a Claude Code concept and only applies to --target=claude-code'
      );
    }
    fs.mkdirSync(path.dirname(commandOut), { recursive: true });
    fs.writeFileSync(commandOut, LEGACY_SLASH_COMMAND);
    result.commandPath = commandOut;
  } else if (fs.existsSync(commandOut)) {
    // Do not delete a file the user may still be relying on — just surface that it is redundant.
    result.legacyCommandFound = commandOut;
  }

  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const target: BuildTarget = args.target === 'portable' ? 'portable' : 'claude-code';

  const result = buildBuilderSkill({
    target,
    out: args.out,
    legacyCommand: args['legacy-command'] === 'true',
    commandOut: args['command-out'],
  });

  console.log(`Built ${result.target} skill: ${result.skillPath}`);
  console.log(`Built reference:            ${result.referencePath}`);

  if (result.commandPath) {
    console.log(`Built legacy slash command: ${result.commandPath}`);
  } else if (result.legacyCommandFound) {
    console.log(
      `Note: a legacy command file exists at ${result.legacyCommandFound}. Claude Code invokes ` +
        `this skill directly via "/skill-builder" now, so this file is redundant. It was left ` +
        `in place — remove it by hand if you no longer need it.`
    );
  }
}

if (require.main === module) {
  main();
}
