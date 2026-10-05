import { describe, expect, it } from 'vitest';
import { BudgetTracker } from './budget';

const usage = (input: number, output: number) => ({ inputTokens: input, outputTokens: output, totalTokens: input + output });

function tracker(limits: ConstructorParameters<typeof BudgetTracker>[0], clock = { t: 1000 }) {
  return { budget: new BudgetTracker(limits, () => clock.t, 1000), clock };
}

describe('BudgetTracker', () => {
  it('tells a limit that was reached apart from a limit that could not be measured', () => {
    const reached = tracker({ maxCostUsd: 0.01 });
    reached.budget.record({ usage: usage(1, 1), cost: 0.5 });
    const unmeasured = tracker({ maxCostUsd: 100 });
    unmeasured.budget.record({ usage: usage(1, 1) });

    expect(reached.budget.check()).toMatchObject({ ok: false, cause: 'exceeded' });
    expect(unmeasured.budget.check()).toMatchObject({ ok: false, cause: 'unmeasured' });
  });

  it('is always ok with no limits, however much is spent', () => {
    const { budget } = tracker({});
    budget.record({ usage: usage(1e9, 1e9), cost: 1e6 });
    expect(budget.check()).toEqual({ ok: true });
  });

  it('stops at the token limit, counting every call', () => {
    const { budget } = tracker({ maxTokens: 300 });
    budget.record({ usage: usage(100, 50), cost: 0 });
    expect(budget.check().ok).toBe(true);
    budget.record({ usage: usage(100, 50), cost: 0 });
    expect(budget.check()).toMatchObject({ ok: false, limit: 'tokens', cause: 'exceeded' }); // 300 of 300: nothing left, not "still fine"
  });

  it('stops at the cost limit', () => {
    const { budget } = tracker({ maxCostUsd: 0.05 });
    budget.record({ usage: usage(1, 1), cost: 0.03 });
    expect(budget.check().ok).toBe(true);
    budget.record({ usage: usage(1, 1), cost: 0.03 });
    expect(budget.check()).toMatchObject({ ok: false, limit: 'cost', cause: 'exceeded' });
  });

  it('stops at the time limit, measured from the run start', () => {
    const { budget, clock } = tracker({ maxDurationMs: 500 });
    clock.t = 1499;
    expect(budget.check().ok).toBe(true);
    clock.t = 1500;
    expect(budget.check()).toMatchObject({ ok: false, limit: 'duration', cause: 'exceeded' });
  });

  it('sums tokens from input and output when a provider reports no total', () => {
    const { budget } = tracker({ maxTokens: 100 });
    budget.record({ usage: { inputTokens: 60, outputTokens: 40 }, cost: 0 });
    expect(budget.check()).toMatchObject({ ok: false, limit: 'tokens' });
  });

  it('refuses to pretend a token limit is enforced when a call reported no usage', () => {
    const { budget } = tracker({ maxTokens: 1_000_000 });
    budget.record({ cost: 0.01 });
    const verdict = budget.check();
    expect(verdict).toMatchObject({ ok: false, limit: 'tokens', cause: 'unmeasured' });
    expect((verdict as { reason: string }).reason).toMatch(/cannot be enforced/);
  });

  it('refuses to pretend a cost limit is enforced when a call reported no cost', () => {
    const { budget } = tracker({ maxCostUsd: 100 });
    budget.record({ usage: usage(1, 1) });
    expect(budget.check()).toMatchObject({ ok: false, limit: 'cost', cause: 'unmeasured' });
  });

  it('does not mind an unreported figure it has no limit on', () => {
    const { budget } = tracker({ maxTokens: 1_000_000 });
    budget.record({ usage: usage(1, 1) }); // no cost, but only tokens are limited
    expect(budget.check().ok).toBe(true);
  });
});
