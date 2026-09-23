import { describe, expect, it } from 'vitest';
import type { RequestLogEntry } from '../provider/instrumentation';
import {
  aggregateByRequestType,
  aggregatePromptParts,
  averageCallCounts,
  buildTokenUsageReport,
  formatTokenUsageReport,
  summarizeByCase,
} from './token-usage-report';

function usage(totalTokens: number, inputTokens?: number, outputTokens?: number) {
  return { inputTokens: inputTokens ?? Math.round(totalTokens * 0.7), outputTokens: outputTokens ?? Math.round(totalTokens * 0.3), totalTokens };
}

function entry(overrides: Partial<RequestLogEntry> & Pick<RequestLogEntry, 'requestType'>): RequestLogEntry {
  return { usage: usage(100), ...overrides };
}

describe('aggregateByRequestType', () => {
  it('sums tokens and counts calls, grouped by request type', () => {
    const entries: RequestLogEntry[] = [
      entry({ requestType: 'initial-generation', usage: usage(1000) }),
      entry({ requestType: 'initial-generation', usage: usage(500) }),
      entry({ requestType: 'evaluator', usage: usage(300) }),
    ];

    const agg = aggregateByRequestType(entries);
    const translation = agg.find((a) => a.requestType === 'initial-generation')!;

    expect(translation.requestCount).toBe(2);
    expect(translation.totalTokens).toBe(1500);
    expect(translation.avgTokensPerRequest).toBe(750);
  });

  it('computes percentage of the grand total, not of the group', () => {
    const entries: RequestLogEntry[] = [
      entry({ requestType: 'initial-generation', usage: usage(750) }),
      entry({ requestType: 'evaluator', usage: usage(250) }),
    ];

    const agg = aggregateByRequestType(entries);
    expect(agg.find((a) => a.requestType === 'initial-generation')!.percentOfTotalTokens).toBeCloseTo(75, 6);
    expect(agg.find((a) => a.requestType === 'evaluator')!.percentOfTotalTokens).toBeCloseTo(25, 6);
  });

  it('sums separately reported input and output tokens', () => {
    const entries: RequestLogEntry[] = [
      entry({ requestType: 'revision', usage: usage(300, 200, 100) }),
      entry({ requestType: 'revision', usage: usage(300, 220, 80) }),
    ];

    const agg = aggregateByRequestType(entries);
    const revision = agg.find((a) => a.requestType === 'revision')!;
    expect(revision.totalInputTokens).toBe(420);
    expect(revision.totalOutputTokens).toBe(180);
  });

  it('treats a request with no usage as contributing zero tokens, not as missing', () => {
    const entries: RequestLogEntry[] = [
      entry({ requestType: 'semantic-validation', usage: undefined }),
      entry({ requestType: 'semantic-validation', usage: usage(400) }),
    ];

    const agg = aggregateByRequestType(entries);
    const validation = agg.find((a) => a.requestType === 'semantic-validation')!;
    expect(validation.requestCount).toBe(2);
    expect(validation.totalTokens).toBe(400);
  });

  it('records an untagged call site as unclassified rather than dropping it', () => {
    const entries: RequestLogEntry[] = [entry({ requestType: 'unclassified', usage: usage(200) })];

    const agg = aggregateByRequestType(entries);
    expect(agg).toHaveLength(1);
    expect(agg[0].requestType).toBe('unclassified');
    expect(agg[0].totalTokens).toBe(200);
  });

  it('omits request types that never appeared in the log', () => {
    const agg = aggregateByRequestType([entry({ requestType: 'evaluator' })]);
    expect(agg.map((a) => a.requestType)).toEqual(['evaluator']);
  });

  it('sorts by total tokens, highest first', () => {
    const entries: RequestLogEntry[] = [
      entry({ requestType: 'evaluator', usage: usage(100) }),
      entry({ requestType: 'initial-generation', usage: usage(900) }),
      entry({ requestType: 'revision', usage: usage(500) }),
    ];

    expect(aggregateByRequestType(entries).map((a) => a.requestType)).toEqual([
      'initial-generation',
      'revision',
      'evaluator',
    ]);
  });

  it('reports 0% for every group when no request in the log carries usage', () => {
    const agg = aggregateByRequestType([entry({ requestType: 'evaluator', usage: undefined })]);
    expect(agg[0].percentOfTotalTokens).toBe(0);
  });
});

