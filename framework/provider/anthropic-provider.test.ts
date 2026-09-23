import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider, EmptyModelResponseError, UnsupportedRuntimeConfigError, buildReasoningParams } from './anthropic-provider';

const create = vi.fn();

// Vitest hoists vi.mock calls above imports, so AnthropicProvider above already sees the mocked
// client — no network access happens anywhere in this file.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create };
  },
}));

beforeEach(() => {
  create.mockReset();
});

function response(usage: Record<string, unknown>) {
  return {
    content: [{ type: 'text', text: 'translated output' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50, ...usage },
  };
}

describe('AnthropicProvider — usage extraction', () => {
  it('reports only input/output/total tokens when the response has no cache or thinking fields', async () => {
    create.mockResolvedValueOnce(response({}));
    const provider = new AnthropicProvider('fake-key');

    const result = await provider.generate({ userPrompt: 'hi', model: 'claude-x' });

    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
  });

  it('records cache_read_input_tokens as cachedInputTokens, not cache_creation_input_tokens', async () => {
    create.mockResolvedValueOnce(
      response({ cache_creation_input_tokens: 40, cache_read_input_tokens: 25 })
    );
    const provider = new AnthropicProvider('fake-key');

    const result = await provider.generate({ userPrompt: 'hi', model: 'claude-x' });

    expect(result.usage?.cachedInputTokens).toBe(25);
  });

  it('records output_tokens_details.thinking_tokens as reasoningTokens when present', async () => {
    create.mockResolvedValueOnce(
      response({ output_tokens_details: { thinking_tokens: 12 } })
    );
    const provider = new AnthropicProvider('fake-key');

    const result = await provider.generate({ userPrompt: 'hi', model: 'claude-x' });

    expect(result.usage?.reasoningTokens).toBe(12);
  });

  it('leaves cachedInputTokens/reasoningTokens absent (not zero) when the response has null for them', async () => {
    create.mockResolvedValueOnce(
      response({ cache_creation_input_tokens: null, cache_read_input_tokens: null, output_tokens_details: null })
    );
    const provider = new AnthropicProvider('fake-key');

    const result = await provider.generate({ userPrompt: 'hi', model: 'claude-x' });

    expect(result.usage?.cachedInputTokens).toBeUndefined();
    expect(result.usage?.reasoningTokens).toBeUndefined();
  });
});

describe('AnthropicProvider — construction', () => {
  it('throws immediately when no API key is passed and none is set in the environment', () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => new AnthropicProvider()).toThrow(/ANTHROPIC_API_KEY is not set/);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it('accepts an explicitly passed key even when the environment has none', () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => new AnthropicProvider('explicit-key')).not.toThrow();
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });
});

