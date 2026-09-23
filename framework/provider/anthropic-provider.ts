import Anthropic from '@anthropic-ai/sdk';
import { estimateCost } from './pricing';
import type { GenerationRequest, GenerationResult, ModelProvider, TokenUsage } from './types';

/**
 * The installed SDK's Usage type only declares input_tokens/output_tokens (see
 * @anthropic-ai/sdk's resources/messages.d.ts), but the live Messages API has reported prompt-cache
 * and extended-thinking token counts on every response for longer than that type has existed — the
 * SDK parses the response body directly with no runtime schema check, so these fields are present
 * on the object at runtime even though the shipped .d.ts doesn't know about them. This widens the
 * type to read them without pulling in an SDK upgrade, which is out of scope here.
 */
interface AnthropicUsageWithExtras {
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  output_tokens_details?: { thinking_tokens?: number | null } | null;
}

export class AnthropicProvider implements ModelProvider {
  private client: Anthropic;

  constructor(apiKey: string = process.env.ANTHROPIC_API_KEY ?? '') {
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    this.client = new Anthropic({ apiKey });
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const start = Date.now();
    // Note: `temperature` is rejected by newer Claude models (e.g. claude-sonnet-5) with a
    // "temperature is deprecated for this model" 400 error, so it is intentionally not sent.
    const response = await this.client.messages.create({
      model: request.model,
      max_tokens: request.maxOutputTokens ?? 2000,
      system: request.systemPrompt,
      messages: [{ role: 'user', content: request.userPrompt }],
    });
    const latencyMs = Date.now() - start;

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock) {
      // Can happen when max_tokens is exhausted before any text content block is produced (e.g.
      // the model spent its budget on internal reasoning first). Surface this clearly instead of
      // silently returning an empty string, which otherwise turns into a confusing downstream
      // "did not return JSON" error with no indication of the real cause.
      throw new Error(
        `No text content block in response (stop_reason: ${response.stop_reason}, content block types: ${response.content
          .map((b) => b.type)
          .join(', ')}). This usually means max_tokens was too low for this request.`
      );
    }
    const text = textBlock.type === 'text' ? textBlock.text : '';

    // Cast, not a re-parse: these fields are already on the object the SDK handed back (see the
    // AnthropicUsageWithExtras comment above); reading them is not a network call or an estimate.
    const extras = response.usage as Anthropic.Messages.Usage & AnthropicUsageWithExtras;
    // "Cached" means served from cache (cache_read), not tokens spent writing a new cache entry
    // (cache_creation) — the latter is billed as regular new input, so folding it in here would
    // overstate the savings this field is meant to represent.
    const cachedInputTokens = extras.cache_read_input_tokens ?? undefined;
    const reasoningTokens = extras.output_tokens_details?.thinking_tokens ?? undefined;

    const usage: TokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    };

    return {
      text,
      usage,
      latencyMs,
      cost: estimateCost(request.model, usage),
    };
  }
}
