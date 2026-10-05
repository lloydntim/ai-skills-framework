import type { TokenUsage } from '../provider/types';
import type { RuntimeSettings } from './config';
import { RuntimeFailure } from './failure';

export type BudgetLimit = 'tokens' | 'cost' | 'duration';

/**
 * Why a budget stopped the run. `exceeded`: the limit was reached. `unmeasured`: the limit could not
 * be checked because a call did not report the figure it is measured in. Both stop the run; they
 * are different facts, so a caller reading a trace can tell "too expensive" from "cannot tell".
 */
export type BudgetVerdict = { ok: true } | { ok: false; limit: BudgetLimit; cause: 'exceeded' | 'unmeasured'; reason: string };

/** What one finished model call spent, as the provider reported it. Absent means "not reported". */
export interface CallSpend {
  usage?: TokenUsage;
  cost?: number;
}

function tokensOf(usage: TokenUsage | undefined): number | undefined {
  if (usage?.totalTokens !== undefined) return usage.totalTokens;
  if (usage?.inputTokens !== undefined && usage.outputTokens !== undefined) return usage.inputTokens + usage.outputTokens;
  return undefined;
}

/**
 * Spend so far against the limits, asked before every model call and before every revision.
 *
 * "Exhausted" means at or past the limit, not strictly over it: the next call's size is unknown, so
 * a run with nothing left is stopped rather than allowed one more. A call cannot be interrupted
 * once it has started, so the last call can overshoot; a limit bounds the calls made, not the bill
 * to the cent.
 *
 * A limit that cannot be measured is not treated as satisfied. If a token or cost limit is set and
 * a call comes back without that figure (a model with no entry in the price table, a provider that
 * reports no usage), the run stops with that reason. Carrying on would make the limit look enforced
 * when it is not, and this project already treats an unknown cost as not free (framework/provider/pricing.ts).
 */
export class BudgetTracker {
  private tokens = 0;
  private costUsd = 0;
  private unmeasuredTokens = false;
  private unmeasuredCost = false;

  constructor(
    private readonly limits: RuntimeSettings['budget'],
    private readonly now: () => number,
    private readonly startedAt: number
  ) {}

  record(call: CallSpend): void {
    const tokens = tokensOf(call.usage);
    if (tokens === undefined) this.unmeasuredTokens = true;
    else this.tokens += tokens;

    if (call.cost === undefined) this.unmeasuredCost = true;
    else this.costUsd += call.cost;
  }

  check(): BudgetVerdict {
    const { maxTokens, maxCostUsd, maxDurationMs } = this.limits;

    if (maxTokens !== undefined) {
      if (this.unmeasuredTokens) return stopped('tokens', 'unmeasured', 'a call did not report token usage, so the token limit cannot be enforced');
      if (this.tokens >= maxTokens) return stopped('tokens', 'exceeded', `token limit reached (${this.tokens} of ${maxTokens})`);
    }
    if (maxCostUsd !== undefined) {
      if (this.unmeasuredCost) return stopped('cost', 'unmeasured', 'a call did not report a cost (no price for its model?), so the cost limit cannot be enforced');
      if (this.costUsd >= maxCostUsd) return stopped('cost', 'exceeded', `cost limit reached ($${this.costUsd.toFixed(4)} of $${maxCostUsd})`);
    }
    if (maxDurationMs !== undefined) {
      const elapsed = this.now() - this.startedAt;
      if (elapsed >= maxDurationMs) return stopped('duration', 'exceeded', `time limit reached (${elapsed}ms of ${maxDurationMs}ms)`);
    }
    return { ok: true };
  }
}

function stopped(limit: BudgetLimit, cause: 'exceeded' | 'unmeasured', reason: string): BudgetVerdict {
  return { ok: false, limit, cause, reason };
}

/**
 * The failure a refused verdict becomes. One place decides which kind each cause is, so the
 * gateway (before a call) and the controller (before a revision) cannot disagree. `when` completes
 * the sentence "Budget ... <when>: <reason>".
 */
export function budgetFailure(verdict: Extract<BudgetVerdict, { ok: false }>, when: string): RuntimeFailure {
  return verdict.cause === 'unmeasured'
    ? new RuntimeFailure('BUDGET_MEASUREMENT_UNAVAILABLE', `Budget could not be checked ${when}: ${verdict.reason}.`)
    : new RuntimeFailure('BUDGET_EXCEEDED', `Budget exhausted ${when}: ${verdict.reason}.`);
}