describe('AnthropicProvider — error paths', () => {
  it('throws a clear, diagnosable error when the response has no text content block', async () => {
    create.mockResolvedValue({
      content: [{ type: 'thinking' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const provider = new AnthropicProvider('fake-key');

    await expect(provider.generate({ userPrompt: 'hi', model: 'claude-x' })).rejects.toThrow(EmptyModelResponseError);
    await expect(provider.generate({ userPrompt: 'hi', model: 'claude-x' })).rejects.toThrow(/no usable text/);
    await expect(provider.generate({ userPrompt: 'hi', model: 'claude-x' })).rejects.toThrow(/max_tokens/);
  });

  it('names reasoning, the budget and what reasoning actually spent when the budget was exhausted', async () => {
    create.mockResolvedValue({
      content: [{ type: 'thinking' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 100, output_tokens: 2000, output_tokens_details: { thinking_tokens: 2000 } },
    });
    const provider = new AnthropicProvider('fake-key');

    const call = provider.generate({ userPrompt: 'hi', model: 'claude-sonnet-5', reasoning: 'high', maxOutputTokens: 2000 });

    // This is the original failure: every output token went to reasoning and none to an answer.
    await expect(call).rejects.toThrow(/2000 of 2000 output tokens went to reasoning/);
    await expect(call).rejects.toThrow(/raise this role's maxOutputTokens, or lower its reasoning/);
  });

  it('treats a text block with nothing but whitespace in it as no answer, not as an empty success', async () => {
    create.mockResolvedValue({
      content: [{ type: 'thinking' }, { type: 'text', text: '   \n ' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const provider = new AnthropicProvider('fake-key');

    await expect(provider.generate({ userPrompt: 'hi', model: 'claude-sonnet-5', reasoning: 'high' })).rejects.toThrow(
      EmptyModelResponseError
    );
  });

  it('returns the first text block that has content, ignoring thinking blocks in front of it', async () => {
    create.mockResolvedValue({
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'the answer' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const provider = new AnthropicProvider('fake-key');

    const result = await provider.generate({ userPrompt: 'hi', model: 'claude-sonnet-5', reasoning: 'high' });

    expect(result.text).toBe('the answer');
  });

  it('propagates a rejection from the underlying API call instead of swallowing it', async () => {
    create.mockRejectedValueOnce(new Error('rate limited'));
    const provider = new AnthropicProvider('fake-key');

    await expect(provider.generate({ userPrompt: 'hi', model: 'claude-x' })).rejects.toThrow('rate limited');
  });
});

describe('buildReasoningParams — how a rung of the ladder reaches the API', () => {
  it('sends adaptive thinking plus output_config.effort on the models that take effort', () => {
    expect(buildReasoningParams('claude-sonnet-5', 'high', 16000)).toEqual({
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
    });
    expect(buildReasoningParams('claude-opus-5', 'medium', 8000)).toEqual({
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
    });
  });

  it('sends an explicit thinking budget, and never output_config, on a model that rejects effort', () => {
    // claude-haiku-4-5 errors on output_config.effort — a config that sent it would 400, not degrade.
    expect(buildReasoningParams('claude-haiku-4-5-20251001', 'medium', 8000)).toEqual({
      thinking: { type: 'enabled', budget_tokens: 2048 },
    });
  });

  it('matches a dated snapshot id the same way as the bare model id', () => {
    expect(buildReasoningParams('claude-haiku-4-5-20251001', 'low', 8000)).toEqual(
      buildReasoningParams('claude-haiku-4-5', 'low', 8000)
    );
  });

  it('expresses "none" as each family means it, rather than one setting for both', () => {
    expect(buildReasoningParams('claude-sonnet-5', 'none', 8000)).toEqual({ thinking: { type: 'disabled' } });
    // On the budget family, no thinking is the absence of the field — sending "disabled" is not how it is said.
    expect(buildReasoningParams('claude-haiku-4-5', 'none', 8000)).toEqual({});
  });

  it('fails clearly for a model it has no entry for, instead of guessing a family', () => {
    expect(() => buildReasoningParams('claude-future-9', 'high', 16000)).toThrow(UnsupportedRuntimeConfigError);
    expect(() => buildReasoningParams('claude-future-9', 'high', 16000)).toThrow(/no entry in the reasoning-support table/);
  });

  it('fails clearly for a level the model does not have', () => {
    // xhigh arrived with Opus 4.7; the 4.6 generation goes straight from high to max.
    expect(() => buildReasoningParams('claude-sonnet-4-6', 'xhigh', 16000)).toThrow(/does not support reasoning level "xhigh"/);
    expect(() => buildReasoningParams('claude-sonnet-4-6', 'max', 16000)).not.toThrow();
  });

  it('fails clearly when the thinking budget would not leave room for an answer', () => {
    expect(() => buildReasoningParams('claude-haiku-4-5', 'max', 8000)).toThrow(UnsupportedRuntimeConfigError);
    expect(() => buildReasoningParams('claude-haiku-4-5', 'max', 8000)).toThrow(/does not fit inside maxOutputTokens 8000/);
  });
});

describe('AnthropicProvider — what reaches the request body', () => {
  it('sends the configured budget and reasoning fields', async () => {
    create.mockResolvedValueOnce(response({}));
    const provider = new AnthropicProvider('fake-key');

    await provider.generate({ userPrompt: 'hi', model: 'claude-sonnet-5', reasoning: 'medium', maxOutputTokens: 8000 });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-5',
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
      })
    );
  });

  it('never sends temperature, which current Claude models reject', async () => {
    create.mockResolvedValueOnce(response({}));
    const provider = new AnthropicProvider('fake-key');

    await provider.generate({ userPrompt: 'hi', model: 'claude-sonnet-5', temperature: 0.3, reasoning: 'high' });

    expect(create.mock.calls[0][0]).not.toHaveProperty('temperature');
  });

  it('says nothing about reasoning when no role asked for a level, leaving the API default in place', async () => {
    create.mockResolvedValueOnce(response({}));
    const provider = new AnthropicProvider('fake-key');

    await provider.generate({ userPrompt: 'hi', model: 'claude-x' });

    const body = create.mock.calls[0][0];
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('output_config');
  });

  it('defaults an unconfigured budget to one that can hold reasoning and an answer, not to 2,000', async () => {
    create.mockResolvedValueOnce(response({}));
    const provider = new AnthropicProvider('fake-key');

    await provider.generate({ userPrompt: 'hi', model: 'claude-x' });

    expect(create.mock.calls[0][0].max_tokens).toBe(16000);
  });

  it('rejects an unusable model/reasoning pairing before making the call', async () => {
    const provider = new AnthropicProvider('fake-key');

    await expect(
      provider.generate({ userPrompt: 'hi', model: 'claude-future-9', reasoning: 'high', maxOutputTokens: 16000 })
    ).rejects.toThrow(UnsupportedRuntimeConfigError);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('AnthropicProvider — cost from the recorded usage', () => {
  it('costs the call from input and output tokens at the model\'s configured price', async () => {
    create.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
    });
    const provider = new AnthropicProvider('fake-key');

    const result = await provider.generate({ userPrompt: 'hi', model: 'claude-sonnet-5', reasoning: 'high' });

    // config/pricing.json: claude-sonnet-5 is $2/MTok in, $10/MTok out.
    expect(result.cost).toBeCloseTo(12, 10);
  });

  it('does not charge reasoning twice: thinking tokens are already inside output_tokens', async () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000, output_tokens_details: { thinking_tokens: 900_000 } };
    create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage });
    const provider = new AnthropicProvider('fake-key');

    const result = await provider.generate({ userPrompt: 'hi', model: 'claude-sonnet-5', reasoning: 'high' });

    expect(result.usage?.reasoningTokens).toBe(900_000);
    // Same bill and same total as the call above, which reported no reasoning breakdown at all.
    expect(result.usage?.totalTokens).toBe(2_000_000);
    expect(result.cost).toBeCloseTo(12, 10);
  });

  it('reports no cost rather than zero when the model has no entry in the pricing table', async () => {
    create.mockResolvedValueOnce(response({}));
    const provider = new AnthropicProvider('fake-key');

    const result = await provider.generate({ userPrompt: 'hi', model: 'claude-x' });

    expect(result.cost).toBeUndefined();
  });
});