describe('summarizeByCase', () => {
  it('groups by case id and sums per request type', () => {
    const entries: RequestLogEntry[] = [
      entry({ requestType: 'initial-generation', caseId: 'golden-001', usage: usage(500) }),
      entry({ requestType: 'semantic-validation', caseId: 'golden-001', usage: usage(200) }),
      entry({ requestType: 'initial-generation', caseId: 'golden-002', usage: usage(300) }),
    ];

    const summaries = summarizeByCase(entries);
    const c1 = summaries.find((c) => c.caseId === 'golden-001')!;

    expect(c1.totalTokens).toBe(700);
    expect(c1.requestCount).toBe(2);
    expect(c1.byRequestType['initial-generation']).toBe(500);
    expect(c1.byRequestType['semantic-validation']).toBe(200);
  });

  it('excludes requests with no case attribution entirely', () => {
    const entries: RequestLogEntry[] = [
      entry({ requestType: 'initial-generation', caseId: undefined, usage: usage(999) }),
      entry({ requestType: 'initial-generation', caseId: 'golden-001', usage: usage(100) }),
    ];

    const summaries = summarizeByCase(entries);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].caseId).toBe('golden-001');
  });
});

describe('averageCallCounts', () => {
  it('averages revision calls across every case, including cases with zero revisions', () => {
    const entries: RequestLogEntry[] = [
      entry({ requestType: 'initial-generation', caseId: 'golden-001' }),
      entry({ requestType: 'revision', caseId: 'golden-001' }),
      entry({ requestType: 'revision', caseId: 'golden-001' }),
      entry({ requestType: 'initial-generation', caseId: 'golden-002' }),
      // golden-002 needed no revision at all
      entry({ requestType: 'initial-generation', caseId: 'golden-003' }),
      entry({ requestType: 'revision', caseId: 'golden-003' }),
    ];

    const counts = averageCallCounts(entries);
    const revisions = counts.find((c) => c.requestType === 'revision')!;

    expect(revisions.totalCalls).toBe(3);
    // 3 revisions over 3 cases, not over the 2 cases that had any — 1.0, not 1.5.
    expect(revisions.avgCallsPerCase).toBeCloseTo(1, 10);
  });

  it('averages initial-generation as close to 1 per case for a normal run', () => {
    const entries: RequestLogEntry[] = [
      entry({ requestType: 'initial-generation', caseId: 'golden-001' }),
      entry({ requestType: 'initial-generation', caseId: 'golden-002' }),
    ];

    expect(averageCallCounts(entries).find((c) => c.requestType === 'initial-generation')!.avgCallsPerCase).toBe(1);
  });

  it('ignores unattributed requests when computing the case count to divide by', () => {
    const entries: RequestLogEntry[] = [
      entry({ requestType: 'revision', caseId: undefined }),
      entry({ requestType: 'revision', caseId: 'golden-001' }),
    ];

    // Only 1 real case, so 1 revision call / 1 case = 1.0, not 1 / 2 unattributed-inclusive.
    expect(averageCallCounts(entries).find((c) => c.requestType === 'revision')!.avgCallsPerCase).toBe(1);
  });
});

