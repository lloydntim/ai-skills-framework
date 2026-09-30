import { describe, expect, it } from 'vitest';
import type { GenerationResult, ModelProvider } from '../provider/types';
import { QueuedResponseProvider } from '../testing/queued-response-provider';
import { scriptedSkill } from '../testing/scripted-skill';
import { makeUniformRoles } from '../testing/uniform-roles';
import { createRuntime, type RuntimeDependencies } from './controller';
import { MemoryTraceSink } from './trace';

const ok = (text: string, extra: Partial<GenerationResult> = {}): GenerationResult => ({ text, ...extra });
const spend = (cost: number): Partial<GenerationResult> => ({
  cost,
  usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  latencyMs: 10,
});

function setup(responses: GenerationResult[], overrides: Partial<RuntimeDependencies> = {}, skill = scriptedSkill()) {
  const provider = new QueuedResponseProvider(responses);
  let t = 0;
  const sink = new MemoryTraceSink();
  const runtime = createRuntime({
    skills: [skill],
    roles: makeUniformRoles(provider),
    traceSink: sink,
    now: () => (t += 10),
    newRunId: () => 'run-1',
    ...overrides,
  });
  return { provider, runtime, sink };
}

const statesOf = (r: { trace: { states: { state: string }[] } }) => r.trace.states.map((s) => s.state);

describe('runtime.execute: successful runs', () => {
  it('completes on the first draft when validation passes', async () => {
    const { runtime, provider } = setup([ok('draft one', spend(0.01)), ok('PASS', spend(0.002))]);

    const result = await runtime.execute({ skill: 'scripted', input: 'task' });

    expect(result).toMatchObject({ status: 'completed', output: 'draft one', detail: 'PASS' });
    expect(provider.callCount).toBe(2);
    expect(statesOf(result)).toEqual(['INITIALISING', 'PREPARING', 'EXECUTING', 'VALIDATING', 'COMPLETED']);
    expect(result.trace).toMatchObject({
      runId: 'run-1',
      skill: 'scripted',
      finalStatus: 'completed',
      attempts: 1,
      tokenUsage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
    });
    expect(result.trace.cost).toBeCloseTo(0.012);
    expect(result.trace.validationResults).toEqual([{ attempt: 0, status: 'pass', issues: [] }]);
    expect(result.trace.models).toMatchObject({
      generator: { provider: 'fake', model: 'fake-model' },
      validator: { provider: 'fake', model: 'fake-model' },
    });
    expect(result.trace.startedAt).toBeLessThan(result.trace.finishedAt);
  });

  it('validates, revises with the skill\'s own validation result, and completes', async () => {
    let seenByReviser: unknown;
    const skill = scriptedSkill({
      async revise(step, draft, previous) {
        seenByReviser = { draft, detail: previous.detail, attempt: step.attempt };
        return 'draft two';
      },
    });
    const { runtime, provider } = setup([ok('draft one'), ok('too vague'), ok('PASS')], {}, skill);

    const result = await runtime.execute({ skill: 'scripted', input: 'task' });

    expect(result).toMatchObject({ status: 'completed', output: 'draft two' });
    expect(seenByReviser).toEqual({ draft: 'draft one', detail: 'too vague', attempt: 1 });
    expect(provider.callCount).toBe(3);
    expect(statesOf(result)).toEqual([
      'INITIALISING', 'PREPARING', 'EXECUTING', 'VALIDATING', 'REVISING', 'VALIDATING', 'COMPLETED',
    ]);
    expect(result.trace.attempts).toBe(2);
    expect(result.trace.validationResults).toEqual([
      { attempt: 0, status: 'revise', issues: [{ source: 'semantic', code: 'not-good' }] },
      { attempt: 1, status: 'pass', issues: [] },
    ]);
    expect(result.trace.modelCalls.map((c) => c.requestType)).toEqual(['initial-generation', 'semantic-validation', 'revalidation']); // this skill's revise makes no model call
  });

  it('runs once and skips validation when validation is switched off for the run', async () => {
    const { runtime, provider } = setup([ok('only draft')]);

    const result = await runtime.execute({ skill: 'scripted', input: 'x', options: { settings: { validation: { enabled: false } } } });

    expect(result).toMatchObject({ status: 'completed', output: 'only draft' });
    expect(provider.callCount).toBe(1);
    expect(statesOf(result)).toEqual(['INITIALISING', 'PREPARING', 'EXECUTING', 'COMPLETED']);
    expect(result.trace.validationResults).toEqual([{ attempt: 0, status: 'skipped', issues: [] }]);
  });
});

