import type { RequestLogEntry } from '../provider/instrumentation';
import { REQUEST_TYPES, type PromptComponent, type RequestType } from '../provider/request-metadata';

export interface RequestTypeAggregate {
  requestType: RequestType;
  requestCount: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Of the tokens actually reported. Requests with no usage do not distort this. */
  percentOfTotalTokens: number;
  avgTokensPerRequest: number;
}

export interface CaseTokenSummary {
  caseId: string;
  totalTokens: number;
  requestCount: number;
  byRequestType: Partial<Record<RequestType, number>>;
}

export interface CallCountSummary {
  requestType: RequestType;
  totalCalls: number;
  /** Over every case seen in the log, including cases with zero calls of this type. */
  avgCallsPerCase: number;
}

/**
 * How large one prompt part was, on average, in the requests of one type that recorded it.
 * Characters, not tokens (see PromptComponentSize): the provider reports tokens per request only.
 */
export interface PromptPartAggregate {
  requestType: RequestType;
  component: PromptComponent;
  /** Requests of this type that recorded this part. */
  requestCount: number;
  avgChars: number;
  maxChars: number;
}

export interface TokenUsageReport {
  totalTokens: number;
  totalRequests: number;
  /** Distinct cases attributed in the log. Requests outside any case (caseId undefined) are not counted here. */
  caseCount: number;
  byRequestType: RequestTypeAggregate[];
  avgTokensPerCase: number;
  callCounts: CallCountSummary[];
  /** Sorted highest total tokens first. */
  highestCostCases: CaseTokenSummary[];
  /** Requests recorded with no case attribution — production usage, or a call made outside the per-case loop. */
  unattributedRequests: number;
  /** What each request type's prompt was made of. Empty when no call site recorded its parts. */
  promptParts: PromptPartAggregate[];
}

export interface TokenUsageReportOptions {
  /** How many cases to list under highestCostCases. Default 5. */
  topCasesCount?: number;
}

function tokensOf(entry: RequestLogEntry): number {
  return entry.usage?.totalTokens ?? 0;
}

/** Groups by request type in REQUEST_TYPES order, omitting types the log never used. */
function groupByRequestType(entries: readonly RequestLogEntry[]): Map<RequestType, RequestLogEntry[]> {
  const groups = new Map<RequestType, RequestLogEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.requestType) ?? [];
    list.push(entry);
    groups.set(entry.requestType, list);
  }
  return groups;
}

