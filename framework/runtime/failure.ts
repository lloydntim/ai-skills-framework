import { LlmResponseValidationError } from '../llm-json-response';

/**
 * Why a run stopped, as a small closed set. The runtime decides what to do next from the kind and
 * `retryable` alone, never from a message: a message is for a person, and provider error text can
 * carry raw model output.
 *
 * Only kinds this codebase can actually produce today:
 * - CONFIGURATION_ERROR: the run cannot be set up (unknown skill, bad settings, a role's runtime
 *   settings its model rejects). Fails before any model call.
 * - CONTEXT_ERROR: the skill could not assemble what its calls need (for example SKILL.md is missing).
 * - MODEL_ERROR: a provider call failed, or returned something unusable.
 * - TOOL_ERROR: a required capability was denied by policy, or a tool call failed.
 * - VALIDATION_ERROR: the output never satisfied validation (revisions ran out, or validation said stop).
 * - BUDGET_EXCEEDED: a token, cost or time limit was reached. Never retried.
 * - BUDGET_MEASUREMENT_UNAVAILABLE: a token or cost limit is set but a call did not report that figure,
 *   so the limit cannot be checked and the run stops rather than pretend it is enforced. Never retried.
 * - EXECUTION_ERROR: anything else thrown by skill code.
 */
export type FailureKind =
  | 'CONFIGURATION_ERROR'
  | 'CONTEXT_ERROR'
  | 'MODEL_ERROR'
  | 'TOOL_ERROR'
  | 'VALIDATION_ERROR'
  | 'BUDGET_EXCEEDED'
  | 'BUDGET_MEASUREMENT_UNAVAILABLE'
  | 'EXECUTION_ERROR';

/** Where in the lifecycle an unclassified error was thrown; decides what an unknown error means. */
export type FailurePhase = 'prepare' | 'model' | 'execute' | 'validate' | 'revise';

/**
 * The runtime's own error type. `message` is written by the runtime, never copied from a cause, so
 * it is safe to put in a trace. The original error stays on `cause`, in memory only.
 */
export class RuntimeFailure extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
    readonly options: { retryable?: boolean; cause?: unknown } = {}
  ) {
    super(message);
    this.name = 'RuntimeFailure';
    this.cause = options.cause;
  }

  get retryable(): boolean {
    return this.options.retryable ?? false;
  }
}

/** The part of a failure that is safe to record: a kind, a runtime-written message, and whether it could be retried. */
export interface FailureSummary {
  kind: FailureKind;
  message: string;
  retryable: boolean;
  /** The class name of the underlying error, never its message. */
  causeName?: string;
}

export function summariseFailure(failure: RuntimeFailure): FailureSummary {
  const cause = failure.options.cause;
  return {
    kind: failure.kind,
    message: failure.message,
    retryable: failure.retryable,
    causeName: cause instanceof Error ? cause.name : undefined,
  };
}

// Matched by name so the runtime (and skill.json parsing, which imports its settings schema) does not
// import provider/registry.ts, and through it the vendor SDK that anthropic-provider.ts pulls in.
const CONFIGURATION_ERROR_NAMES = new Set(['UnsupportedRuntimeConfigError', 'RoleRuntimeConfigError', 'ModelConfigError']);
const MODEL_ERROR_NAMES = new Set(['EmptyModelResponseError']);

/** HTTP-ish statuses worth trying another model for: rate limiting, timeouts and server-side faults. */
function isRetryableStatus(status: unknown): boolean {
  return typeof status === 'number' && (status === 408 || status === 409 || status === 429 || status >= 500);
}

function isConnectionError(err: Error): boolean {
  return /connection|timeout/i.test(err.name);
}

/**
 * Turns whatever was thrown into a RuntimeFailure. A RuntimeFailure passes through untouched, so
 * the gateway's own classification is never overwritten by the controller's.
 */
export function classifyError(err: unknown, phase: FailurePhase): RuntimeFailure {
  if (err instanceof RuntimeFailure) return err;

  if (err instanceof Error) {
    if (CONFIGURATION_ERROR_NAMES.has(err.name)) {
      return new RuntimeFailure('CONFIGURATION_ERROR', 'The model configuration is invalid or unsupported by its model.', { cause: err });
    }
    if (MODEL_ERROR_NAMES.has(err.name) || err instanceof LlmResponseValidationError) {
      return new RuntimeFailure('MODEL_ERROR', 'The model returned nothing usable.', { cause: err });
    }
    const status = (err as { status?: unknown }).status;
    if (status !== undefined || isConnectionError(err)) {
      return new RuntimeFailure('MODEL_ERROR', 'A model request failed.', {
        retryable: isRetryableStatus(status) || isConnectionError(err),
        cause: err,
      });
    }
  }

  if (phase === 'prepare') return new RuntimeFailure('CONTEXT_ERROR', 'The skill could not prepare its context.', { cause: err });
  // Whatever a provider throws that nothing above recognised (a missing key, a refused request) is still a failed model call.
  if (phase === 'model') return new RuntimeFailure('MODEL_ERROR', 'A model request failed.', { cause: err });
  return new RuntimeFailure('EXECUTION_ERROR', `The skill failed while ${describePhase(phase)}.`, { cause: err });
}

function describePhase(phase: FailurePhase): string {
  switch (phase) {
    case 'prepare':
      return 'preparing';
    case 'model':
    case 'execute':
      return 'generating';
    case 'validate':
      return 'validating';
    case 'revise':
      return 'revising';
  }
}