describe('runtime.execute: bounded revision', () => {
  it('stops at maxRevisions and fails with VALIDATION_ERROR, keeping the last draft', async () => {
    // exactly 1 generate + 3 validate + 2 revise: a sixth-or-later extra call would exhaust the queue and throw
    const { runtime, provider } = setup([ok('d0'), ok('bad'), ok('d1'), ok('bad'), ok('d2'), ok('bad')]);

    const result = await runtime.execute({ skill: 'scripted', input: 'x', options: { settings: { execution: { maxRevisions: 2 } } } });

    expect(result).toMatchObject({ status: 'failed', output: 'd2', detail: 'bad', failure: { kind: 'VALIDATION_ERROR' } });
    expect(provider.callCount).toBe(6);
    expect(result.trace.attempts).toBe(3);
    expect(statesOf(result).at(-1)).toBe('FAILED');
    expect(statesOf(result).filter((s) => s === 'REVISING')).toHaveLength(2);
  });

  it('makes no revision at all when maxRevisions is 0', async () => {
    const { runtime, provider } = setup([ok('d0'), ok('bad')]);
    const result = await runtime.execute({ skill: 'scripted', input: 'x', options: { settings: { execution: { maxRevisions: 0 } } } });
    expect(result).toMatchObject({ status: 'failed', output: 'd0', failure: { kind: 'VALIDATION_ERROR' } });
    expect(provider.callCount).toBe(2);
  });

  it('stops immediately, without revising, when validation says the output cannot be fixed', async () => {
    const skill = scriptedSkill({
      validate: async () => ({ detail: 'x', decision: { status: 'fail', issues: [{ source: 'deterministic', code: 'forbidden-claim', message: 'm' }] } }),
    });
    const { runtime, provider } = setup([ok('d0')], {}, skill);
    const result = await runtime.execute({ skill: 'scripted', input: 'x' });
    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'VALIDATION_ERROR' }, output: 'd0' });
    expect(provider.callCount).toBe(1);
    expect(result.trace.validationResults[0]).toEqual({ attempt: 0, status: 'fail', issues: [{ source: 'deterministic', code: 'forbidden-claim' }] });
  });

  it('applies defaults, then the skill\'s settings, then the run\'s options', async () => {
    const skill = scriptedSkill({ settings: { execution: { maxRevisions: 1 } } });
    const fromSkill = setup([ok('d0'), ok('bad'), ok('d1'), ok('bad')], {}, skill);
    const first = await fromSkill.runtime.execute({ skill: 'scripted', input: 'x' });
    expect(first.trace.attempts).toBe(2); // skill's 1 revision, not the default 3
    expect(first.trace.settings.execution.maxRevisions).toBe(1);

    const fromRun = setup([ok('d0'), ok('bad')], {}, skill);
    const second = await fromRun.runtime.execute({ skill: 'scripted', input: 'x', options: { settings: { execution: { maxRevisions: 0 } } } });
    expect(second.trace.attempts).toBe(1); // the run's 0 beats the skill's 1
  });
});

describe('runtime.execute: failures', () => {
  it('reports a model failure as MODEL_ERROR and keeps the original error in memory only', async () => {
    const original = Object.assign(new Error('boom'), { status: 400 });
    const failing: ModelProvider = { generate: async () => { throw original; } };
    const { runtime } = setup([], { roles: makeUniformRoles(failing) });

    const result = await runtime.execute({ skill: 'scripted', input: 'x' });

    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'MODEL_ERROR', retryable: false }, cause: original });
    expect(result.output).toBeUndefined();
    expect(statesOf(result)).toEqual(['INITIALISING', 'PREPARING', 'EXECUTING', 'FAILED']);
    expect(result.trace.modelCalls).toMatchObject([{ ok: false, failureKind: 'MODEL_ERROR' }]);
  });

  it('marks a rate-limit style failure retryable', async () => {
    const failing: ModelProvider = { generate: async () => { throw Object.assign(new Error('slow down'), { status: 429 }); } };
    const { runtime } = setup([], { roles: makeUniformRoles(failing) });
    const result = await runtime.execute({ skill: 'scripted', input: 'x' });
    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'MODEL_ERROR', retryable: true } });
  });

  it('classifies an error thrown by skill code as EXECUTION_ERROR', async () => {
    const skill = scriptedSkill({ generate: async () => { throw new TypeError('bug in the skill'); } });
    const { runtime } = setup([], {}, skill);
    const result = await runtime.execute({ skill: 'scripted', input: 'x' });
    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'EXECUTION_ERROR', causeName: 'TypeError' } });
  });

  it('fails an unknown skill as CONFIGURATION_ERROR before doing anything', async () => {
    const { runtime, provider } = setup([]);
    const result = await runtime.execute({ skill: 'nope', input: 'x' });
    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'CONFIGURATION_ERROR' } });
    expect(provider.callCount).toBe(0);
    expect(statesOf(result)).toEqual(['INITIALISING', 'FAILED']);
  });

  it('fails invalid settings as CONFIGURATION_ERROR before any model call', async () => {
    const { runtime, provider } = setup([]);
    const result = await runtime.execute({ skill: 'scripted', input: 'x', options: { settings: { execution: { maxRevisions: -3 } } } });
    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'CONFIGURATION_ERROR' } });
    expect(provider.callCount).toBe(0);
  });

  it('fails as CONFIGURATION_ERROR when the skill\'s model roles cannot be loaded', async () => {
    const { runtime } = setup([], { roles: () => { throw new Error('Model role configuration file not found'); } });
    const result = await runtime.execute({ skill: 'scripted', input: 'x' });
    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'CONFIGURATION_ERROR' } });
  });

  it('fails as CONTEXT_ERROR, with no model call, when the skill cannot prepare', async () => {
    const skill = scriptedSkill({ prepare: () => { throw new Error('SKILL.md not found'); } });
    const { runtime, provider } = setup([], {}, skill);
    const result = await runtime.execute({ skill: 'scripted', input: 'x' });
    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'CONTEXT_ERROR' } });
    expect(provider.callCount).toBe(0);
    expect(statesOf(result)).toEqual(['INITIALISING', 'PREPARING', 'FAILED']);
  });

  it('never registers two skills under one name', () => {
    expect(() => createRuntime({ skills: [scriptedSkill(), scriptedSkill()], roles: makeUniformRoles(new QueuedResponseProvider([])) })).toThrow(/twice/);
  });
});

