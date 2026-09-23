import Anthropic from '@anthropic-ai/sdk';
import { estimateCost } from './pricing';
import type { ReasoningEffort } from './role-runtime';
import type { GenerationRequest, GenerationResult, ModelProvider, TokenUsage } from './types';

/**
 * The installed SDK's Usage type only declares input_tokens/output_tokens (see
 * @anthropic-ai/sdk's resources/messages.d.ts), but the live Messages API has reported prompt-cache
 * and extended-thinking token counts on every response for longer than that type has existed — the
 * SDK parses the response body directly with no runtime schema check, so these fields are present
 * on the object at runtime even though the shipped .d.ts doesn't know about them. This widens the
 * type to read them without pulling in an SDK upgrade, which is out of scope here.
 *
 * `thinking_tokens` is a *breakdown of* output_tokens, not a category alongside it — the API
 * documents it as always <= output_tokens, with output_tokens - thinking_tokens approximating the
 * visible answer. That is why enabling reasoning does not change how totals or cost are computed
 * below: reasoning is already inside output_tokens and is billed at the output rate.
 */
interface AnthropicUsageWithExtras {
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  output_tokens_details?: { thinking_tokens?: number | null } | null;
}

/**
 * The same SDK gap on the request side: the installed version predates both `thinking` and
 * `output_config`, so neither is in MessageCreateParams. The SDK posts the body object through
 * verbatim (resources/messages.js does `this._client.post('/v1/messages', { body })` with no
 * allow-list), so extra fields do reach the API — this type says which ones this file is allowed to
 * add, rather than casting the whole body to `any` and losing every other check.
 */
interface AnthropicReasoningParams {
  thinking?: { type: 'adaptive' } | { type: 'disabled' } | { type: 'enabled'; budget_tokens: number };
  output_config?: { effort: Exclude<ReasoningEffort, 'none'> };
}

/** Thrown when a role's runtime configuration cannot be expressed for the model it is paired with. */
export class UnsupportedRuntimeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedRuntimeConfigError';
  }
}

/** Thrown when a call succeeded at the HTTP level but produced nothing a caller can use. */
export class EmptyModelResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmptyModelResponseError';
  }
}

/**
 * How a family of Claude models expresses reasoning on the wire. Which family a model belongs to is
 * a fact about the API, not a preference, and getting it wrong is a 400 rather than a degraded
 * answer — so it is written down here once rather than guessed per call site.
 *
 * - `effort`: adaptive thinking plus `output_config.effort`. `budget_tokens` is rejected on these
 *   models, and so is `temperature`.
 * - `budget`: no `output_config` at all (it errors), and thinking is opt-in via an explicit token
 *   budget. Omitting `thinking` means no thinking, which is what "none" wants anyway.
 */
type ReasoningFamily = 'effort' | 'budget';

interface ModelReasoningSupport {
  family: ReasoningFamily;
  /** Which rungs of the ladder this model can actually be asked for. */
  levels: readonly ReasoningEffort[];
}

const ALL_EFFORT_LEVELS: readonly ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
/** `xhigh` arrived with Opus 4.7; the 4.6 generation stops at `high` and `max`. */
const EFFORT_LEVELS_4_6: readonly ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'max'];

/**
 * Matched by prefix, longest first, so a dated snapshot id (`claude-haiku-4-5-20251001`) resolves
 * the same way as its bare id. A model with no entry is not assumed into a family: see generate().
 */
const MODEL_REASONING_SUPPORT: ReadonlyArray<readonly [prefix: string, support: ModelReasoningSupport]> = [
  ['claude-opus-5', { family: 'effort', levels: ALL_EFFORT_LEVELS }],
  ['claude-sonnet-5', { family: 'effort', levels: ALL_EFFORT_LEVELS }],
  ['claude-opus-4-8', { family: 'effort', levels: ALL_EFFORT_LEVELS }],
  ['claude-opus-4-7', { family: 'effort', levels: ALL_EFFORT_LEVELS }],
  ['claude-opus-4-6', { family: 'effort', levels: EFFORT_LEVELS_4_6 }],
  ['claude-sonnet-4-6', { family: 'effort', levels: EFFORT_LEVELS_4_6 }],
  ['claude-haiku-4-5', { family: 'budget', levels: ALL_EFFORT_LEVELS }],
];

/**
 * What each rung means on a model that takes an explicit thinking budget. The floor is the API's
 * own minimum (1,024); the rest step up from it. These are only reachable on the `budget` family —
 * on the `effort` family the rung is sent as-is and the model decides how much to spend.
 */
const BUDGET_TOKENS_BY_LEVEL: Record<Exclude<ReasoningEffort, 'none'>, number> = {
  low: 1_024,
  medium: 2_048,
  high: 4_096,
  xhigh: 8_192,
  max: 16_384,
};

function reasoningSupportFor(model: string): ModelReasoningSupport | undefined {
  return MODEL_REASONING_SUPPORT.find(([prefix]) => model.startsWith(prefix))?.[1];
}

/**
 * Translates one role's rung of the provider-neutral ladder into the fields this model actually
 * accepts, or explains why it cannot be done. Pure and total: it makes no call, so an unusable
 * pairing is reported before any money is spent.
 */
