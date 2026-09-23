/**
 * One place for turning a model's raw text reply into a typed, schema-checked object. Every judge
 * (semantic validator, quality evaluator, pairwise evaluator) returns JSON embedded in prose and
 * gets parsed the same way, so the extraction/parsing/validation steps live here once rather than
 * being copied per call site with slightly different error messages.
 */
import type { z } from 'zod';

/** Thrown when a model's JSON reply does not match the schema it was required to match. */
export class LlmResponseValidationError extends Error {
  constructor(
    public readonly context: string,
    public readonly issues: z.core.$ZodIssue[],
    public readonly rawJson: string,
  ) {
    const detail = issues
      .map((issue) => `${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`)
      .join('; ');
    super(`${context}: response failed schema validation — ${detail}`);
    this.name = 'LlmResponseValidationError';
  }
}

function extractJsonBlock(text: string, context: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`${context} did not return JSON: ${text}`);
  }
  return match[0];
}

/**
 * Extracts the first `{...}` block from `text`, parses it as JSON, and validates it against
 * `schema`. Throws a plain `Error` for text that isn't JSON at all (nothing to validate), and an
 * `LlmResponseValidationError` for JSON that parses but doesn't match the schema — required
 * fields missing, a score out of range, an enum value the schema doesn't allow, or a field of the
 * wrong type. Never fills in or coerces a value the model didn't actually return.
 */
export function parseJsonResponse<Schema extends z.ZodType>(
  text: string,
  schema: Schema,
  context: string,
): z.infer<Schema> {
  const jsonBlock = extractJsonBlock(text, context);

  let candidate: unknown;
  try {
    candidate = JSON.parse(jsonBlock);
  } catch (err) {
    throw new Error(`${context} returned invalid JSON: ${jsonBlock}\nParse error: ${err}`);
  }

  const result = schema.safeParse(candidate);
  if (!result.success) {
    throw new LlmResponseValidationError(context, result.error.issues, jsonBlock);
  }
  return result.data;
}