export function aggregateByRequestType(entries: readonly RequestLogEntry[]): RequestTypeAggregate[] {
  const totalTokens = entries.reduce((sum, e) => sum + tokensOf(e), 0);
  const groups = groupByRequestType(entries);

  return REQUEST_TYPES.filter((type) => groups.has(type))
    .map((requestType) => {
      const group = groups.get(requestType)!;
      const groupTotal = group.reduce((sum, e) => sum + tokensOf(e), 0);
      return {
        requestType,
        requestCount: group.length,
        totalTokens: groupTotal,
        totalInputTokens: group.reduce((sum, e) => sum + (e.usage?.inputTokens ?? 0), 0),
        totalOutputTokens: group.reduce((sum, e) => sum + (e.usage?.outputTokens ?? 0), 0),
        percentOfTotalTokens: totalTokens > 0 ? (groupTotal / totalTokens) * 100 : 0,
        avgTokensPerRequest: group.length > 0 ? groupTotal / group.length : 0,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

export function summarizeByCase(entries: readonly RequestLogEntry[]): CaseTokenSummary[] {
  const groups = new Map<string, RequestLogEntry[]>();
  for (const entry of entries) {
    if (entry.caseId === undefined) continue;
    const list = groups.get(entry.caseId) ?? [];
    list.push(entry);
    groups.set(entry.caseId, list);
  }

  return [...groups.entries()].map(([caseId, group]) => {
    const byRequestType: Partial<Record<RequestType, number>> = {};
    for (const entry of group) {
      byRequestType[entry.requestType] = (byRequestType[entry.requestType] ?? 0) + tokensOf(entry);
    }
    return {
      caseId,
      totalTokens: group.reduce((sum, e) => sum + tokensOf(e), 0),
      requestCount: group.length,
      byRequestType,
    };
  });
}

/**
 * Average calls per case, across every case attributed in the log — a case with no calls of a
 * given type counts as 0 for that type's average, not as excluded. This is what makes
 * "average revision calls per case" mean the actual retry rate rather than the rate among only the
 * cases that needed a retry.
 */
export function averageCallCounts(entries: readonly RequestLogEntry[]): CallCountSummary[] {
  const caseIds = new Set<string>();
  for (const entry of entries) {
    if (entry.caseId !== undefined) caseIds.add(entry.caseId);
  }
  const caseCount = caseIds.size;

  const groups = groupByRequestType(entries.filter((e) => e.caseId !== undefined));

  return REQUEST_TYPES.filter((type) => groups.has(type)).map((requestType) => {
    const totalCalls = groups.get(requestType)!.length;
    return {
      requestType,
      totalCalls,
      avgCallsPerCase: caseCount > 0 ? totalCalls / caseCount : 0,
    };
  });
}

/** Average and largest size of each prompt part, per request type, in REQUEST_TYPES order. */
export function aggregatePromptParts(entries: readonly RequestLogEntry[]): PromptPartAggregate[] {
  const groups = groupByRequestType(entries);
  const out: PromptPartAggregate[] = [];
  for (const requestType of REQUEST_TYPES.filter((type) => groups.has(type))) {
    const byComponent = new Map<PromptComponent, number[]>();
    for (const entry of groups.get(requestType)!) {
      for (const part of entry.components ?? []) {
        const sizes = byComponent.get(part.component) ?? [];
        sizes.push(part.chars);
        byComponent.set(part.component, sizes);
      }
    }
    for (const [component, sizes] of byComponent) {
      out.push({
        requestType,
        component,
        requestCount: sizes.length,
        avgChars: sizes.reduce((a, b) => a + b, 0) / sizes.length,
        maxChars: Math.max(...sizes),
      });
    }
  }
  return out;
}

/**
 * Builds the full aggregate report from a run's request log. Every figure here is derived from
 * recorded usage; nothing is estimated or invented.
 */
export function buildTokenUsageReport(
  entries: readonly RequestLogEntry[],
  options: TokenUsageReportOptions = {}
): TokenUsageReport {
  const topCasesCount = options.topCasesCount ?? 5;

  const totalTokens = entries.reduce((sum, e) => sum + tokensOf(e), 0);
  const caseSummaries = summarizeByCase(entries);
  const caseCount = caseSummaries.length;

  return {
    totalTokens,
    totalRequests: entries.length,
    caseCount,
    byRequestType: aggregateByRequestType(entries),
    avgTokensPerCase: caseCount > 0 ? caseSummaries.reduce((sum, c) => sum + c.totalTokens, 0) / caseCount : 0,
    callCounts: averageCallCounts(entries),
    highestCostCases: [...caseSummaries].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, topCasesCount),
    unattributedRequests: entries.filter((e) => e.caseId === undefined).length,
    promptParts: aggregatePromptParts(entries),
  };
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function padNum(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value;
}

function formatInt(value: number): string {
  return Math.round(value).toLocaleString('en-GB');
}

/** A compact terminal report: where the tokens went, by request type, then by case. */
export function formatTokenUsageReport(report: TokenUsageReport): string {
  const lines: string[] = [];

  lines.push('TOKEN USAGE BY REQUEST TYPE');
  lines.push('===========================');
  lines.push('');
  lines.push(`Total: ${formatInt(report.totalTokens)} tokens across ${report.totalRequests} request(s), ${report.caseCount} case(s).`);
  if (report.unattributedRequests > 0) {
    lines.push(`${report.unattributedRequests} request(s) had no case attribution (e.g. production usage outside the eval harness).`);
  }
  lines.push('');

  const header = ['Request type', 'Calls', 'Total tokens', '% of total', 'Avg/call'];
  const rows = report.byRequestType.map((r) => [
    r.requestType,
    String(r.requestCount),
    formatInt(r.totalTokens),
    `${r.percentOfTotalTokens.toFixed(1)}%`,
    formatInt(r.avgTokensPerRequest),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const renderRow = (cells: string[]) =>
    cells.map((c, i) => (i === 0 ? pad(c, widths[i]) : padNum(c, widths[i]))).join('  ');
  lines.push(renderRow(header));
  lines.push(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) lines.push(renderRow(row));

  const anyUnclassified = report.byRequestType.some((r) => r.requestType === 'unclassified');
  if (anyUnclassified) {
    lines.push('');
    lines.push('"unclassified" is a request made with no instrumentation metadata attached — an untagged call site.');
  }

  lines.push('');
  lines.push(`Average tokens per case: ${formatInt(report.avgTokensPerCase)}`);
  lines.push('');

  if (report.callCounts.length > 0) {
    lines.push('Average calls per case, by request type:');
    for (const c of report.callCounts) {
      lines.push(`  ${c.requestType}: ${c.avgCallsPerCase.toFixed(2)} (${c.totalCalls} total)`);
    }
    lines.push('');
  }

  if (report.highestCostCases.length > 0) {
    lines.push(`Highest-cost case(s) (top ${report.highestCostCases.length}):`);
    for (const c of report.highestCostCases) {
      const breakdown = Object.entries(c.byRequestType)
        .sort(([, a], [, b]) => b - a)
        .map(([type, tokens]) => `${type}: ${formatInt(tokens)}`)
        .join(', ');
      lines.push(`  ${c.caseId}: ${formatInt(c.totalTokens)} tokens over ${c.requestCount} call(s) — ${breakdown}`);
    }
  }

  if (report.promptParts.length > 0) {
    lines.push('');
    lines.push('Prompt parts by request type (characters, not tokens):');
    for (const part of report.promptParts) {
      lines.push(
        `  ${part.requestType} / ${part.component}: avg ${formatInt(part.avgChars)}, max ${formatInt(part.maxChars)} (${part.requestCount} request(s))`
      );
    }
  }

  return lines.join('\n');
}
