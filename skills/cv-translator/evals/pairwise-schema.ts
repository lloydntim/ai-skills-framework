import { z } from 'zod';

/** The only three values the pairwise judge may choose per dimension (see prompts/pairwise-evaluator.md). */
export const PairwiseWinnerSchema = z.enum(['A', 'B', 'tie']);

export const PairwiseResponseSchema = z.object({
  naturalness: PairwiseWinnerSchema,
  faithfulness: PairwiseWinnerSchema,
  cvProfessionalism: PairwiseWinnerSchema,
  conciseness: PairwiseWinnerSchema,
  winner: PairwiseWinnerSchema,
  justification: z.string().optional(),
});

export type PairwiseResponse = z.infer<typeof PairwiseResponseSchema>;
