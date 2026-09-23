import { parseJsonResponse } from '@skills/framework/llm-json-response';
import type { PromptComponentSize } from '@skills/framework/provider/request-metadata';
import type { ModelProvider } from '@skills/framework/provider/types';
import { renderTemplate } from '@skills/framework/prompts/prompt-file';
import { pairwiseEvaluatorPrompt } from '../src/prompts';
import { caseInputChars } from '../src/runtime/generate';
import { PairwiseResponseSchema } from './pairwise-schema';
import type { EvalCase, PairwiseResult, Variant } from './types';

export interface PairwiseConfig {
  model: string;
  temperature: number;
}

/**
 * Blind pairwise comparison between any two variants' outputs for one case. Presentation order is
 * randomised (via `random`, injectable so tests can force it deterministically) so the judge's
 * answer cannot be attributed to which physical slot a variant happened to land in — see
 * position-bias.ts for measuring whether it is anyway.
 *
 * The judge's raw text (`justification`) is never rewritten to swap "Output A"/"Output B" for a
 * variant name — that would be brittle string replacement over free text the judge may phrase
 * however it likes. Instead the exact display mapping used for this call (`displayedAsA`,
 * `displayedAsB`, `displayedWinner`) is persisted alongside the untouched text, which is enough to
 * attribute it correctly without ever touching the string itself.
 */
export async function evaluatePairwise(
  kase: EvalCase,
  outputs: [{ variant: Variant; text: string }, { variant: Variant; text: string }],
  provider: ModelProvider,
  config: PairwiseConfig,
  /** Injectable so tests can force a display order deterministically instead of depending on chance. */
  random: () => number = Math.random
): Promise<PairwiseResult> {
  const [first, second] = outputs;
  const swap = random() < 0.5;
  const shownA = swap ? second : first;
  const shownB = swap ? first : second;

  const prompt = renderTemplate(pairwiseEvaluatorPrompt.task, {
    CV: kase.cvText,
    ROLE_DESCRIPTION: kase.roleDescription,
    INSTRUCTIONS: kase.instructions,
    LANGUAGE: kase.language,
    OUTPUT_A: shownA.text,
    OUTPUT_B: shownB.text,
  });

  const components: PromptComponentSize[] = [
    { component: 'pairwise-rubric', chars: pairwiseEvaluatorPrompt.task.length },
    { component: 'case-input', chars: caseInputChars(kase) },
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
    factualGrounding: unblind(parsed.factualGrounding),
    jobRelevance: unblind(parsed.jobRelevance),
    professionalTone: unblind(parsed.professionalTone),
    naturalness: unblind(parsed.naturalness),
    justification: parsed.justification ?? '',
    // Raw/blind counterparts of the above, derived from the exact same judge response and swap —
    // never independently computed — so they cannot drift out of sync with the unblinded fields.
    displayedWinner: parsed.winner,
    displayedAsA: shownA.variant,
    displayedAsB: shownB.variant,
  };
}
