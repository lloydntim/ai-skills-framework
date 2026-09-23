import type { AggregateScore, CaseResult, RunTotals, Variant } from './types';
import type { TokenUsage } from '@skills/framework/provider/types';

function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Shared by run-evals.ts (and any future comparison tooling) so a variant's summary is always computed the same way. */
export function aggregateForVariant(variant: Variant, results: CaseResult[]): AggregateScore {
  const group = results.filter((r) => r.variant === variant);
  return {
    variant,
    cases: group.length,
    avgFactualGrounding: avg(group.map((r) => r.quality.factualGrounding)),
    avgJobRelevance: avg(group.map((r) => r.quality.jobRelevance)),
    avgProfessionalTone: avg(group.map((r) => r.quality.professionalTone)),
    avgSpecificity: avg(group.map((r) => r.quality.specificity)),
    avgNaturalness: avg(group.map((r) => r.quality.naturalness)),
    avgConciseness: avg(group.map((r) => r.quality.conciseness)),
    avgOverall: avg(group.map((r) => r.quality.overall)),
    avgTokens: avg(group.map((r) => r.output.usage?.totalTokens ?? 0)),
    avgLatencyMs: avg(group.map((r) => r.output.latencyMs ?? 0)),
    deterministicPassRate: group.length ? group.filter((r) => r.deterministic.pass).length / group.length : 0,
  };
}

function addUsage(a: TokenUsage, b: TokenUsage | undefined): TokenUsage {
  return {
    inputTokens: (a.inputTokens ?? 0) + (b?.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b?.outputTokens ?? 0),
    totalTokens: (a.totalTokens ?? 0) + (b?.totalTokens ?? 0),
    cachedInputTokens: (a.cachedInputTokens ?? 0) + (b?.cachedInputTokens ?? 0),
    reasoningTokens: (a.reasoningTokens ?? 0) + (b?.reasoningTokens ?? 0),
  };
}

/** undefined only when nothing folded in ever reported one, so a fully-unmeasured run stays undefined rather than reading as a real zero. */
function addOptional(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
}

/**
 * Sums every model call made anywhere in the run: each case result's own output (1 request for
 * A/B, the pipeline's real requestCount for C) plus that case's evaluator call. Never estimates a
 * call's usage/latency/cost when the provider did not report one.
 */
export function computeRunTotals(results: CaseResult[]): RunTotals {
  let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 };
  let totalLatencyMs: number | undefined;
  let totalCost: number | undefined;
  let requestCount = 0;

  for (const result of results) {
    totalUsage = addUsage(totalUsage, result.output.usage);
    totalLatencyMs = addOptional(totalLatencyMs, result.output.latencyMs);
    totalCost = addOptional(totalCost, result.output.cost);
    requestCount += result.output.requestCount;

    totalUsage = addUsage(totalUsage, result.evaluatorUsage);
    totalLatencyMs = addOptional(totalLatencyMs, result.evaluatorLatencyMs);
    totalCost = addOptional(totalCost, result.evaluatorCost);
    requestCount += 1; // one evaluator call per case result
  }

  return { requestCount, totalUsage, totalLatencyMs, totalCost };
}
