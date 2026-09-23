import { MODEL_ROLES, type ResolvedModelRoles } from './model-roles';
import type { PromptComponentSize, RequestType } from './request-metadata';
import type { GenerationRequest, GenerationResult, ModelProvider, TokenUsage } from './types';

export interface RequestLogEntry {
  requestType: RequestType;
  /** Which benchmark/golden case this call belongs to. Undefined for a production call outside the eval harness. */
  caseId?: string;
  components?: PromptComponentSize[];
  usage?: TokenUsage;
  latencyMs?: number;
}

/**
 * Accumulates the RequestLogEntry rows every InstrumentingProvider wrapper records. One log is
 * shared across all of a run's wrapped roles, so requests land in a single place regardless of how
 * many distinct provider instances the roles resolve to (the registry shares one provider instance
 * per provider name, per src/provider/registry.ts).
 */
export class RequestLog {
  private currentCaseId: string | undefined;
  private readonly rows: RequestLogEntry[] = [];

  /**
   * Attributes every entry recorded from now until the next call to this case id (or to undefined,
   * for calls outside any case — e.g. production usage). Cases in this codebase are always
   * processed one at a time in a sequential loop, never concurrently, so a single mutable "current
   * case" is sufficient; it is not safe to share a RequestLog across concurrent case processing.
   */
  setCurrentCase(caseId: string | undefined): void {
    this.currentCaseId = caseId;
  }

  record(entry: Omit<RequestLogEntry, 'caseId'>): void {
    this.rows.push({ ...entry, caseId: this.currentCaseId });
  }

  get entries(): readonly RequestLogEntry[] {
    return this.rows;
  }

  clear(): void {
    this.rows.length = 0;
  }
}

/**
 * Wraps any ModelProvider to record every request's usage and metadata into a shared RequestLog.
 * The request sent and the result returned are passed through completely unchanged — this only
 * observes. A request with no metadata is logged as 'unclassified' rather than silently dropped,
 * so an uninstrumented call site shows up in the report instead of vanishing from the totals.
 */
export class InstrumentingProvider implements ModelProvider {
  constructor(
    private readonly inner: ModelProvider,
    private readonly log: RequestLog
  ) {}

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const result = await this.inner.generate(request);
    this.log.record({
      requestType: request.metadata?.requestType ?? 'unclassified',
      components: request.metadata?.components,
      usage: result.usage,
      latencyMs: result.latencyMs,
    });
    return result;
  }
}

/**
 * Wraps every role's provider with an InstrumentingProvider sharing one RequestLog, leaving the
 * roles' models and provider names untouched. Roles that already share one provider instance keep
 * sharing it underneath — only the outer wrapper is new per role, so shared-instance behavior
 * (e.g. connection reuse) is unaffected.
 */
export function instrumentRoles(roles: ResolvedModelRoles, log: RequestLog): ResolvedModelRoles {
  const instrumented = {} as ResolvedModelRoles;
  for (const role of MODEL_ROLES) {
    instrumented[role] = { ...roles[role], provider: new InstrumentingProvider(roles[role].provider, log) };
  }
  return instrumented;
}