describe('runtime.execute: budget', () => {
  it('stops before revising when the cost limit is reached, and says BUDGET_EXCEEDED', async () => {
    const { runtime, provider } = setup([ok('d0', spend(0.03)), ok('bad', spend(0.03))]);

    const result = await runtime.execute({ skill: 'scripted', input: 'x', options: { settings: { budget: { maxCostUsd: 0.05 } } } });

    expect(result).toMatchObject({ status: 'failed', output: 'd0', failure: { kind: 'BUDGET_EXCEEDED', retryable: false } });
    expect(provider.callCount).toBe(2); // the revision was never attempted
    expect(statesOf(result)).toEqual(['INITIALISING', 'PREPARING', 'EXECUTING', 'VALIDATING', 'FAILED']);
  });

  it('refuses a model call once the token limit is spent', async () => {
    const { runtime, provider } = setup([ok('d0', spend(0.01)), ok('PASS')]);
    const result = await runtime.execute({ skill: 'scripted', input: 'x', options: { settings: { budget: { maxTokens: 100 } } } });
    // generation used 150 tokens; the validation call is blocked before it reaches the provider
    expect(result).toMatchObject({ status: 'failed', output: 'd0', failure: { kind: 'BUDGET_EXCEEDED' } });
    expect(provider.callCount).toBe(1);
  });

  it('stops when the time limit has passed', async () => {
    const { runtime, provider } = setup([ok('d0')], {}, scriptedSkill());
    const result = await runtime.execute({ skill: 'scripted', input: 'x', options: { settings: { budget: { maxDurationMs: 5 } } } });
    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'BUDGET_EXCEEDED' } });
    expect(provider.callCount).toBe(0);
  });

  it('does not let an unreported cost pass as within a cost limit, and says the measurement was missing', async () => {
    const { runtime } = setup([ok('d0'), ok('PASS')]);
    const result = await runtime.execute({ skill: 'scripted', input: 'x', options: { settings: { budget: { maxCostUsd: 1 } } } });
    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'BUDGET_MEASUREMENT_UNAVAILABLE', retryable: false } });
    expect(result.trace.failure?.kind).toBe('BUDGET_MEASUREMENT_UNAVAILABLE'); // in the trace too, not only the result
  });

  it('does not let unreported token usage pass as within a token limit', async () => {
    const { runtime, provider } = setup([ok('d0', { cost: 0.01 }), ok('PASS')]);
    const result = await runtime.execute({ skill: 'scripted', input: 'x', options: { settings: { budget: { maxTokens: 1_000_000 } } } });
    expect(result).toMatchObject({ status: 'failed', output: 'd0', failure: { kind: 'BUDGET_MEASUREMENT_UNAVAILABLE' } });
    expect(provider.callCount).toBe(1); // conservative: the run did not carry on
  });

  it('still says BUDGET_EXCEEDED when the figure was measured and the limit was reached', async () => {
    const { runtime } = setup([ok('d0', spend(0.5)), ok('PASS')]);
    const result = await runtime.execute({ skill: 'scripted', input: 'x', options: { settings: { budget: { maxCostUsd: 0.1 } } } });
    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'BUDGET_EXCEEDED' } });
  });

  it('says BUDGET_MEASUREMENT_UNAVAILABLE, not BUDGET_EXCEEDED, when the gap is found before revising', async () => {
    // The validator reports cost and usage, the reviser's turn is never reached: the generator did not report a cost.
    const { runtime } = setup([ok('d0', { usage: { totalTokens: 10 } }), ok('bad', { usage: { totalTokens: 10 }, cost: 0.001 })]);
    const result = await runtime.execute({ skill: 'scripted', input: 'x', options: { settings: { budget: { maxCostUsd: 5 } } } });
    expect(result.status).toBe('failed');
    expect((result as { failure: { kind: string } }).failure.kind).toBe('BUDGET_MEASUREMENT_UNAVAILABLE');
  });
});

