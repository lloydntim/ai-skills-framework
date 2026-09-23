import pricingJson from '../config/pricing.json';
import type { TokenUsage } from './types';

/** What one model costs, in US dollars per million tokens, as authored in config/pricing.json. */
export interface ModelPricing {
  input: number;
  output: number;
}

export type PricingTable = Record<string, ModelPricing>;

/**
 * Prices live in config/pricing.json rather than in source so adding a model — or correcting a
 * price after a provider changes it — needs no code change. This is the single table: the provider
 * uses it to cost an individual call, and the eval matrix summary uses it to cost a whole run, so
 * the two can never disagree.
 */
export const DEFAULT_PRICING: PricingTable = pricingJson;

/**
 * Dollar cost of one call's usage, or undefined when it cannot be known — either the model has no
 * entry in the pricing table, or the provider did not report token counts. Undefined is deliberate
 * and must be propagated rather than coerced to 0: a run whose cost is unknown is not a free run,
 * and a summary that shows 0 for it would be actively misleading.
 */
export function estimateCost(
  model: string,
  usage: TokenUsage | undefined,
  pricing: PricingTable = DEFAULT_PRICING
): number | undefined {
  const price = pricing[model];
  if (!price || usage?.inputTokens === undefined || usage.outputTokens === undefined) {
    return undefined;
  }
  return (usage.inputTokens / 1_000_000) * price.input + (usage.outputTokens / 1_000_000) * price.output;
}

/** True when a cost can be produced for this model at all — used to report "no pricing" explicitly. */
export function hasPricing(model: string, pricing: PricingTable = DEFAULT_PRICING): boolean {
  return pricing[model] !== undefined;
}
