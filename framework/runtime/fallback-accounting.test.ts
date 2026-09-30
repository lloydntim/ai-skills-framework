import { describe, expect, it } from 'vitest';
import type { ResolvedModelRoles } from '../provider/model-roles';
import type { GenerationRequest, GenerationResult, ModelProvider } from '../provider/types';
import { QueuedResponseProvider } from '../testing/queued-response-provider';
import { scriptedSkill } from '../testing/scripted-skill';
import { makeUniformRoles } from '../testing/uniform-roles';
import { createRuntime } from './controller';
import { MemoryTraceSink } from './trace';

/**
 * A model fallback is a second answer to the same request, not a second run. Everything it costs is
 * charged to the run that asked, so these tests price each attempt with deterministic fakes and
 * check the run's totals, its budgets, its trace and its attempt count as a whole.
 */

const priced = (text: string, cost: number, totalTokens = 100): GenerationResult => ({
  text,
  cost,
  usage: { inputTokens: totalTokens - 10, outputTokens: 10, totalTokens },
  latencyMs: 1,
});

const unavailable = (): Error => Object.assign(new Error('overloaded'), { status: 503 });

/** Succeeds with the queued results in order; a queued Error is thrown instead (after `takes` ms on the clock). */
function scripted(steps: Array<GenerationResult | Error>, clock?: { t: number }, takes = 0): ModelProvider & { calls: number } {
  let i = 0;
  return {
    get calls() {
      return i;
    },
    async generate(_request: GenerationRequest) {
      if (clock) clock.t += takes;
      const step = steps[i++];
      if (step === undefined) throw new Error('nothing scripted');
      if (step instanceof Error) throw step;
      return step;
    },
  };
}

/** Every role the fake provider; the reviser's model is unavailable and has a fallback. */
function rolesWithReviserFallback(primary: ModelProvider, reviserPrimary: ModelProvider, reviserFallback: ModelProvider): ResolvedModelRoles {
  const roles = makeUniformRoles(primary);
  roles.reviser = {
    ...roles.reviser,
    provider: reviserPrimary,
    fallback: { provider: reviserFallback, providerName: 'backup', model: 'backup-model', runtime: roles.reviser.runtime },
  };
  return roles;
}

function run(roles: ResolvedModelRoles, settings = {}, clock = { t: 0 }) {
  const sink = new MemoryTraceSink();
  const runtime = createRuntime({ skills: [scriptedSkill()], roles, traceSink: sink, now: () => clock.t, newRunId: () => 'one-run' });
  return { sink, execute: () => runtime.execute({ skill: 'scripted', input: 'x', options: { settings } }) };
}

describe('model fallback shares the run\'s accounting', () => {
  // generator+validator answer from `primary`: draft ($0.18), then a failing verdict ($0.00).
  const primary = () => scripted([priced('draft', 0.18), priced('needs work', 0), priced('PASS', 0)]);

  it('adds the fallback attempt to the same run: $0.18 primary + $0.20 fallback = $0.38', async () => {
    const backup = scripted([priced('revised', 0.2)]);
    const { execute, sink } = run(rolesWithReviserFallback(primary(), scripted([unavailable()]), backup));

    const result = await execute();

    expect(result.status).toBe('completed');
    expect(result.trace.cost).toBeCloseTo(0.38);
    expect(result.trace.tokenUsage.totalTokens).toBe(400); // draft, verdict, revision, verdict; the failed attempt reported none
    expect(sink.traces).toHaveLength(1); // one run, one trace, however many models answered
    expect(result.trace.runId).toBe('one-run');
  });

  it('records the failed attempt and the fallback as separate calls inside that one trace', async () => {
    const { execute } = run(rolesWithReviserFallback(primary(), scripted([unavailable()]), scripted([priced('revised', 0.2)])));

    const { trace } = await execute();
    const revisionCalls = trace.modelCalls.filter((c) => c.role === 'reviser');

    expect(revisionCalls.map((c) => [c.ok, c.usedFallback, c.model])).toEqual([
      [false, false, 'fake-model'],
      [true, true, 'backup-model'],
    ]);
    expect(trace.modelCalls).toHaveLength(5); // generate, validate, failed revision, fallback revision, revalidate
  });

  it('does not count a fallback as a revision: attempts and the state history run on', async () => {
    const { execute } = run(rolesWithReviserFallback(primary(), scripted([unavailable()]), scripted([priced('revised', 0.2)])));

    const { trace } = await execute();

    expect(trace.attempts).toBe(2); // first draft + one revision, not three
    expect(trace.states.map((s) => s.state)).toEqual(['INITIALISING', 'PREPARING', 'EXECUTING', 'VALIDATING', 'REVISING', 'VALIDATING', 'COMPLETED']);
  });

  it('cannot push the run past its cost budget unnoticed: the fallback\'s spend is charged and stops the next call', async () => {
    const backup = scripted([priced('revised', 0.2)]);
    const { execute } = run(rolesWithReviserFallback(primary(), scripted([unavailable()]), backup), { budget: { maxCostUsd: 0.3 } });

    const result = await execute();

    // 0.18 was within budget when the revision began; the fallback took the run to 0.38, and the
    // revalidation was refused rather than run on top of an overspent budget.
    expect(result).toMatchObject({ status: 'failed', output: 'revised', failure: { kind: 'BUDGET_EXCEEDED' } });
    expect(result.trace.cost).toBeCloseTo(0.38);
    expect(result.trace.modelCalls.some((c) => c.usedFallback && c.ok)).toBe(true);
    expect(result.trace.modelCalls.filter((c) => c.role === 'validator')).toHaveLength(1); // no second validation
  });

  it('counts the fallback\'s tokens against the token budget', async () => {
    const backup = scripted([priced('revised', 0.2, 500)]);
    const { execute } = run(rolesWithReviserFallback(primary(), scripted([unavailable()]), backup), { budget: { maxTokens: 400 } });

    const result = await execute();

    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'BUDGET_EXCEEDED' } });
    expect(result.trace.tokenUsage.totalTokens).toBe(700);
  });

  it('does not use the fallback once the time budget has run out while the preferred model was failing', async () => {
    const clock = { t: 0 };
    const backup = scripted([priced('revised', 0.2)]);
    const slowFailure = scripted([unavailable()], clock, 500); // fails only after 500ms
    const { execute } = run(rolesWithReviserFallback(primary(), slowFailure, backup), { budget: { maxDurationMs: 400 } }, clock);

    const result = await execute();

    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'BUDGET_EXCEEDED' } });
    expect(backup.calls).toBe(0); // the fallback did not get a fresh time budget
  });

  it('stops, saying the measurement is missing, when the fallback model reports no cost under a cost limit', async () => {
    const unpriced: GenerationResult = { text: 'revised', usage: { totalTokens: 10 } };
    const { execute } = run(rolesWithReviserFallback(primary(), scripted([unavailable()]), scripted([unpriced])), { budget: { maxCostUsd: 5 } });

    const result = await execute();

    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'BUDGET_MEASUREMENT_UNAVAILABLE' } });
  });

  it('is a plain success when no limit is set, however the answer was obtained', async () => {
    const { execute } = run(rolesWithReviserFallback(new QueuedResponseProvider([{ text: 'draft' }, { text: 'no' }, { text: 'PASS' }]), scripted([unavailable()]), scripted([{ text: 'revised' }])));
    expect((await execute()).status).toBe('completed');
  });
});
