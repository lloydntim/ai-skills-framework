import { z } from 'zod';

/**
 * Shape the semantic validator's judge call must return (see semantic-validation-prompt.md).
 * Scores are 1 (worst) to 5 (best). This only enforces that shape — parsing JSON is not enough, a
 * response that parses but has the wrong shape (a missing dimension, a string where a number
 * belongs, a score out of range) must fail loudly rather than fall back to a default score.
 */
export const SemanticValidatorResponseSchema = z.object({
  factualGrounding: z.number().int().min(1).max(5),
  jobRelevance: z.number().int().min(1).max(5),
  professionalTone: z.number().int().min(1).max(5),
  specificity: z.number().int().min(1).max(5),
  naturalness: z.number().int().min(1).max(5),
  overall: z.number().int().min(1).max(5),
  /** Absolute problems the judge itself spotted (an invented employer, an upgraded ownership claim, ...). */
  hardGuardrailFailures: z.array(z.string()),
});

export type SemanticValidatorResponse = z.infer<typeof SemanticValidatorResponseSchema>;
