/**
 * pnpm skills:validate
 *
 * Checks every skill against this repository's framework: the public skills in `skills/`, and, when
 * PRIVATE_SKILLS_ROOT names the sibling private repository, the private skills in it too. Both go
 * through the same two checks, so there is one definition of "compatible with the framework":
 *
 * 1. `checkSkillPackage`, the layout and manifest rules every skill's own test already applies.
 * 2. A typecheck of the skill's code with `@skills/framework` resolved to this repository's
 *    `framework/`, whatever copy the skill's own workspace would link. A framework change that
 *    breaks a private skill shows up here, before either repository is committed.
 *
 * Nothing is written to either repository and no model is called. Problems are reported by skill
 * label and file path, never by the content of a private file.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { checkSkillPackage } from '../framework/manifest/check-skill-package';
import { allAvailableSkills, PRIVATE_SKILLS_ROOT_VAR, type PrivateSkillsRoot, type SkillSource, type SkillSourceOptions } from './skill-sources';

const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * Compiles one skill the way its own `tsconfig.json` does, with two things overridden: the compiler
 * options this repository's `tsconfig.base.json` sets, and where `@skills/framework` resolves.
 * Everything else (vitest, zod, @types) still resolves from the skill's own node_modules.
 */
export function typecheckAgainstFramework(skillDir: string, repoRoot: string = REPO_ROOT): string[] {
  const frameworkDir = path.join(repoRoot, 'framework');
  const baseConfig = path.join(repoRoot, 'tsconfig.base.json');
  const ownConfig = path.join(skillDir, 'tsconfig.json');

  const base = ts.readConfigFile(baseConfig, ts.sys.readFile);
  if (base.error) return [`tsconfig.base.json: ${ts.flattenDiagnosticMessageText(base.error.messageText, '\n')}`];

  const config = {
    extends: fs.existsSync(ownConfig) ? ownConfig : baseConfig,
    ...(fs.existsSync(ownConfig) ? {} : { include: ['.'] }),
    compilerOptions: {
      ...base.config.compilerOptions,
      noEmit: true,
      paths: { '@skills/framework': [frameworkDir], '@skills/framework/*': [path.join(frameworkDir, '*')] },
    },
  };
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, skillDir, undefined, path.join(skillDir, 'tsconfig.skills-validate.json'));
  const configErrors = parsed.errors.filter((d) => d.code !== 18003); // 18003: no inputs, reported below instead
  if (parsed.fileNames.length === 0) return ['no TypeScript files to typecheck'];

  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const where = (file: string) =>
    file.startsWith(frameworkDir + path.sep) ? `framework/${path.relative(frameworkDir, file)}` : path.relative(skillDir, file);
  return [...configErrors, ...ts.getPreEmitDiagnostics(program)].map((d) => {
    const message = `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
    if (!d.file || d.start === undefined) return message;
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
    return `${where(d.file.fileName)}(${line + 1},${character + 1}): ${message}`;
  });
}

export interface SkillReport {
  skill: SkillSource;
  problems: string[];
}

export interface ValidationResult {
  privateRoot: PrivateSkillsRoot;
  reports: SkillReport[];
  /** Worth knowing, not a failure: e.g. a private skill that shares a public skill's name. */
  notes: string[];
}

export interface ValidateSkillsOptions extends SkillSourceOptions {
  /** Off in tests that only exercise discovery and layout, since a typecheck takes seconds. */
  typecheck?: boolean;
}

export function validateSkills(options: ValidateSkillsOptions = {}): ValidationResult {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const { privateRoot, skills } = allAvailableSkills(options);

  const reports = skills.map((skill) => {
    // Messages from checkSkillPackage can name an absolute path inside the skill; the label says
    // which skill it is, so the folder is shortened to "." rather than printed.
    const layout = checkSkillPackage(skill.dir).map((problem) => problem.split(skill.dir).join('.'));
    const types = options.typecheck === false ? [] : typecheckAgainstFramework(skill.dir, repoRoot);
    return { skill, problems: [...layout, ...types] };
  });

  const publicNames = new Set(skills.filter((s) => s.origin === 'public').map((s) => s.name));
  const notes = skills
    .filter((s) => s.origin === 'private' && publicNames.has(s.name))
    .map((s) => `${s.label} has the same name as public/${s.name}; it is a separate copy, validated separately.`);

  return { privateRoot, reports, notes };
}

function describeRoot(root: PrivateSkillsRoot): string {
  switch (root.state) {
    case 'unset':
      return `${PRIVATE_SKILLS_ROOT_VAR} is not set: public skills only.`;
    case 'found':
      return `${PRIVATE_SKILLS_ROOT_VAR}=${root.configured}: public and private skills.`;
    case 'unusable':
      return root.reason === 'missing'
        ? `${PRIVATE_SKILLS_ROOT_VAR}=${root.configured} does not exist: public skills only.`
        : `${PRIVATE_SKILLS_ROOT_VAR}=${root.configured} is inside this repository; it must name a separate, sibling repository.`;
  }
}

export function main(options: ValidateSkillsOptions = {}): number {
  const { privateRoot, reports, notes } = validateSkills(options);
  console.log(describeRoot(privateRoot));
  for (const { skill, problems } of reports) {
    console.log(`${problems.length === 0 ? 'ok  ' : 'FAIL'} ${skill.label}`);
    for (const problem of problems) console.log(`       ${problem}`);
  }
  for (const note of notes) console.log(`note: ${note}`);

  const failed = reports.filter((r) => r.problems.length > 0).length;
  // A root that is configured but points inside this repository is a mistake, not an absence.
  const misconfigured = privateRoot.state === 'unusable' && privateRoot.reason === 'inside-public-repository';
  console.log(`${reports.length - failed} of ${reports.length} skills passed.`);
  return failed > 0 || misconfigured ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main();
}
