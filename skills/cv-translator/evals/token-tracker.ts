import type { CaseResult } from './types';

export interface TokenAggregate {
  variant: string;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgTotalTokens: number;
  totalTokens: number;
}

function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export function aggregateTokensByVariant(results: CaseResult[]): TokenAggregate[] {
  const byVariant = new Map<string, CaseResult[]>();
  for (const r of results) {
    const list = byVariant.get(r.variant) ?? [];
    list.push(r);
    byVariant.set(r.variant, list);
  }

  return [...byVariant.entries()].map(([variant, group]) => {
    const totals = group.map((r) => r.output.usage?.totalTokens ?? 0);
    const inputs = group.map((r) => r.output.usage?.inputTokens ?? 0);
    const outputs = group.map((r) => r.output.usage?.outputTokens ?? 0);
    return {
      variant,
      avgInputTokens: avg(inputs),
      avgOutputTokens: avg(outputs),
      avgTotalTokens: avg(totals),
      totalTokens: totals.reduce((a, b) => a + b, 0),
    };
  });
}

export function tokenDeltaPercent(baselineAvg: number, comparisonAvg: number): number {
  if (baselineAvg === 0) return 0;
  return ((comparisonAvg - baselineAvg) / baselineAvg) * 100;
}

/** Internal heuristic only — not an established industry metric. */
export function qualityPerThousandTokens(qualityGain: number, tokenIncrease: number): number {
  if (tokenIncrease === 0) return 0;
  return qualityGain / (tokenIncrease / 1000);
}
