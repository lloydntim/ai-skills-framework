import { describe, expect, it } from 'vitest';
import { LlmResponseValidationError } from '@skills/framework/llm-json-response';
import { SingleResponseProvider } from '@skills/framework/testing/single-response-provider';
import { evaluatePairwise } from './pairwise-evaluator';
import type { EvalCase } from './types';

const kase: EvalCase = {
  id: 'case-1',
  category: 'naturalness',
  sourceLanguage: 'de',
  targetLanguage: 'en',
  input: 'Kurzer Lebenslaufabschnitt.',
  instructions: 'Translate faithfully.',
};

const outputs: [{ variant: 'A'; text: string }, { variant: 'B'; text: string }] = [
  { variant: 'A', text: 'First candidate draft.' },
  { variant: 'B', text: 'Second candidate draft.' },
];

const config = { model: 'fake-model', temperature: 0 };

function judgeSaid(json: Record<string, unknown>): SingleResponseProvider {
  return new SingleResponseProvider({ text: JSON.stringify(json) });
}

const VALID_PAIRWISE_RESPONSE = {
  naturalness: 'A',
  faithfulness: 'B',
  cvProfessionalism: 'tie',
  conciseness: 'A',
  winner: 'A',
  justification: 'Candidate A reads more naturally.',
};

// outputs[0] is the codebase's variant 'A' (baseline, no skill) and outputs[1] is variant 'B' (raw
// skill). Forcing random() >= 0.5 keeps swap=false (baseline shown in display slot A); forcing it
// < 0.5 flips swap=true (baseline shown in display slot B) — this lets "which presentation order"
// be picked deterministically instead of depending on chance.
const BASELINE_SHOWN_AS_A = () => 0.9;
const BASELINE_SHOWN_AS_B = () => 0.1;

describe('evaluatePairwise — pairwise judge response hardening', () => {
  it('accepts a well-formed response using only the allowed winner enum', async () => {
    const provider = judgeSaid(VALID_PAIRWISE_RESPONSE);

    const result = await evaluatePairwise(kase, outputs, provider, config);

    // The judge's A/B choice is unblinded against a random display order, so only the *shape* and
    // enum membership are asserted here, not which physical variant "A" resolves to.
    expect(['A', 'B']).toContain(result.winner);
    expect(['A', 'B', 'tie']).toContain(result.naturalness);
    expect(['A', 'B', 'tie']).toContain(result.faithfulness);
    expect(result.cvProfessionalism).toBe('tie'); // 'tie' unblinds to itself regardless of display order
    expect(result.justification).toBe('Candidate A reads more naturally.');
  });

  it('rejects a reply that is not JSON at all', async () => {
    const provider = new SingleResponseProvider({ text: 'A is clearly better.' });

    await expect(evaluatePairwise(kase, outputs, provider, config)).rejects.toThrow(/did not return JSON/);
  });

  it('rejects malformed JSON', async () => {
    const provider = new SingleResponseProvider({ text: '{ "winner": "A", }' });

    await expect(evaluatePairwise(kase, outputs, provider, config)).rejects.toThrow(/invalid JSON/);
  });

  it('rejects a response missing a required dimension', async () => {
    const { winner, ...withoutWinner } = VALID_PAIRWISE_RESPONSE;
    void winner;
    const provider = judgeSaid(withoutWinner);

    await expect(evaluatePairwise(kase, outputs, provider, config)).rejects.toThrow(LlmResponseValidationError);
    await expect(evaluatePairwise(kase, outputs, provider, config)).rejects.toThrow(/winner/);
  });

  it('rejects a winner value outside the "A" | "B" | "tie" enum', async () => {
    const provider = judgeSaid({ ...VALID_PAIRWISE_RESPONSE, winner: 'C' });

    await expect(evaluatePairwise(kase, outputs, provider, config)).rejects.toThrow(LlmResponseValidationError);
  });

  it('rejects a null winner rather than treating it as a valid enum member', async () => {
    const provider = judgeSaid({ ...VALID_PAIRWISE_RESPONSE, winner: null });

    await expect(evaluatePairwise(kase, outputs, provider, config)).rejects.toThrow(LlmResponseValidationError);
  });

  it('rejects a field of the wrong type instead of coercing it', async () => {
    const provider = judgeSaid({ ...VALID_PAIRWISE_RESPONSE, winner: 1 });

    await expect(evaluatePairwise(kase, outputs, provider, config)).rejects.toThrow(LlmResponseValidationError);
  });
});

