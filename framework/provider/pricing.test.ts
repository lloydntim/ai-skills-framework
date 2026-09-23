import { describe, expect, it } from 'vitest';
import { estimateCost, hasPricing, type PricingTable } from './pricing';

const PRICING: PricingTable = {
  'cheap-model': { input: 1, output: 2 },
};

describe('estimateCost', () => {
  it('computes cost from input/output tokens at the model\'s per-million-token rates', () => {
    const cost = estimateCost('cheap-model', { inputTokens: 1_000_000, outputTokens: 500_000 }, PRICING);
    expect(cost).toBeCloseTo(1 * 1 + 0.5 * 2, 10);
  });

  it('returns undefined for a model with no entry in the pricing table, rather than assuming free', () => {
    expect(estimateCost('unknown-model', { inputTokens: 100, outputTokens: 50 }, PRICING)).toBeUndefined();
  });

  it('returns undefined when usage is entirely absent (never estimates)', () => {
    expect(estimateCost('cheap-model', undefined, PRICING)).toBeUndefined();
  });

  it('returns undefined when usage is missing inputTokens', () => {
    expect(estimateCost('cheap-model', { outputTokens: 50 }, PRICING)).toBeUndefined();
  });

  it('returns undefined when usage is missing outputTokens', () => {
    expect(estimateCost('cheap-model', { inputTokens: 100 }, PRICING)).toBeUndefined();
  });

  it('treats zero tokens as known usage, returning a real zero rather than undefined', () => {
    expect(estimateCost('cheap-model', { inputTokens: 0, outputTokens: 0 }, PRICING)).toBe(0);
  });

  it('uses the real DEFAULT_PRICING table when no table is passed', () => {
    // Just confirms the default parameter wires up to the shipped config/pricing.json, without
    // hard-coding a price the file is free to change.
    expect(estimateCost('a-model-that-does-not-exist-anywhere', { inputTokens: 10, outputTokens: 10 })).toBeUndefined();
  });
});

describe('hasPricing', () => {
  it('is true for a model present in the table', () => {
    expect(hasPricing('cheap-model', PRICING)).toBe(true);
  });

  it('is false for a model absent from the table', () => {
    expect(hasPricing('unknown-model', PRICING)).toBe(false);
  });
});
