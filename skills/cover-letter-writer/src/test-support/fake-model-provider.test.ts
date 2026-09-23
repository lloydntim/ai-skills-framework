import { describe, expect, it } from 'vitest';
import { FakeModelProvider } from './fake-model-provider';

const REQUEST = { userPrompt: 'hello', model: 'fake-model' };

describe('FakeModelProvider', () => {
  it('returns queued responses in order and records the requests it was called with', async () => {
    const provider = new FakeModelProvider();
    provider.queueResponse({ text: 'first' });
    provider.queueResponse({ text: 'second' });

    const first = await provider.generate(REQUEST);
    const second = await provider.generate({ ...REQUEST, userPrompt: 'again' });

    expect(first.text).toBe('first');
    expect(second.text).toBe('second');
    expect(provider.callCount).toBe(2);
    expect(provider.requests).toEqual([REQUEST, { ...REQUEST, userPrompt: 'again' }]);
  });

  it('carries usage, latency and cost through untouched', async () => {
    const provider = new FakeModelProvider();
    provider.queueResponse({
      text: 'ok',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 2, reasoningTokens: 1 },
      latencyMs: 42,
      cost: 0.001,
    });

    const result = await provider.generate(REQUEST);

    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cachedInputTokens: 2,
      reasoningTokens: 1,
    });
    expect(result.latencyMs).toBe(42);
    expect(result.cost).toBe(0.001);
  });

  it('throws a queued error instead of a queued response', async () => {
    const provider = new FakeModelProvider();
    provider.queueError(new Error('rate limited'));
    provider.queueResponse({ text: 'never reached without draining the error first' });

    await expect(provider.generate(REQUEST)).rejects.toThrow('rate limited');
  });

  it('throws a clear error when called with nothing queued, and makes no external request', async () => {
    const provider = new FakeModelProvider();

    await expect(provider.generate(REQUEST)).rejects.toThrow(/no response queued/i);
  });

  it('supports chaining queueResponse/queueError calls', async () => {
    const provider = new FakeModelProvider();
    provider.queueResponse({ text: 'a' }).queueResponse({ text: 'b' }).queueError(new Error('boom'));

    expect((await provider.generate(REQUEST)).text).toBe('a');
    expect((await provider.generate(REQUEST)).text).toBe('b');
    await expect(provider.generate(REQUEST)).rejects.toThrow('boom');
  });
});