describe('runtime.execute: tools', () => {
  it('refuses a skill whose required capability the policy does not grant, before any model call', async () => {
    const skill = scriptedSkill({ tools: { required: ['jira.read'] } });
    const { runtime, provider } = setup([], {}, skill);
    const result = await runtime.execute({ skill: 'scripted', input: 'x' });
    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'TOOL_ERROR', retryable: false } });
    expect(provider.callCount).toBe(0);
  });

  it('runs a skill whose capability is granted, and records the tool call by name only', async () => {
    const skill = scriptedSkill({
      tools: { required: ['jira.read'] },
      generate: async (step) => step.tools.call('jira.read', () => 'ticket body with a secret'),
    });
    const { runtime } = setup([ok('PASS')], { toolPolicy: { allow: ['jira.read'] } }, skill);
    const result = await runtime.execute({ skill: 'scripted', input: 'x' });
    expect(result).toMatchObject({ status: 'completed', output: 'ticket body with a secret' });
    expect(result.trace.toolCalls).toEqual([{ capability: 'jira.read', decision: 'allowed', ok: true }]);
    expect(JSON.stringify(result.trace)).not.toContain('secret');
  });

  it('asks for confirmation when the policy requires it, and stops if it is refused', async () => {
    const skill = scriptedSkill({ tools: { required: ['jira.write'] } });
    const { runtime } = setup([], { toolPolicy: { confirm: ['jira.write'] }, confirmTool: () => false }, skill);
    const result = await runtime.execute({ skill: 'scripted', input: 'x' });
    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'TOOL_ERROR' } });
  });
});

describe('runtime.execute: observation and tracing', () => {
  it('reports every state change as it happens', async () => {
    const seen: string[] = [];
    const { runtime } = setup([ok('d0'), ok('PASS')], { onStateChange: (c, from) => seen.push(`${from}->${c.state}`) });
    await runtime.execute({ skill: 'scripted', input: 'x' });
    expect(seen).toEqual(['INITIALISING->PREPARING', 'PREPARING->EXECUTING', 'EXECUTING->VALIDATING', 'VALIDATING->COMPLETED']);
  });

  it('writes the finished trace to the sink, failed runs included', async () => {
    const { runtime, sink } = setup([ok('d0'), ok('PASS')]);
    const good = await runtime.execute({ skill: 'scripted', input: 'x' });
    const bad = await runtime.execute({ skill: 'nope', input: 'x' });
    expect(good.traceWritten).toBe(true);
    expect(sink.traces.map((t) => t.finalStatus)).toEqual(['completed', 'failed']);
  });

  it('still returns the trace, but does not write it, when tracing is off', async () => {
    const { runtime, sink } = setup([ok('d0'), ok('PASS')]);
    const result = await runtime.execute({ skill: 'scripted', input: 'x', options: { settings: { tracing: { enabled: false } } } });
    expect(result.trace.finalStatus).toBe('completed');
    expect(result.traceWritten).toBe(false);
    expect(sink.traces).toHaveLength(0);
  });

  it('is not affected by a trace sink that throws', async () => {
    const { runtime } = setup([ok('d0'), ok('PASS')], { traceSink: { write: () => { throw new Error('disk full'); } } });
    const result = await runtime.execute({ skill: 'scripted', input: 'x' });
    expect(result).toMatchObject({ status: 'completed', output: 'd0', traceWritten: false });
  });

  it('gives consecutive runs separate ids and separate traces', async () => {
    let n = 0;
    const { runtime } = setup([ok('a'), ok('PASS'), ok('b'), ok('PASS')], { newRunId: () => `run-${++n}` });
    const first = await runtime.execute({ skill: 'scripted', input: 'x' });
    const second = await runtime.execute({ skill: 'scripted', input: 'y' });
    expect([first.trace.runId, second.trace.runId]).toEqual(['run-1', 'run-2']);
    expect(second.trace.modelCalls).toHaveLength(2); // not 4: nothing carries over between runs
  });
});
