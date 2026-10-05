import fs from 'node:fs';
import path from 'node:path';
import type { ModelRole } from '../provider/model-roles';
import type { PromptComponentSize, RequestType } from '../provider/request-metadata';
import type { TokenUsage } from '../provider/types';
import type { FailureKind, FailureSummary } from './failure';
import type { RuntimeSettings } from './config';
import type { StateChange } from './state';
import type { ToolCallRecord } from './tools';
import type { IssueSource, ValidationDecision } from './validation';

/**
 * A record of one run, for finding out afterwards what happened. It is deliberately made only of
 * things that cannot carry someone's text: names, counts, timings, identifiers chosen by code, and
 * character counts. There is no field for the input, the output, a prompt, a validator's message
 * or an error message, so none of them can be logged by mistake. Adding such a field is a decision
 * to make on purpose (see docs/RUNTIME.md, "Traces and privacy").
 */
export interface ModelCallRecord {
  role: ModelRole;
  requestType: RequestType | 'unclassified';
  provider: string;
  model: string;
  ok: boolean;
  /** True when the role's fallback model answered because the preferred one failed retryably. */
  usedFallback: boolean;
  usage?: TokenUsage;
  latencyMs?: number;
  cost?: number;
  /** Character counts of the prompt parts, as the call site reported them. Not tokens. */
  components?: PromptComponentSize[];
  failureKind?: FailureKind;
}

export interface ValidationRecord {
  /** 0 is the first draft; 1 is the draft after the first revision, and so on. */
  attempt: number;
  status: ValidationDecision['status'] | 'skipped';
  issues: Array<{ source: IssueSource; code: string }>;
}

export interface RunTrace {
  runId: string;
  skill: string;
  startedAt: number;
  finishedAt: number;
  states: StateChange[];
  /** Which provider and model played each role this run used. */
  models: Partial<Record<ModelRole, { provider: string; model: string }>>;
  settings: RuntimeSettings;
  /** Drafts produced: the first generation plus every revision. */
  attempts: number;
  validationResults: ValidationRecord[];
  modelCalls: ModelCallRecord[];
  toolCalls: ToolCallRecord[];
  tokenUsage: TokenUsage;
  /** Undefined only if no call reported a cost; see BudgetTracker for why that is not zero. */
  cost?: number;
  finalStatus: 'completed' | 'failed';
  failure?: FailureSummary;
}

/** Codes are identifiers a skill chose, never text. Anything else is replaced rather than logged. */
const SAFE_CODE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

export function safeCode(code: string): string {
  return SAFE_CODE.test(code) ? code : 'unspecified';
}

export function sumUsage(calls: readonly { usage?: TokenUsage }[]): TokenUsage {
  const total: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 };
  for (const { usage } of calls) {
    total.inputTokens! += usage?.inputTokens ?? 0;
    total.outputTokens! += usage?.outputTokens ?? 0;
    total.totalTokens! += usage?.totalTokens ?? 0;
    total.cachedInputTokens! += usage?.cachedInputTokens ?? 0;
    total.reasoningTokens! += usage?.reasoningTokens ?? 0;
  }
  return total;
}

/** Undefined only when nothing was reported, so an unmeasured run does not read as a free one. */
export function sumOptional(values: readonly (number | undefined)[]): number | undefined {
  const known = values.filter((v): v is number => v !== undefined);
  return known.length === 0 ? undefined : known.reduce((a, b) => a + b, 0);
}

/** One role's share of a run, as a skill reports it in its own result type. */
export interface RoleSpend {
  requestCount: number;
  usage: TokenUsage;
  latencyMs?: number;
  cost?: number;
}

/**
 * The calls one role made and what they cost, or undefined if the role made none, so each skill
 * decides how "did not run" reads in its own result. Failed calls are not requests that returned
 * and carry no usage, so they are left out.
 */
export function spendOf(calls: readonly ModelCallRecord[], role?: ModelRole): RoleSpend | undefined {
  const made = calls.filter((c) => c.ok && (role === undefined || c.role === role));
  if (made.length === 0) return undefined;
  return {
    requestCount: made.length,
    usage: sumUsage(made),
    latencyMs: sumOptional(made.map((c) => c.latencyMs)),
    cost: sumOptional(made.map((c) => c.cost)),
  };
}

/** Where finished traces go. A sink must not throw for the sake of the run; the controller guards it anyway. */
export interface TraceSink {
  write(trace: RunTrace): void | Promise<void>;
}

export class MemoryTraceSink implements TraceSink {
  readonly traces: RunTrace[] = [];
  write(trace: RunTrace): void {
    this.traces.push(trace);
  }
}

/**
 * Appends one JSON line per run to a local file. Point it under a skill's `data/` folder, which git
 * ignores (skills/*\/data/): a trace holds no text, but it is still runtime output and not source.
 */
export class JsonlTraceSink implements TraceSink {
  constructor(private readonly file: string) {}

  write(trace: RunTrace): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, `${JSON.stringify(trace)}\n`);
  }
}