export function buildReasoningParams(
  model: string,
  reasoning: ReasoningEffort,
  maxOutputTokens: number
): AnthropicReasoningParams {
  const support = reasoningSupportFor(model);
  if (!support) {
    throw new UnsupportedRuntimeConfigError(
      `Model "${model}" has no entry in the reasoning-support table, so a "reasoning" setting cannot be ` +
        `translated into request fields for it. Add it to MODEL_REASONING_SUPPORT in anthropic-provider.ts, ` +
        `naming the family it belongs to; guessing risks a 400 or silently sending no reasoning configuration at all.`
    );
  }

  if (!support.levels.includes(reasoning)) {
    throw new UnsupportedRuntimeConfigError(
      `Model "${model}" does not support reasoning level "${reasoning}". Supported: ${support.levels.join(', ')}.`
    );
  }

  if (support.family === 'budget') {
    // Omitting `thinking` is how this family means "no thinking", and `output_config` is never sent
    // to it — the models that take a budget reject the effort field.
    if (reasoning === 'none') return {};
    const budgetTokens = BUDGET_TOKENS_BY_LEVEL[reasoning];
    if (budgetTokens >= maxOutputTokens) {
      throw new UnsupportedRuntimeConfigError(
        `Model "${model}" at reasoning "${reasoning}" needs a thinking budget of ${budgetTokens} tokens, which ` +
          `does not fit inside maxOutputTokens ${maxOutputTokens} — the API requires the budget to be strictly ` +
          `smaller, and a call configured this way would leave nothing for the answer. Raise this role's ` +
          `maxOutputTokens above ${budgetTokens}, or lower its reasoning.`
      );
    }
    return { thinking: { type: 'enabled', budget_tokens: budgetTokens } };
  }

  // Thinking stays adaptive and the depth is set by effort. Disabling thinking outright is
  // deliberately a per-role opt-out only, never a default: see ReasoningEffort in role-runtime.ts
  // for the two documented failure modes it causes on Claude Opus 5.
  if (reasoning === 'none') return { thinking: { type: 'disabled' } };
  return { thinking: { type: 'adaptive' }, output_config: { effort: reasoning } };
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
    // 16,000 rather than a small number: the budget has to cover the model's reasoning as well as
    // its answer, and current Claude models think by default whether or not this repository asks
    // them to. It is also the largest budget a single non-streaming request can comfortably finish
    // inside the SDK's timeout. In practice every production call arrives with the budget its role
    // configured (see role-runtime.ts); this is the floor for a call made without one.
    const maxOutputTokens = request.maxOutputTokens ?? 16_000;
    // Only translated when a role actually asked for a reasoning level. A request with none is sent
    // exactly as before, leaving the API's own default in place, so a direct provider user is never
    // forced to adopt the model table.
    const reasoningParams = request.reasoning ? buildReasoningParams(request.model, request.reasoning, maxOutputTokens) : {};

    // Note: `temperature` is rejected by newer Claude models (e.g. claude-sonnet-5) with a
    // "temperature is deprecated for this model" 400 error, so it is intentionally not sent.
    const response = await this.client.messages.create({
      model: request.model,
      max_tokens: maxOutputTokens,
      system: request.systemPrompt,
      messages: [{ role: 'user', content: request.userPrompt }],
      ...reasoningParams,
    } as Anthropic.MessageCreateParamsNonStreaming & AnthropicReasoningParams);
    const latencyMs = Date.now() - start;

    // Cast, not a re-parse: these fields are already on the object the SDK handed back (see the
    // AnthropicUsageWithExtras comment above); reading them is not a network call or an estimate.
    const extras = response.usage as Anthropic.Messages.Usage & AnthropicUsageWithExtras;
    // "Cached" means served from cache (cache_read), not tokens spent writing a new cache entry
    // (cache_creation), which is billed as regular new input. Nothing here requests caching, so
    // both are normally absent; they are read rather than assumed to be zero.
    const cachedInputTokens = extras.cache_read_input_tokens ?? undefined;
    const reasoningTokens = extras.output_tokens_details?.thinking_tokens ?? undefined;

    const usage: TokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      // Reasoning is not added in: the API counts it inside output_tokens already, so adding it
      // would double-count both the total and, through estimateCost, the bill.
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    };

    // An empty text block counts as no text: with thinking on, `display` defaults to omitted, and a
    // call that runs out of budget part-way can leave a text block with nothing in it. Treating
    // that as a successful empty answer is what turned this failure into a confusing downstream
    // "did not return JSON" error with no indication of the real cause.
    const text = response.content.find((block) => block.type === 'text' && block.text.trim().length > 0);
    if (!text || text.type !== 'text') {
      throw new EmptyModelResponseError(this.describeEmptyResponse(request, response, maxOutputTokens, usage));
    }

    return {
      text: text.text,
      usage,
      latencyMs,
      cost: estimateCost(request.model, usage),
    };
  }

  /** Says what was asked for and what came back, so the cause is readable without re-running the call. */
  private describeEmptyResponse(
    request: GenerationRequest,
    response: Anthropic.Messages.Message,
    maxOutputTokens: number,
    usage: TokenUsage
  ): string {
    const blocks = response.content.map((b) => b.type).join(', ') || '(none)';
    const spentOnReasoning =
      usage.reasoningTokens !== undefined ? `${usage.reasoningTokens} of ${usage.outputTokens} output tokens went to reasoning` : 'the response reported no reasoning-token breakdown';
    const budgetExhausted = response.stop_reason === 'max_tokens';
    return (
      `The model returned no usable text (stop_reason: ${response.stop_reason}, content block types: ${blocks}). ` +
      `Asked for reasoning "${request.reasoning ?? '(provider default)'}" with max_tokens ${maxOutputTokens}; ${spentOnReasoning}. ` +
      (budgetExhausted
        ? `The budget was exhausted before an answer was produced: raise this role's maxOutputTokens, or lower its reasoning.`
        : `This is not a budget exhaustion — check the prompt and the model's stop reason.`)
    );
  }
}
