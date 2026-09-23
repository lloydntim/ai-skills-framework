import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildBuilderSkill } from './build-skill-builder';

/**
 * Free, mechanical validation of the Skill Builder's own source and generated artifacts. Every
 * check here reads text and file paths only: no model call, no network, no cost. This runs on
 * every commit and inside `npm test` (see validate-skill-builder.test.ts).
 */

const REPO_ROOT = path.join(__dirname, '..');

export interface ValidationIssue {
  rule: string;
  message: string;
  file?: string;
}

export interface ValidateOptions {
  repoRoot?: string;
  /**
   * Repo-relative paths of content newly written for the current change, checked for em dashes.
   * The blueprint and canonical template predate this rule and already use em dashes as
   * established style, so they are deliberately not swept by default (7.2/"moving text is not
   * editing text": rewriting their prose to satisfy a check they were never written under is out
   * of scope. Pass the files a given change actually adds or rewrites here.
   */
  newContentFiles?: string[];
}

/** Files newly written for the Skill Builder's own testing/evaluation harness. */
export const DEFAULT_NEW_CONTENT_FILES = [
  'scripts/validate-skill-builder.ts',
  'scripts/validate-skill-builder.test.ts',
];

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;

function readFrontmatterKeys(content: string): string[] {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return [];
  return match[1]
    .split('\n')
    .filter((line) => /^[A-Za-z-]+:/.test(line))
    .map((line) => line.split(':')[0]);
}

function readFrontmatterBlock(content: string): string {
  const match = content.match(FRONTMATTER_RE);
  return match ? match[1] : '';
}

// Fields the open Agent Skills specification defines. Anything else in the portable frontmatter is
// a platform leak (5. Portable skill vs platform adapters in the blueprint).
const OPEN_SPEC_FRONTMATTER_FIELDS = new Set(['name', 'description']);

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bTBD\b/,
  /\bXXX\b/,
  /\bPLACEHOLDER\b/i,
  /\{\{\s*[A-Z_]+\s*\}\}/, // an unfilled {{TOKEN}}; {{RULES}} in claude-skill-template.md is filled at build time, so it is excluded by caller scope, not by this pattern
  /<INSERT[^>]*>/i,
  /\[FILL[^\]]*\]/i,
];

const EM_DASH = String.fromCharCode(0x2014);

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 80);
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Extracts repo-relative-looking paths referenced from markdown: backtick spans and markdown link
 * targets that look like a file path (contain a "/" or end in a known extension) and are not a URL.
 */