describe('buildTokenUsageReport', () => {
  const entries: RequestLogEntry[] = [
    entry({ requestType: 'initial-generation', caseId: 'golden-001', usage: usage(1000) }),
    entry({ requestType: 'semantic-validation', caseId: 'golden-001', usage: usage(300) }),
    entry({ requestType: 'revision', caseId: 'golden-001', usage: usage(1200) }),
    entry({ requestType: 'revalidation', caseId: 'golden-001', usage: usage(300) }),
    entry({ requestType: 'initial-generation', caseId: 'golden-002', usage: usage(400) }),
    entry({ requestType: 'semantic-validation', caseId: 'golden-002', usage: usage(250) }),
    entry({ requestType: 'evaluator', caseId: 'golden-001', usage: usage(600) }),
    entry({ requestType: 'evaluator', caseId: 'golden-002', usage: usage(600) }),
    entry({ requestType: 'pairwise-judge', caseId: 'golden-001', usage: usage(700) }),
  ];

  it('totals tokens and requests across the whole log', () => {
    const report = buildTokenUsageReport(entries);
    expect(report.totalRequests).toBe(9);
    expect(report.totalTokens).toBe(1000 + 300 + 1200 + 300 + 400 + 250 + 600 + 600 + 700);
    expect(report.caseCount).toBe(2);
  });

  it('computes average tokens per case correctly', () => {
    const report = buildTokenUsageReport(entries);
    const golden001 = 1000 + 300 + 1200 + 300 + 600 + 700;
    const golden002 = 400 + 250 + 600;
    expect(report.avgTokensPerCase).toBeCloseTo((golden001 + golden002) / 2, 6);
  });

  it('identifies the highest-cost case first', () => {
    const report = buildTokenUsageReport(entries, { topCasesCount: 2 });
    expect(report.highestCostCases[0].caseId).toBe('golden-001');
    expect(report.highestCostCases).toHaveLength(2);
  });

  it('respects a smaller topCasesCount', () => {
    const report = buildTokenUsageReport(entries, { topCasesCount: 1 });
    expect(report.highestCostCases).toHaveLength(1);
    expect(report.highestCostCases[0].caseId).toBe('golden-001');
  });

  it('orders every case highest total tokens first, not just picks the top one correctly', () => {
    const threeCases: RequestLogEntry[] = [
      entry({ requestType: 'initial-generation', caseId: 'low-cost', usage: usage(100) }),
      entry({ requestType: 'initial-generation', caseId: 'mid-cost', usage: usage(500) }),
      entry({ requestType: 'initial-generation', caseId: 'high-cost', usage: usage(900) }),
    ];

    const report = buildTokenUsageReport(threeCases, { topCasesCount: 3 });
    expect(report.highestCostCases.map((c) => c.caseId)).toEqual(['high-cost', 'mid-cost', 'low-cost']);
  });

  it('defaults to five highest-cost cases when not specified', () => {
    const report = buildTokenUsageReport(entries);
    expect(report.highestCostCases.length).toBeLessThanOrEqual(5);
  });

  it('reports average revision and revalidation calls per case', () => {
    const report = buildTokenUsageReport(entries);
    const revision = report.callCounts.find((c) => c.requestType === 'revision')!;
    const revalidation = report.callCounts.find((c) => c.requestType === 'revalidation')!;
    // golden-001 revised once, golden-002 never did -> 1 revision / 2 cases = 0.5
    expect(revision.avgCallsPerCase).toBeCloseTo(0.5, 6);
    expect(revalidation.avgCallsPerCase).toBeCloseTo(0.5, 6);
  });

  it('counts requests with no case id as unattributed, separate from caseCount', () => {
    const report = buildTokenUsageReport([...entries, entry({ requestType: 'initial-generation', caseId: undefined })]);
    expect(report.unattributedRequests).toBe(1);
    expect(report.caseCount).toBe(2);
  });

  it('handles an empty log without dividing by zero', () => {
    const report = buildTokenUsageReport([]);
    expect(report.totalTokens).toBe(0);
    expect(report.caseCount).toBe(0);
    expect(report.avgTokensPerCase).toBe(0);
    expect(report.highestCostCases).toEqual([]);
    expect(report.byRequestType).toEqual([]);
  });
});

