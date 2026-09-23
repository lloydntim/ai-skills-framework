import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

/**
 * Where skills come from. Public skills are the folders under this repository's `skills/`. Private
 * skills live in a separate, sibling repository (never inside this one) with the same `skills/`
 * layout, and are found only when `PRIVATE_SKILLS_ROOT` names that repository. This file is the one
 * place that reads the variable, so every command that needs private skills resolves them the same
 * way, and a checkout without the private repository behaves exactly as a standalone public one.
 */
export const PRIVATE_SKILLS_ROOT_VAR = 'PRIVATE_SKILLS_ROOT';

const REPO_ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = 'skills';

export type PrivateSkillsRoot =
  /** Not configured: public skills only. The normal state of a public checkout. */
  | { state: 'unset' }
  /** Configured, but not usable: the folder is absent, or it sits inside this repository. */
  | { state: 'unusable'; configured: string; resolved: string; reason: 'missing' | 'inside-public-repository' }
  | { state: 'found'; configured: string; root: string };

export interface SkillSourceOptions {
  /** This repository's root. Relative values of the variable are resolved against it. */
  repoRoot?: string;
  /** Defaults to process.env. A value set here, even an empty one, wins over the root `.env`. */
  env?: NodeJS.ProcessEnv;
}

/** The shell wins, then the root `.env` (read for this one key, never loaded into process.env). */
function configuredValue(repoRoot: string, env: NodeJS.ProcessEnv): string {
  if (env[PRIVATE_SKILLS_ROOT_VAR] !== undefined) return env[PRIVATE_SKILLS_ROOT_VAR]!.trim();
  const envFile = path.join(repoRoot, '.env');
  if (!fs.existsSync(envFile)) return '';
  return (dotenv.parse(fs.readFileSync(envFile))[PRIVATE_SKILLS_ROOT_VAR] ?? '').trim();
}

/**
 * The private repository's root, resolved against this repository's root rather than the current
 * directory, so the same value works from the root, from a skill folder and from a test.
 */
export function resolvePrivateSkillsRoot(options: SkillSourceOptions = {}): PrivateSkillsRoot {
  const repoRoot = path.resolve(options.repoRoot ?? REPO_ROOT);
  const configured = configuredValue(repoRoot, options.env ?? process.env);
  if (!configured) return { state: 'unset' };

  const resolved = path.resolve(repoRoot, configured);
  if (resolved === repoRoot || resolved.startsWith(repoRoot + path.sep)) {
    return { state: 'unusable', configured, resolved, reason: 'inside-public-repository' };
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return { state: 'unusable', configured, resolved, reason: 'missing' };
  }
  return { state: 'found', configured, root: resolved };
}

export interface SkillSource {
  origin: 'public' | 'private';
  name: string;
  dir: string;
  /** `public/<name>` or `private/<name>`: what reports print, so a result never needs a path. */
  label: string;
}

/** Every folder directly under `<root>/skills/` that has a `skill.json`, sorted by name. */
function skillsUnder(root: string, origin: SkillSource['origin']): SkillSource[] {
  const skillsDir = path.join(root, SKILLS_DIR);
  if (!fs.existsSync(skillsDir)) return [];
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillsDir, entry.name, 'skill.json')))
    .map((entry) => ({ origin, name: entry.name, dir: path.join(skillsDir, entry.name), label: `${origin}/${entry.name}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function publicSkills(repoRoot: string = REPO_ROOT): SkillSource[] {
  return skillsUnder(repoRoot, 'public');
}

/** Empty unless the private root was found. */
export function privateSkills(privateRoot: PrivateSkillsRoot): SkillSource[] {
  return privateRoot.state === 'found' ? skillsUnder(privateRoot.root, 'private') : [];
}

export function allAvailableSkills(options: SkillSourceOptions = {}): { privateRoot: PrivateSkillsRoot; skills: SkillSource[] } {
  const privateRoot = resolvePrivateSkillsRoot(options);
  return { privateRoot, skills: [...publicSkills(options.repoRoot ?? REPO_ROOT), ...privateSkills(privateRoot)] };
}
