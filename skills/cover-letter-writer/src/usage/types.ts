/**
 * One row of the append-only usage ledger — one attempt at calling a model, success or failure.
 * Written by src/usage/store.ts. The shape is deliberately provider-agnostic, so a second writer
 * in another package can append rows a single report reads back without importing this file.
 */
export type UsageStatus = 'success' | 'failure';

export interface UsageTokens {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface UsageAttemptRecord {
  schemaVersion: 1;
  attemptId: string;
  /** Groups every call made within one script/eval invocation. Null when the caller set no MODEL_RUN_ID. */
  runId: string | null;
  /** ISO 8601 UTC. */
  timestamp: string;
  /** Which subsystem made the call. */
  source: 'model-router' | 'writer';
  /** model-router: 'ask' | 'review' | 'explain'. writer: a RequestType (see src/provider/request-metadata.ts). */
  tool: string;
  provider: string;
  model: string;
  status: UsageStatus;
  errorMessage?: string;
  durationMs?: number;
  usage?: UsageTokens;
  /** True whenever `usage` is absent — an explicit flag so a report can never mistake "not reported" for "zero". */
  usageUnavailable: boolean;
  /** Dollar estimate from a local pricing table. Undefined when the model has no table entry or usage is unavailable. */
  estimatedCost?: number;
  estimatedCostCurrency?: string;
  /** A real billed amount reported by the provider's own API, when it supplies one. Neither provider used here does today. */
  providerReportedCost?: number;
  providerReportedCostCurrency?: string;
  /** True when neither estimatedCost nor providerReportedCost could be produced. */
  costUnavailable: boolean;
}

/** What a caller supplies; recordUsage() fills in attemptId, runId, timestamp and the derived flags. */
export interface RecordUsageInput {
  source: UsageAttemptRecord['source'];
  tool: string;
  provider: string;
  model: string;
  status: UsageStatus;
  errorMessage?: string;
  durationMs?: number;
  usage?: UsageTokens;
  estimatedCost?: number;
  providerReportedCost?: number;
  providerReportedCostCurrency?: string;
}
