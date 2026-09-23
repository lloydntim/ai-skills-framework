import { parseJsonResponse } from '@skills/framework/llm-json-response';
import type { PromptComponentSize } from '@skills/framework/provider/request-metadata';
import type { ModelProvider } from '@skills/framework/provider/types';
import { renderTemplate } from '@skills/framework/prompts/prompt-file';
import { pairwiseEvaluatorPrompt } from '../src/prompts';
import { PairwiseResponseSchema } from './pairwise-schema';
import type { EvalCase, PairwiseResult, Variant } from './types';

export async function evaluatePairwise(
  kase: EvalCase,
  outputs: [{ variant: Variant; text: string }, { variant: Variant; text: string }],
  provider: ModelProvider,
  config: { model: string; temperature: number },
  /** Injectable so tests can force a display order deterministically instead of depending on chance. */
  random: () => number = Math.random
): Promise<PairwiseResult> {
  const [first, second] = outputs;
  const swap = random() < 0.5;
  const shownA = swap ? second : first;
  const shownB = swap ? first : second;

  const prompt = renderTemplate(pairwiseEvaluatorPrompt.task, {
    SOURCE: kase.input,
    INSTRUCTIONS: kase.instructions,
    TARGET_LANGUAGE: kase.targetLanguage,
    OUTPUT_A: shownA.text,
    OUTPUT_B: shownB.text,
  });

  const components: PromptComponentSize[] = [
    { component: 'pairwise-rubric', chars: pairwiseEvaluatorPrompt.task.length },
    { component: 'case-input', chars: kase.input.length },
    { component: 'candidate-outputs', chars: shownA.text.length + shownB.text.length },
  ];

  const result = await provider.generate({
    systemPrompt: pairwiseEvaluatorPrompt.system,
    userPrompt: prompt,
    model: config.model,
    temperature: config.temperature,
    maxOutputTokens: 4000,
    metadata: { requestType: 'pairwise-judge', components },
  });

  const parsed = parseJsonResponse(result.text, PairwiseResponseSchema, 'Pairwise evaluator');

  function unblind(letter: 'A' | 'B' | 'tie'): 'A' | 'B' | 'tie' {
    if (letter === 'tie') return 'tie';
    const shownVariant = letter === 'A' ? shownA.variant : shownB.variant;
    return shownVariant === first.variant ? 'A' : 'B';
  }

  return {
    caseId: kase.id,
    variantA: first.variant,
    variantB: second.variant,
    winner: unblind(parsed.winner),
    naturalness: unblind(parsed.naturalness),
    faithfulness: unblind(parsed.faithfulness),
    cvProfessionalism: unblind(parsed.cvProfessionalism),
    conciseness: unblind(parsed.conciseness),
    justification: parsed.justification ?? '',
    // Raw/blind counterparts of the above, derived from the exact same judge response and swap —
    // never independently computed — so they cannot drift out of sync with the unblinded fields.
    displayedWinner: parsed.winner,
    displayedAsA: shownA.variant,
    displayedAsB: shownB.variant,
  };
}
