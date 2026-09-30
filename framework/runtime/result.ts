import type { RunResult } from './controller';
import type { RunTrace } from './trace';

/** A run whose caller gets a draft and the skill's validation of it, whether or not that validation passed. */
export interface SettledRun<Detail> {
  output: string;
  /** The skill's own last validation result. Look here, not at the trace, to see whether it passed. */
  detail: Detail;
  trace: RunTrace;
}

/**
 * The shared rule for turning a run into what a skill's callers have always been given: a draft
 * and its validation result, or an error.
 *
 * Running out of revisions is an outcome, not an error: the last draft comes back with the
 * validation that still failed it, and the caller decides whether that draft is usable. Every
 * other failure is thrown as the error that caused it (a provider's own error, as that same
 * object), or as the runtime's failure when nothing underlies it (a budget stop). A run that
 * never reached validation has no validation result to return, so it throws.
 *
 * This is the runtime's policy for a caller that wants a plain return-or-throw function; a caller
 * that wants to inspect failures can use the RunResult directly and never call this.
 */
export function settle<Detail>(result: RunResult<Detail>): SettledRun<Detail> {
  if (result.status === 'completed') return { output: result.output, detail: result.detail as Detail, trace: result.trace };
  if (result.failure.kind === 'VALIDATION_ERROR' && result.output !== undefined && result.detail !== undefined) {
    return { output: result.output, detail: result.detail, trace: result.trace };
  }
  throw result.cause;
}
