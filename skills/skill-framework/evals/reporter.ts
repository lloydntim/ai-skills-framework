import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { hashObject, sha256 } from '@skills/framework/hash';
import type { CheckName } from './checks';

export interface FrameworkCheckOutcome {
  name: CheckName;
  ok: boolean;
  detail: string;
}

export interface FrameworkCaseResult {
  caseId: string;
  variant: 'A' | 'B';
  transcript: string;
  checks: FrameworkCheckOutcome[];
  passed: boolean;
}

export interface FrameworkRunResult {
  timestamp: string;
  mode: 'smoke' | 'full' | 'compare' | 'approve';
  provider: string;
  model: string;
  gitCommit: string | null;
  gitDirty: boolean | null;
  skillHash: string;
  casesHash: string;
  configHash: string;
  results: FrameworkCaseResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    byVariant: Record<'A' | 'B', { total: number; passed: number }>;
  };
}

const GIT_STDIO: ['ignore', 'pipe', 'ignore'] = ['ignore', 'pipe', 'ignore'];

function getGitCommit(cwd: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf-8', stdio: GIT_STDIO }).trim();
  } catch {
    return null;
  }
}

function isGitDirty(cwd: string): boolean | null {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8', stdio: GIT_STDIO });
    return status.trim().length > 0;
  } catch {
    return null;
  }
}

export function buildSummary(results: FrameworkCaseResult[]): FrameworkRunResult['summary'] {
  const byVariant: FrameworkRunResult['summary']['byVariant'] = {
    A: { total: 0, passed: 0 },
    B: { total: 0, passed: 0 },
  };
  for (const r of results) {
    byVariant[r.variant].total += 1;
    if (r.passed) byVariant[r.variant].passed += 1;
  }
  return {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    byVariant,
  };
}

export interface BuildFrameworkRunOptions {
  mode: FrameworkRunResult['mode'];
  provider: string;
  model: string;
  results: FrameworkCaseResult[];
  skillContent: string;
  casesSnapshot: unknown;
  modelsConfig: unknown;
  cwd?: string;
}

export function buildFrameworkRunResult(options: BuildFrameworkRunOptions): FrameworkRunResult {
  const cwd = options.cwd ?? process.cwd();
  return {
    timestamp: new Date().toISOString(),
    mode: options.mode,
    provider: options.provider,
    model: options.model,
    gitCommit: getGitCommit(cwd),
    gitDirty: isGitDirty(cwd),
    skillHash: sha256(options.skillContent),
    casesHash: hashObject(options.casesSnapshot),
    configHash: hashObject(options.modelsConfig),
    results: options.results,
    summary: buildSummary(options.results),
  };
}

/** Every run is saved under its own timestamped filename. Nothing here ever overwrites a prior file. */
export function saveFrameworkRunResult(run: FrameworkRunResult, resultsDir: string): string {
  fs.mkdirSync(resultsDir, { recursive: true });
  const safeTimestamp = run.timestamp.replace(/[:.]/g, '-');
  const filePath = path.join(resultsDir, `${safeTimestamp}-${run.mode}.json`);
  if (fs.existsSync(filePath)) {
    throw new Error(`Refusing to overwrite an existing result file: ${filePath}`);
  }
  fs.writeFileSync(filePath, JSON.stringify(run, null, 2) + '\n');
  return filePath;
}

const APPROVED_BASELINE_FILENAME = 'approved-baseline.json';

/**
 * Locks in a run as the approved baseline. Never called implicitly by a run: the caller (the CLI's
 * approve mode) must pass `confirmedRead: true`, which it only does after the operator has
 * explicitly confirmed they read the transcripts, enforcing blueprint rule "Approve a baseline
 * only after reading the outputs" at the mechanism level, not just as a written instruction.
 */
export function approveFrameworkBaseline(run: FrameworkRunResult, resultsDir: string, confirmedRead: boolean): string {
  if (!confirmedRead) {
    throw new Error(
      'Refusing to approve a baseline without confirmation that the outputs were read. ' +
        'Re-run with --confirm-read=true only after you have actually read every transcript above.'
    );
  }
  fs.mkdirSync(resultsDir, { recursive: true });
  const filePath = path.join(resultsDir, APPROVED_BASELINE_FILENAME);
  fs.writeFileSync(filePath, JSON.stringify(run, null, 2) + '\n');
  return filePath;
}

export function loadApprovedFrameworkBaseline(resultsDir: string): FrameworkRunResult | null {
  const filePath = path.join(resultsDir, APPROVED_BASELINE_FILENAME);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}
