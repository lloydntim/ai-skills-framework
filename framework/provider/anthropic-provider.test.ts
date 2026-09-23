import { describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from './anthropic-provider';

const create = vi.fn();

// Vitest hoists vi.mock calls above imports, so AnthropicProvider above already sees the mocked
// client — no network access happens anywhere in this file.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create };
  },
}));

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

    await expect(provider.generate({ userPrompt: 'hi', model: 'claude-x' })).rejects.toThrow(
      /No text content block in response/
    );
    await expect(provider.generate({ userPrompt: 'hi', model: 'claude-x' })).rejects.toThrow(/max_tokens/);
  });

  it('propagates a rejection from the underlying API call instead of swallowing it', async () => {
    create.mockRejectedValueOnce(new Error('rate limited'));
    const provider = new AnthropicProvider('fake-key');

    await expect(provider.generate({ userPrompt: 'hi', model: 'claude-x' })).rejects.toThrow('rate limited');
  });
});
