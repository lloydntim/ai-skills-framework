import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RecordUsageInput, UsageAttemptRecord } from './types';

/** Default: <repo root>/data/usage. This file lives at src/usage/store.ts, two levels below root. */
function defaultUsageDir(): string {
  return path.resolve(__dirname, '..', '..', 'data', 'usage');
}

function usageDir(): string {
  const override = process.env.MODEL_USAGE_DIR;
  return override ? path.resolve(override) : defaultUsageDir();
}

function dayFilePath(now: Date): string {
  const day = now.toISOString().slice(0, 10); // UTC calendar day, e.g. "2026-09-15"
  return path.join(usageDir(), `${day}.jsonl`);
}

/**
 * Appends one attempt record as a single JSON line. Never throws: a disk error here must not take
 * down the model call it is trying to describe. On failure it logs to stderr (stdout is reserved
 * for the MCP JSON-RPC stream on the model-router side) and drops the record.
 */
export function recordUsage(input: RecordUsageInput): UsageAttemptRecord {
  const now = new Date();

  const record: UsageAttemptRecord = {
    schemaVersion: 1,
    attemptId: randomUUID(),
    runId: process.env.MODEL_RUN_ID ?? null,
    timestamp: now.toISOString(),
    source: input.source,
    tool: input.tool,
    provider: input.provider,
    model: input.model,
    status: input.status,
    errorMessage: input.errorMessage,
    durationMs: input.durationMs,
    usage: input.usage,
    usageUnavailable: input.usage === undefined,
    estimatedCost: input.estimatedCost,
    estimatedCostCurrency: input.estimatedCost !== undefined ? 'USD' : undefined,
    providerReportedCost: input.providerReportedCost,
    providerReportedCostCurrency:
      input.providerReportedCost !== undefined ? (input.providerReportedCostCurrency ?? 'USD') : undefined,
    costUnavailable: input.estimatedCost === undefined && input.providerReportedCost === undefined,
  };

  try {
    const filePath = dayFilePath(now);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n');
  } catch (err) {
    console.error(`[usage] failed to persist attempt ${record.attemptId}:`, err);
  }

  return record;
}