function extractReferencedPaths(text: string): string[] {
  const found = new Set<string>();
  const backtickRe = /`([^`\n]+\.(?:md|ts|json|js))`/g;
  const linkRe = /\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = backtickRe.exec(text))) found.add(m[1]);
  while ((m = linkRe.exec(text))) {
    const target = m[1];
    if (!/^https?:\/\//.test(target) && !target.startsWith('#')) found.add(target);
  }
  return Array.from(found);
}

export function validateBuilderSkill(options: ValidateOptions = {}): ValidationIssue[] {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const issues: ValidationIssue[] = [];

  const templatePath = path.join(repoRoot, 'SKILL.md');
  const blueprintPath = path.join(repoRoot, 'docs', 'skill-builder-blueprint.md');
  const claudeSkillTemplatePath = path.join(repoRoot, 'skill', 'claude-skill-template.md');
  const buildScriptPath = path.join(repoRoot, 'scripts', 'build-skill-builder.ts');

  if (!fs.existsSync(templatePath) || !fs.existsSync(blueprintPath)) {
    issues.push({
      rule: 'source-exists',
      message: 'SKILL.md or docs/skill-builder-blueprint.md is missing.',
    });
    return issues;
  }

  const templateSource = fs.readFileSync(templatePath, 'utf-8');
  const blueprintSource = fs.readFileSync(blueprintPath, 'utf-8');

  // Build both targets into a scratch directory so the checks below see exactly what a real
  // install would contain, without touching the user's installed ~/.claude/skills.
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-builder-validate-'));
  let portable: ReturnType<typeof buildBuilderSkill>;
  let claudeCode: ReturnType<typeof buildBuilderSkill>;
  try {
    portable = buildBuilderSkill({
      target: 'portable',
      out: path.join(scratchDir, 'portable'),
      templatePath,
      blueprintPath,
    });
    claudeCode = buildBuilderSkill({
      target: 'claude-code',
      out: path.join(scratchDir, 'claude-code'),
      templatePath,
      blueprintPath,
    });
  } catch (error) {
    issues.push({
      rule: 'build-succeeds',
      message: `Building the skill failed: ${(error as Error).message}`,
    });
    fs.rmSync(scratchDir, { recursive: true, force: true });
    return issues;
  }

  const portableSkill = fs.readFileSync(portable.skillPath, 'utf-8');
  const claudeCodeSkill = fs.readFileSync(claudeCode.skillPath, 'utf-8');
  const portableRef = fs.readFileSync(portable.referencePath, 'utf-8');
  const claudeCodeRef = fs.readFileSync(claudeCode.referencePath, 'utf-8');

  // 1. Valid portable Agent Skills frontmatter: only open-spec fields, no platform field.
  const portableKeys = readFrontmatterKeys(portableSkill);
  if (portableKeys.length === 0) {
    issues.push({ rule: 'portable-frontmatter', message: 'Portable build has no YAML frontmatter.', file: portable.skillPath });
  } else {
    const nonSpecKeys = portableKeys.filter((k) => !OPEN_SPEC_FRONTMATTER_FIELDS.has(k));
    if (nonSpecKeys.length > 0) {
      issues.push({
        rule: 'portable-frontmatter',
        message: `Portable frontmatter carries non-open-spec field(s): ${nonSpecKeys.join(', ')}.`,
        file: portable.skillPath,
      });
    }
    if (!portableKeys.includes('name') || !portableKeys.includes('description')) {
      issues.push({
        rule: 'portable-frontmatter',
        message: 'Portable frontmatter must declare both "name" and "description".',
        file: portable.skillPath,
      });
    }
  }

  // 2. Valid Claude Code adapter frontmatter: open-spec fields plus the CC-only invocation field.
  const ccKeys = readFrontmatterKeys(claudeCodeSkill);
  if (!ccKeys.includes('name') || !ccKeys.includes('description')) {
    issues.push({
      rule: 'claude-code-frontmatter',
      message: 'Claude Code frontmatter must declare both "name" and "description".',
      file: claudeCode.skillPath,
    });
  }
  if (!ccKeys.includes('disable-model-invocation')) {
    issues.push({
      rule: 'claude-code-frontmatter',
      message: 'Claude Code frontmatter is missing "disable-model-invocation".',
      file: claudeCode.skillPath,
    });
  }
  if (!/^disable-model-invocation: true$/m.test(readFrontmatterBlock(claudeCodeSkill))) {
    issues.push({
      rule: 'claude-code-frontmatter',
      message: '"disable-model-invocation" must be set to true in the Claude Code build.',
      file: claudeCode.skillPath,
    });
  }

  // 3. Required blueprint reference exists, in both build targets.
  if (!fs.existsSync(portable.referencePath)) {
    issues.push({ rule: 'blueprint-reference-exists', message: 'Portable build has no reference/blueprint.md.', file: portable.referencePath });
  }
  if (!fs.existsSync(claudeCode.referencePath)) {
    issues.push({ rule: 'blueprint-reference-exists', message: 'Claude Code build has no reference/blueprint.md.', file: claudeCode.referencePath });
  }
  if (!templateSource.includes('reference/blueprint.md')) {
    issues.push({
      rule: 'blueprint-reference-exists',
      message: 'SKILL.md does not point at reference/blueprint.md.',
      file: templatePath,
    });
  }

  // 4. Built blueprint exactly matches source, for both targets.
  const expectedBlueprint = blueprintSource.trimEnd() + '\n';
  if (portableRef !== expectedBlueprint) {
    issues.push({
      rule: 'blueprint-matches-source',
      message: 'Portable build\'s reference/blueprint.md differs from docs/skill-builder-blueprint.md.',
      file: portable.referencePath,
    });
  }
  if (claudeCodeRef !== expectedBlueprint) {
    issues.push({
      rule: 'blueprint-matches-source',
      message: 'Claude Code build\'s reference/blueprint.md differs from docs/skill-builder-blueprint.md.',
      file: claudeCode.referencePath,
    });
  }

  // 5. No duplicated architecture rules in adapters: a long paragraph from the blueprint should
  // not be copy-pasted into a wrapper that is supposed to only point at it (blueprint section 5).
  const blueprintParagraphs = paragraphs(blueprintSource).map(normalizeWhitespace);
  const adapterFiles: Array<{ label: string; content: string }> = [
    { label: templatePath, content: templateSource },
  ];
  if (fs.existsSync(claudeSkillTemplatePath)) {
    adapterFiles.push({ label: claudeSkillTemplatePath, content: fs.readFileSync(claudeSkillTemplatePath, 'utf-8') });
  }
  if (fs.existsSync(buildScriptPath)) {
    adapterFiles.push({ label: buildScriptPath, content: fs.readFileSync(buildScriptPath, 'utf-8') });
  }
  for (const adapter of adapterFiles) {
    const normalizedAdapter = normalizeWhitespace(adapter.content);
    for (const para of blueprintParagraphs) {
      if (normalizedAdapter.includes(para)) {
        issues.push({
          rule: 'no-duplicated-rules',
          message: `Adapter file duplicates a blueprint paragraph verbatim instead of pointing at it: "${para.slice(0, 60)}..."`,
          file: adapter.label,
        });
      }
    }
  }

  // 6. No obsolete requirement for a separate slash-command file as a way to invoke the skill.
  const obsoleteSlashCommandRe = /\b(must|need to|required? to)\s+(also\s+)?(generate|create|add)\s+a\s+(separate\s+)?slash[- ]command\b/i;
  for (const adapter of [templateSource, ...(fs.existsSync(claudeSkillTemplatePath) ? [fs.readFileSync(claudeSkillTemplatePath, 'utf-8')] : [])]) {
    if (obsoleteSlashCommandRe.test(adapter)) {
      issues.push({
        rule: 'no-obsolete-slash-command-requirement',
        message: 'Canonical/adapter text claims a separate slash command is required to invoke the skill; current Claude Code invokes installed skills directly.',
      });
    }
  }

  // 7. No unfinished placeholders in the canonical source, blueprint, or either build output.
  const placeholderTargets: Array<{ label: string; content: string }> = [
    { label: templatePath, content: templateSource },
    { label: blueprintPath, content: blueprintSource },
    { label: portable.skillPath, content: portableSkill },
    { label: claudeCode.skillPath, content: claudeCodeSkill },
  ];
  for (const target of placeholderTargets) {
    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(target.content)) {
        issues.push({
          rule: 'no-unfinished-placeholders',
          message: `Matches unfinished-placeholder pattern ${pattern}.`,
          file: target.label,
        });
      }
    }
  }

  // 8. No broken relative references: every backtick'd file path or markdown link target that
  // looks like a repo path must resolve to a real file, from the referencing file's own directory
  // (the built targets are self-contained: SKILL.md + reference/blueprint.md side by side).
  // The source template's own "reference/blueprint.md" mention describes the *built* layout (the
  // blueprint sits next to SKILL.md only after building), so it is checked against each build
  // output's directory, not the source template's own directory, where no such file exists yet.
  const relativeCheckTargets: Array<{ file: string; content: string; baseDir: string }> = [
    { file: portable.skillPath, content: portableSkill, baseDir: path.dirname(portable.skillPath) },
    { file: claudeCode.skillPath, content: claudeCodeSkill, baseDir: path.dirname(claudeCode.skillPath) },
  ];
  for (const target of relativeCheckTargets) {
    for (const ref of extractReferencedPaths(target.content)) {
      if (path.isAbsolute(ref)) continue;
      const resolved = path.join(target.baseDir, ref);
      if (!fs.existsSync(resolved)) {
        issues.push({
          rule: 'no-broken-relative-references',
          message: `Reference "${ref}" does not resolve to a file on disk.`,
          file: target.file,
        });
      }
    }
  }

  // 9. No dependency on Superpowers: the portable skill must stand on its own under the open
  // Agent Skills spec, so it must never assume the Superpowers plugin is installed.
  for (const target of [
    { label: templatePath, content: templateSource },
    { label: portable.skillPath, content: portableSkill },
    { label: claudeCode.skillPath, content: claudeCodeSkill },
  ]) {
    if (/superpowers/i.test(target.content)) {
      issues.push({ rule: 'no-superpowers-dependency', message: 'References Superpowers.', file: target.label });
    }
  }

  // 10. No accidental provider-specific requirement leaking into the portable artifact.
  const providerSpecificRe = /\b(requires?|only works? in|only usable in)\s+(anthropic|claude(?:\s+code)?)\b/i;
  if (providerSpecificRe.test(portableSkill)) {
    issues.push({
      rule: 'no-accidental-provider-requirement',
      message: 'Portable build text claims a specific provider/host is required.',
      file: portable.skillPath,
    });
  }
  if (portableKeys.includes('disable-model-invocation')) {
    issues.push({
      rule: 'no-accidental-provider-requirement',
      message: 'Portable frontmatter carries the Claude Code-only "disable-model-invocation" field.',
      file: portable.skillPath,
    });
  }

  // 11. No em dashes in newly written content. Scoped to files explicitly named as new for the
  // current change, not swept across the whole (pre-existing) blueprint and template.
  const newContentFiles = options.newContentFiles ?? DEFAULT_NEW_CONTENT_FILES;
  for (const relativePath of newContentFiles) {
    const absolute = path.join(repoRoot, relativePath);
    if (!fs.existsSync(absolute)) continue;
    const content = fs.readFileSync(absolute, 'utf-8');
    if (content.includes(EM_DASH)) {
      issues.push({ rule: 'no-em-dashes', message: 'Contains an em dash.', file: absolute });
    }
  }

  // 12. The instructions keep pointing at the blueprint's section on what a skill loads (7.15), and
  // that section still exists. Without the pointer, a skill created with this one would no longer
  // have its context decided unless the user thought to ask.
  if (!/^### 7\.15 /m.test(blueprintSource)) {
    issues.push({ rule: 'context-guidance-reachable', message: 'The blueprint has no section 7.15.', file: blueprintPath });
  }
  if (!/\bsection 7\.15\b/.test(templateSource)) {
    issues.push({
      rule: 'context-guidance-reachable',
      message: 'SKILL.md no longer points at the blueprint\'s section 7.15.',
      file: templatePath,
    });
  }

  fs.rmSync(scratchDir, { recursive: true, force: true });

  return issues;
}

function main() {
  const issues = validateBuilderSkill();
  if (issues.length === 0) {
    console.log('Skill Builder validation passed: 0 issues.');
    return;
  }
  console.error(`Skill Builder validation failed: ${issues.length} issue(s).\n`);
  for (const issue of issues) {
    console.error(`[${issue.rule}] ${issue.message}${issue.file ? ` (${issue.file})` : ''}`);
  }
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}