describe('formatTokenUsageReport', () => {
  const entries: RequestLogEntry[] = [
    entry({ requestType: 'initial-generation', caseId: 'golden-001', usage: usage(1000) }),
    entry({ requestType: 'revision', caseId: 'golden-001', usage: usage(1200) }),
    entry({ requestType: 'evaluator', caseId: 'golden-001', usage: usage(300) }),
  ];

  it('names every request type present and its share of the total', () => {
    const report = formatTokenUsageReport(buildTokenUsageReport(entries));

    expect(report).toContain('initial-generation');
    expect(report).toContain('revision');
    expect(report).toContain('evaluator');
    expect(report).toMatch(/48\.0%/); // 1200 / 2500
  });

  it('names the highest-cost case', () => {
    const report = formatTokenUsageReport(buildTokenUsageReport(entries));
    expect(report).toContain('golden-001');
  });

  it('shows average calls per case', () => {
    const report = formatTokenUsageReport(buildTokenUsageReport(entries));
    expect(report).toContain('Average calls per case');
  });

  it('explains what "unclassified" means only when it actually appears', () => {
    const withUnclassified = formatTokenUsageReport(
      buildTokenUsageReport([...entries, entry({ requestType: 'unclassified', usage: usage(50) })])
    );
    expect(withUnclassified).toContain('untagged call site');

    const withoutUnclassified = formatTokenUsageReport(buildTokenUsageReport(entries));
    expect(withoutUnclassified).not.toContain('untagged call site');
  });

  it('mentions unattributed requests only when there are some', () => {
    const withProdCall = formatTokenUsageReport(
      buildTokenUsageReport([...entries, entry({ requestType: 'initial-generation', caseId: undefined })])
    );
    expect(withProdCall).toContain('no case attribution');

    expect(formatTokenUsageReport(buildTokenUsageReport(entries))).not.toContain('no case attribution');
  });

  it('renders an empty log without crashing', () => {
    expect(() => formatTokenUsageReport(buildTokenUsageReport([]))).not.toThrow();
  });
});

describe('aggregatePromptParts', () => {
  it('averages each recorded part per request type, and skips requests that recorded none', () => {
    const parts = aggregatePromptParts([
      entry({ requestType: 'initial-generation', components: [{ component: 'skill', chars: 100 }, { component: 'case-input', chars: 10 }] }),
      entry({ requestType: 'initial-generation', components: [{ component: 'skill', chars: 60 }] }),
      entry({ requestType: 'semantic-validation' }),
    ]);
    expect(parts).toEqual([
      { requestType: 'initial-generation', component: 'skill', requestCount: 2, avgChars: 80, maxChars: 100 },
      { requestType: 'initial-generation', component: 'case-input', requestCount: 1, avgChars: 10, maxChars: 10 },
    ]);
  });

  it('is shown in the formatted report, labelled as characters', () => {
    const report = buildTokenUsageReport([entry({ requestType: 'revision', components: [{ component: 'previous-output', chars: 1234 }] })]);
    expect(formatTokenUsageReport(report)).toMatch(/characters, not tokens[\s\S]*revision \/ previous-output: avg 1,234/);
  });
});

describe('reasoning tokens in the report', () => {
  it('sums the reasoning share per request type without folding it into any total', () => {
    const report = buildTokenUsageReport([
      entry({ requestType: 'initial-generation', caseId: 'c1', usage: { inputTokens: 1000, outputTokens: 900, totalTokens: 1900, reasoningTokens: 700 } }),
      entry({ requestType: 'initial-generation', caseId: 'c2', usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, reasoningTokens: 300 } }),
    ]);
    const generation = report.byRequestType.find((r) => r.requestType === 'initial-generation')!;

    expect(generation.totalReasoningTokens).toBe(1000);
    // Reasoning is part of output, so neither the output total nor the grand total moves because of it.
    expect(generation.totalOutputTokens).toBe(1400);
    expect(generation.totalTokens).toBe(3400);
    expect(report.totalTokens).toBe(3400);
  });

  it('reports zero, not undefined, for a request type whose provider sent no breakdown', () => {
    const report = buildTokenUsageReport([
      entry({ requestType: 'semantic-validation', caseId: 'c1', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } }),
    ]);

    expect(report.byRequestType[0].totalReasoningTokens).toBe(0);
  });

  it('prints the reasoning share of output, and explains that it is part of output rather than extra', () => {
    const text = formatTokenUsageReport(
      buildTokenUsageReport([
        entry({ requestType: 'initial-generation', caseId: 'c1', usage: { inputTokens: 1000, outputTokens: 1000, totalTokens: 2000, reasoningTokens: 900 } }),
      ])
    );

    expect(text).toContain('Reasoning');
    expect(text).toContain('90%');
    expect(text).toContain('part of the output column, not extra');
  });
});
