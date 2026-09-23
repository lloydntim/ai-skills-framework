import type { AggregateScore, CaseResult, Variant } from './types';

function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Shared by run-evals.ts and run-regression.ts so both compute a variant's summary the same way. */
export function aggregateForVariant(variant: Variant, results: CaseResult[]): AggregateScore {
  const group = results.filter((r) => r.variant === variant);
  return {
    variant,
    cases: group.length,
    avgFaithfulness: avg(group.map((r) => r.quality.faithfulness)),
    avgNaturalness: avg(group.map((r) => r.quality.naturalness)),
    avgCvQuality: avg(group.map((r) => r.quality.cvQuality)),
    avgTerminology: avg(group.map((r) => r.quality.terminology)),
    avgConciseness: avg(group.map((r) => r.quality.conciseness)),
    avgOverall: avg(group.map((r) => r.quality.overall)),
    avgTokens: avg(group.map((r) => r.output.usage?.totalTokens ?? 0)),
    avgLatencyMs: avg(group.map((r) => r.output.latencyMs ?? 0)),
  };
}
