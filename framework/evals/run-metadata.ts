/**
 * What identifies exactly what produced a persisted eval run, so a result can be reproduced or
 * dismissed as stale. Every skill's eval scripts attach this to each run they save.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { hashObject } from '../hash';
import { snapshotVersions, type RunVersions } from '../manifest/versions';
import type { DatasetName } from '../manifest/skill-manifest';

const FRAMEWORK_DIR = path.resolve(__dirname, '..');

export interface RunMetadata {
  /**
   * Version of the saved result's own shape. Each skill sets it. Bump it when an older result would
   * mean something different (a field repurposed), not for a new optional field.
   */
  schemaVersion: number;
  /** ISO 8601. */
  timestamp: string;
  /** null when not run inside a git checkout, or git is unavailable. */
  gitCommit: string | null;
  /** True when the skill or the framework has uncommitted changes. null when it cannot be determined. */
  gitDirty: boolean | null;
  /** Ties every provider call of this run to a usage ledger, when the skill keeps one. */
  runId: string | null;
  skillName: string;
  skillVersion: string;
  /** Which dataset ran: "benchmark" or "golden". */
  dataset: DatasetName;
  /** "<dataset>-v<version>", e.g. "golden-v1". Kept as one readable string for reports. */
  benchmarkVersion: string;
  /** The versions and hashes of the skill, every prompt and every dataset. */
  versions: RunVersions;
  /** Same as versions.skill.hash. Kept as a flat field so older readers keep working. */
  skillHash: string;
  /** Same as versions.prompts.evaluator.hash, when the skill has an evaluator prompt. */
  evaluatorPromptHash?: string;
  /** Hash of the cases this run actually loaded and used. */
  caseInputHash: string;
  /** Hash of the eval and runtime configuration in effect for this run. */
  configHash: string;
  /** Name of the provider used for the generator role (e.g. "anthropic"). */
  provider: string;
}

export interface BuildRunMetadataOptions {
  skillDir: string;
  dataset: DatasetName;
  schemaVersion: number;
  /** The cases actually loaded and used for this run. */
  cases: unknown;
  /** The eval and runtime configuration actually in effect for this run. */
  config: unknown;
  provider: string;
  runId?: string | null;
  /** Directory git commands run from. Defaults to the skill folder. */
  cwd?: string;
  /** What "dirty" is judged over. Defaults to the skill folder and the framework folder. */
  watchPaths?: string[];
  /** Injectable for tests; defaults to `new Date()`. */
  now?: () => Date;
}

// stdio 'ignore' on stderr keeps "fatal: not a git repository" out of the caller's console; that
// case is expected and reported as null, not an error worth surfacing.
const GIT_STDIO: ['ignore', 'pipe', 'ignore'] = ['ignore', 'pipe', 'ignore'];

function getGitCommit(cwd: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf-8', stdio: GIT_STDIO }).trim();
  } catch {
    return null;
  }
}

function isGitDirty(cwd: string, watchPaths: string[]): boolean | null {
  try {
    const status = execFileSync('git', ['status', '--porcelain', '--', ...watchPaths], {
      cwd,
      encoding: 'utf-8',
      stdio: GIT_STDIO,
    });
    return status.trim().length > 0;
  } catch {
    return null;
  }
}

export function buildRunMetadata(options: BuildRunMetadataOptions): RunMetadata {
  const cwd = options.cwd ?? options.skillDir;
  const watchPaths = options.watchPaths ?? [options.skillDir, FRAMEWORK_DIR];
  const versions = snapshotVersions(options.skillDir);
  const dataset = versions.datasets[options.dataset];
  if (!dataset) throw new Error(`skill.json does not declare a "${options.dataset}" dataset`);

  return {
    schemaVersion: options.schemaVersion,
    timestamp: (options.now ?? (() => new Date()))().toISOString(),
    gitCommit: getGitCommit(cwd),
    gitDirty: isGitDirty(cwd, watchPaths),
    runId: options.runId ?? null,
    skillName: versions.skill.name,
    skillVersion: versions.skill.version,
    dataset: options.dataset,
    benchmarkVersion: `${options.dataset}-v${dataset.version}`,
    versions,
    skillHash: versions.skill.hash,
    evaluatorPromptHash: versions.prompts.evaluator?.hash,
    caseInputHash: hashObject(options.cases),
    configHash: hashObject(options.config),
    provider: options.provider,
  };
}
