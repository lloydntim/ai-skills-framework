import { z } from 'zod';

/**
 * Shape the semantic validator's judge call must return (see validation-prompt.md). Scores are
 * 1 (worst) to 5 (best), matching the rubric's own scale — this only enforces that shape, it does
 * not change what counts as a pass.
 */
export const SemanticValidatorResponseSchema = z.object({
  faithfulness: z.number().int().min(1).max(5),
  naturalness: z.number().int().min(1).max(5),
  cvQuality: z.number().int().min(1).max(5),
  terminology: z.number().int().min(1).max(5),
  unsupportedClaims: z.array(z.string()),
  hardGuardrailFailures: z.array(z.string()),
});

export type SemanticValidatorResponse = z.infer<typeof SemanticValidatorResponseSchema>;