describe('evaluatePairwise — presentation order metadata', () => {
  it('records the display mapping when baseline (variant A) is shown as display slot A', async () => {
    const provider = judgeSaid({ ...VALID_PAIRWISE_RESPONSE, winner: 'A' });

    const result = await evaluatePairwise(kase, outputs, provider, config, BASELINE_SHOWN_AS_A);

    expect(result.displayedAsA).toBe('A');
    expect(result.displayedAsB).toBe('B');
    expect(result.displayedWinner).toBe('A');
    // The judge picked display slot A, which held baseline (variantA) here, so the canonical
    // winner must say variantA won.
    expect(result.winner).toBe('A');
  });

  it('records the display mapping when baseline (variant A) is shown as display slot B', async () => {
    const provider = judgeSaid({ ...VALID_PAIRWISE_RESPONSE, winner: 'A' });

    const result = await evaluatePairwise(kase, outputs, provider, config, BASELINE_SHOWN_AS_B);

    expect(result.displayedAsA).toBe('B');
    expect(result.displayedAsB).toBe('A');
    expect(result.displayedWinner).toBe('A');
    // The judge again picked display slot A, but this time slot A held the raw-skill variant (B),
    // not baseline — so despite an identical judge answer, the canonical winner must flip.
    expect(result.winner).toBe('B');
  });

  it('keeps justification as the judge wrote it, tagged with the display mapping needed to read it correctly', async () => {
    const provider = judgeSaid({
      ...VALID_PAIRWISE_RESPONSE,
      winner: 'A',
      justification: 'Output A is more concise and natural.',
    });

    const result = await evaluatePairwise(kase, outputs, provider, config, BASELINE_SHOWN_AS_B);

    // The raw text is preserved verbatim — never rewritten to say "variant B" or similar — but the
    // display mapping alongside it is what lets a reader correctly attribute "Output A" here to
    // the raw-skill variant (B), not to baseline, without any brittle text substitution.
    expect(result.justification).toBe('Output A is more concise and natural.');
    expect(result.displayedAsA).toBe('B');
  });
});

describe('evaluatePairwise — canonical winner for each judge answer', () => {
  it('resolves winner "A" to the variant actually shown in slot A', async () => {
    const provider = judgeSaid({ ...VALID_PAIRWISE_RESPONSE, winner: 'A' });
    const result = await evaluatePairwise(kase, outputs, provider, config, BASELINE_SHOWN_AS_A);
    expect(result.winner).toBe('A');
  });

  it('resolves winner "B" to the variant actually shown in slot B', async () => {
    const provider = judgeSaid({ ...VALID_PAIRWISE_RESPONSE, winner: 'B' });
    const result = await evaluatePairwise(kase, outputs, provider, config, BASELINE_SHOWN_AS_A);
    expect(result.winner).toBe('B');
  });

  it('passes "tie" through unchanged regardless of display order', async () => {
    const provider = judgeSaid({ ...VALID_PAIRWISE_RESPONSE, winner: 'tie' });

    const shownAsA = await evaluatePairwise(kase, outputs, provider, config, BASELINE_SHOWN_AS_A);
    const shownAsB = await evaluatePairwise(kase, outputs, provider, config, BASELINE_SHOWN_AS_B);

    expect(shownAsA.winner).toBe('tie');
    expect(shownAsB.winner).toBe('tie');
    expect(shownAsA.displayedWinner).toBe('tie');
    expect(shownAsB.displayedWinner).toBe('tie');
  });
});

describe('evaluatePairwise — displayed/canonical consistency', () => {
  // Re-derives the canonical winner independently from the raw (displayed) fields, using the same
  // logic evaluatePairwise itself uses internally, then checks it always matches `winner`. Because
  // `winner` and the displayed fields come from one parsed response and one swap decision inside a
  // single function call, they cannot be produced independently and drift apart — this test pins
  // that invariant down explicitly rather than leaving it as an unstated assumption.
  function deriveCanonicalWinner(
    displayedWinner: 'A' | 'B' | 'tie',
    displayedAsA: string,
    variantA: string
  ): 'A' | 'B' | 'tie' {
    if (displayedWinner === 'tie') return 'tie';
    const shownVariant = displayedWinner === 'A' ? displayedAsA : undefined;
    if (displayedWinner === 'A') return shownVariant === variantA ? 'A' : 'B';
    return displayedAsA === variantA ? 'B' : 'A'; // displayedWinner === 'B': slot B holds the other one
  }

  it.each(['A', 'B', 'tie'] as const)('holds for judge winner=%s under either display order', async (winnerChoice) => {
    for (const random of [BASELINE_SHOWN_AS_A, BASELINE_SHOWN_AS_B]) {
      const provider = judgeSaid({ ...VALID_PAIRWISE_RESPONSE, winner: winnerChoice });
      const result = await evaluatePairwise(kase, outputs, provider, config, random);

      expect(result.displayedWinner).toBeDefined();
      expect(result.displayedAsA).toBeDefined();
      const expected = deriveCanonicalWinner(result.displayedWinner!, result.displayedAsA!, result.variantA);
      expect(result.winner).toBe(expected);
    }
  });
});
