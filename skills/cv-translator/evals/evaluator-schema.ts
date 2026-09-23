import { z } from 'zod';

/**
 * Shape the offline quality evaluator's judge call must return (see prompts/evaluator.md). The
 * six scored dimensions are required — a run with one of them missing or out of its 1-5 range is
 * a broken eval, not a partial result. The list/justification fields are genuinely optional: the
 * prompt allows an empty list when nothing applies, and callers already default an absent one to
 * `[]`/`''` rather than treating it as a validation failure.
 */
export const EvaluatorScoreResponseSchema = z.object({
  faithfulness: z.number().int().min(1).max(5),
  naturalness: z.number().int().min(1).max(5),
  cvQuality: z.number().int().min(1).max(5),
  terminology: z.number().int().min(1).max(5),
  conciseness: z.number().int().min(1).max(5),
  overall: z.number().int().min(1).max(5),
  justification: z.string().optional(),
  problems: z.array(z.string()).optional(),
  missingExpectedFacts: z.array(z.string()).optional(),
  unsupportedClaims: z.array(z.string()).optional(),
  seniorityInflationNotes: z.array(z.string()).optional(),
  terminologyProblems: z.array(z.string()).optional(),
  naturalnessProblems: z.array(z.string()).optional(),
});

export type EvaluatorScoreResponse = z.infer<typeof EvaluatorScoreResponseSchema>;
