import { z } from 'zod';

/**
 * Shape the offline, single-output quality evaluator's judge call must return (see
 * prompts/evaluator.md). The seven scored dimensions are required — a run with one of them
 * missing or out of its 1-5 range is a broken eval, not a partial result. The list/justification
 * fields are genuinely optional: the prompt allows an empty list when nothing applies, and the
 * caller (evaluator.ts) already defaults an absent one to `[]`/`''` rather than treating that as a
 * validation failure.
 */
export const EvaluatorScoreResponseSchema = z.object({
  factualGrounding: z.number().int().min(1).max(5),
  jobRelevance: z.number().int().min(1).max(5),
  professionalTone: z.number().int().min(1).max(5),
  specificity: z.number().int().min(1).max(5),
  naturalness: z.number().int().min(1).max(5),
  conciseness: z.number().int().min(1).max(5),
  overall: z.number().int().min(1).max(5),
  justification: z.string().optional(),
  problems: z.array(z.string()).optional(),
  missingExpectedFacts: z.array(z.string()).optional(),
  unsupportedClaims: z.array(z.string()).optional(),
  ownershipInflationNotes: z.array(z.string()).optional(),
  unofferedBenefitNotes: z.array(z.string()).optional(),
});

export type EvaluatorScoreResponse = z.infer<typeof EvaluatorScoreResponseSchema>;
