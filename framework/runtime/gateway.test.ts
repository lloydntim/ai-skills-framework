import { describe, expect, it } from 'vitest';
import type { ResolvedModelRoles } from '../provider/model-roles';
import type { GenerationRequest, GenerationResult, ModelProvider } from '../provider/types';
import { QueuedResponseProvider } from '../testing/queued-response-provider';
import { makeUniformRoles } from '../testing/uniform-roles';
import { BudgetTracker } from './budget';
import { buildRoleHandles } from './gateway';
import type { ModelCallRecord } from './trace';

function handles(roles: ResolvedModelRoles, limits = {}) {
  const calls: ModelCallRecord[] = [];
  const budget = new BudgetTracker(limits, () => 0, 0);
  return { calls, handles: buildRoleHandles(roles, budget, calls) };
}

const request = (model = 'fake-model'): GenerationRequest => ({
  userPrompt: 'hello',
  model,
  metadata: { requestType: 'initial-generation', components: [{ component: 'case-input', chars: 5 }] },
});

const failing = (status?: number): ModelProvider => ({
  generate: async () => {
    throw Object.assign(new Error('provider said no'), status === undefined ? {} : { status });
  },
});

function withFallback(primary: ModelProvider, fallback: ModelProvider): ResolvedModelRoles {
  const roles = makeUniformRoles(primary);
  roles.generator = {
    ...roles.generator,
    fallback: { provider: fallback, providerName: 'backup', model: 'backup-model', runtime: roles.generator.runtime },
  };
  return roles;
}

describe('role handles', () => {
  it('passes the request and result through unchanged and records the call', async () => {
    const provider = new QueuedResponseProvider([{ text: 'hi', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 }, latencyMs: 12, cost: 0.001 }]);
    const { handles: h, calls } = handles(makeUniformRoles(provider));

    const result = await h.generator.provider.generate(request());

    expect(result.text).toBe('hi');
    expect(provider.requests[0]).toEqual(request());
    expect(calls).toEqual([
      {
        role: 'generator',
        requestType: 'initial-generation',
        provider: 'fake',
        model: 'fake-model',
        ok: true,
        usedFallback: false,
        usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
        latencyMs: 12,
        cost: 0.001,
        components: [{ component: 'case-input', chars: 5 }],
      },
    ]);
  });

  it('records a request with no metadata as unclassified rather than dropping it', async () => {
    const { handles: h, calls } = handles(makeUniformRoles(new QueuedResponseProvider([{ text: 'x' }])));
    await h.validator.provider.generate({ userPrompt: 'p', model: 'm' });
    expect(calls[0].requestType).toBe('unclassified');
    expect(calls[0].role).toBe('validator');
  });

  it('exposes the role\'s model and provider name for the skill to use', () => {
    const { handles: h } = handles(makeUniformRoles(new QueuedResponseProvider([]), 'some-model', 'some-provider'));
    expect(h.reviser).toMatchObject({ model: 'some-model', providerName: 'some-provider' });
  });

  it('refuses a call, without reaching the provider, once the budget is spent', async () => {
    const provider = new QueuedResponseProvider([{ text: 'a', usage: { totalTokens: 500 } }, { text: 'b' }]);
    const { handles: h } = handles(makeUniformRoles(provider), { maxTokens: 500 });
    await h.generator.provider.generate(request());
    await expect(h.generator.provider.generate(request())).rejects.toMatchObject({ kind: 'BUDGET_EXCEEDED' });
    expect(provider.callCount).toBe(1);
  });

  it('refuses, saying the measurement was missing, when a limit cannot be checked because a call reported nothing', async () => {
    const provider = new QueuedResponseProvider([{ text: 'a' }, { text: 'b' }]);
    const { handles: h } = handles(makeUniformRoles(provider), { maxCostUsd: 1 });
    await h.generator.provider.generate(request());
    await expect(h.generator.provider.generate(request())).rejects.toMatchObject({ kind: 'BUDGET_MEASUREMENT_UNAVAILABLE', retryable: false });
    expect(provider.callCount).toBe(1);
  });

  it('turns an unrecognised provider error into a non-retryable MODEL_ERROR', async () => {
    const { handles: h, calls } = handles(makeUniformRoles(failing()));
    await expect(h.generator.provider.generate(request())).rejects.toMatchObject({ kind: 'MODEL_ERROR', retryable: false });
    expect(calls[0]).toMatchObject({ ok: false, failureKind: 'MODEL_ERROR' });
  });
});

describe('fallback', () => {
  it('asks the fallback model, with its model id, when the preferred one fails retryably', async () => {
    const backup = new QueuedResponseProvider([{ text: 'from backup', usage: { totalTokens: 3 } }]);
    const { handles: h, calls } = handles(withFallback(failing(503), backup));

    const result = await h.generator.provider.generate(request());

    expect(result.text).toBe('from backup');
    expect(backup.requests[0].model).toBe('backup-model');
    expect(calls.map((c) => [c.ok, c.usedFallback, c.provider, c.model])).toEqual([
      [false, false, 'fake', 'fake-model'],
      [true, true, 'backup', 'backup-model'],
    ]);
  });

  it('does not use the fallback for an error another model would not fix', async () => {
    const backup = new QueuedResponseProvider([{ text: 'unused' }]);
    const { handles: h } = handles(withFallback(failing(400), backup));
    await expect(h.generator.provider.generate(request())).rejects.toMatchObject({ kind: 'MODEL_ERROR', retryable: false });
    expect(backup.callCount).toBe(0);
  });

  it('fails, with the fallback\'s error, if the fallback fails too', async () => {
    const { handles: h, calls } = handles(withFallback(failing(503), failing(500)));
    await expect(h.generator.provider.generate(request())).rejects.toMatchObject({ kind: 'MODEL_ERROR', retryable: true });
    expect(calls.map((c) => c.usedFallback)).toEqual([false, true]);
  });

  it('is per role: a role with no fallback just fails', async () => {
    const backup = new QueuedResponseProvider([{ text: 'unused' }]);
    const roles = withFallback(failing(503), backup);
    roles.validator = { ...roles.validator, provider: failing(503) };
    const { handles: h } = handles(roles);
    await expect(h.validator.provider.generate(request())).rejects.toMatchObject({ kind: 'MODEL_ERROR' });
    expect(backup.callCount).toBe(0);
  });
});

it('keeps a fake-provider result untouched: queued results are passed as the same object', async () => {
  const queued: GenerationResult = { text: 'same' };
  const { handles: h } = handles(makeUniformRoles(new QueuedResponseProvider([queued])));
  expect(await h.generator.provider.generate(request())).toBe(queued);
});
