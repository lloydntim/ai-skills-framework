/**
 * A small, durable record of an approved eval run, kept in git so runs can be compared over time.
 *
 * The full run (approved-baseline.json and the raw runs in evals/results/) holds every output the
 * model wrote, and for a skill whose cases are built from a real person's CV those outputs are that
 * person's text. The summary keeps only what identifies the run and what it measured: versions and
 * hashes, model roles, the configuration, and numbers. It never holds output, case or CV text.
 * That is enforced here, not left to the caller: from the scores and totals only numbers, booleans
 * and the variant label survive.
 */
import fs from 'node:fs';
import type { RequestLogEntry } from '../provider/instrumentation';
import type { ModelRolesConfig } from '../provider/model-roles';
import type { RunMetadata } from './run-metadata';
import { buildTokenUsageReport, type PromptPartAggregate, type RequestTypeAggregate } from './token-usage-report';

export const RUN_SUMMARY_SCHEMA_VERSION = 1;
export const RUN_HISTORY_FILE = 'history.jsonl';

type Scalars = { [key: string]: number | boolean | string | Scalars };

export interface RunSummary {
  summarySchemaVersion: number;
  /** When the run was approved. The run's own time is `timestamp`. */
  approvedAt: string;
  timestamp: string;
  skillName: string;
  skillVersion: string;
  dataset: string;
  benchmarkVersion: string;
  gitCommit: string | null;
  gitDirty: boolean | null;
  runId: string | null;
  versions: RunMetadata['versions'];
  caseInputHash: string;
  configHash: string;
  modelRoles: ModelRolesConfig;
  /** The configuration the run used (eval, runtime, models). Never case data. */
  config?: unknown;
  /** Per-variant averages: numbers and the variant label only. */
  aggregates: Scalars[];
  /** Run-wide totals, when the skill records them: numbers only. */
  totals?: Scalars;
  /** Tokens per request type, and the size of each prompt part, when the run recorded its requests. */
  requests?: { byRequestType: RequestTypeAggregate[]; promptParts: PromptPartAggregate[] };
}

export interface SummarizeRunInput {
  run: RunMetadata & { modelRoles: ModelRolesConfig; aggregates: readonly object[]; totals?: object };
  config?: unknown;
  requests?: readonly RequestLogEntry[];
  /** Injectable for tests; defaults to `new Date()`. */
  now?: () => Date;
}

/** The only string kept from scores and totals: which variant a row is for. */
const KEPT_LABELS = new Set(['variant']);

function numbersOnly(value: object): Scalars {
  const out: Scalars = {};
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'number' || typeof v === 'boolean') out[key] = v;
    else if (typeof v === 'string' && KEPT_LABELS.has(key)) out[key] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = numbersOnly(v);
      if (Object.keys(nested).length > 0) out[key] = nested;
    }
  }
  return out;
}

export function summarizeRun(input: SummarizeRunInput): RunSummary {
  const { run } = input;
  const report = input.requests ? buildTokenUsageReport(input.requests) : undefined;
  return {
    summarySchemaVersion: RUN_SUMMARY_SCHEMA_VERSION,
    approvedAt: (input.now ?? (() => new Date()))().toISOString(),
    timestamp: run.timestamp,
    skillName: run.skillName,
    skillVersion: run.skillVersion,
    dataset: run.dataset,
    benchmarkVersion: run.benchmarkVersion,
    gitCommit: run.gitCommit,
    gitDirty: run.gitDirty,
    runId: run.runId,
    versions: run.versions,
    caseInputHash: run.caseInputHash,
    configHash: run.configHash,
    modelRoles: run.modelRoles,
    ...(input.config !== undefined ? { config: input.config } : {}),
    aggregates: run.aggregates.map(numbersOnly),
    ...(run.totals ? { totals: numbersOnly(run.totals) } : {}),
    ...(report ? { requests: { byRequestType: report.byRequestType, promptParts: report.promptParts } } : {}),
  };
}

/** Appends one summary as one line. The file is append-only: earlier lines are never rewritten. */
export function appendRunSummary(file: string, summary: RunSummary): void {
  fs.appendFileSync(file, JSON.stringify(summary) + '\n');
}

export function readRunHistory(file: string): RunSummary[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RunSummary);
}
