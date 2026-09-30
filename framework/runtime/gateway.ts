import type { ModelRole, ResolvedModelRoles, ResolvedRole } from '../provider/model-roles';
import type { GenerationRequest, GenerationResult, ModelProvider } from '../provider/types';
import { budgetFailure, type BudgetTracker } from './budget';
import { classifyError } from './failure';
import type { ModelCallRecord } from './trace';

/** What a skill's steps are handed for a role: a provider to call and the model id to ask it for. */
export interface RoleHandle {
  provider: ModelProvider;
  model: string;
  providerName: string;
}

/**
 * The provider a skill's steps actually talk to. It stands between the skill and the role's real
 * provider so that the skill needs no knowledge of budgets, fallbacks or accounting:
 *
 * - before every call, the fallback's included, it asks the budget whether anything is left, and
 *   refuses if not;
 * - it records every call (tokens, cost, time, the prompt-part sizes the call site attached);
 * - it turns a provider failure into a MODEL_ERROR, and when that failure is worth retrying
 *   elsewhere and the role has a fallback, asks the fallback once.
 *
 * The request and result are passed through unchanged, so a skill sees exactly what it would have
 * seen from the provider directly.
 */
class MeteredProvider implements ModelProvider {
  constructor(
    private readonly role: ModelRole,
    private readonly resolved: ResolvedRole,
    private readonly budget: BudgetTracker,
    private readonly calls: ModelCallRecord[]
  ) {}

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const verdict = this.budget.check();
    if (!verdict.ok) throw budgetFailure(verdict, 'before the call');

    try {
      return await this.attempt(request, this.resolved.provider, this.resolved.providerName, this.resolved.model, false);
    } catch (err) {
      const failure = classifyError(err, 'model');
      const { fallback } = this.resolved;
      if (!(failure.kind === 'MODEL_ERROR' && failure.retryable && fallback)) throw failure;
      // The preferred model may have taken a while to fail; the fallback is part of the same run and
      // draws on what is left of its budget, not a fresh one.
      const remaining = this.budget.check();
      if (!remaining.ok) throw budgetFailure(remaining, 'before the fallback call');
      try {
        return await this.attempt({ ...request, model: fallback.model }, fallback.provider, fallback.providerName, fallback.model, true);
      } catch (fallbackErr) {
        throw classifyError(fallbackErr, 'model');
      }
    }
  }

  private async attempt(
    request: GenerationRequest,
    provider: ModelProvider,
    providerName: string,
    model: string,
    usedFallback: boolean
  ): Promise<GenerationResult> {
    const base = {
      role: this.role,
      requestType: request.metadata?.requestType ?? ('unclassified' as const),
      provider: providerName,
      model,
      usedFallback,
      components: request.metadata?.components,
    };
    try {
      const result = await provider.generate(request);
      this.calls.push({ ...base, ok: true, usage: result.usage, latencyMs: result.latencyMs, cost: result.cost });
      this.budget.record({ usage: result.usage, cost: result.cost });
      return result;
    } catch (err) {
      const failure = classifyError(err, 'model');
      this.calls.push({ ...base, ok: false, failureKind: failure.kind });
      throw failure;
    }
  }
}

/** One handle per role, all sharing this run's budget and call log. */
export function buildRoleHandles(
  roles: ResolvedModelRoles,
  budget: BudgetTracker,
  calls: ModelCallRecord[]
): Record<ModelRole, RoleHandle> {
  const handles = {} as Record<ModelRole, RoleHandle>;
  for (const role of Object.keys(roles) as ModelRole[]) {
    const resolved = roles[role];
    handles[role] = {
      provider: new MeteredProvider(role, resolved, budget, calls),
      model: resolved.model,
      providerName: resolved.providerName,
    };
  }
  return handles;
}
