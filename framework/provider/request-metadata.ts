/**
 * Describes *what a request was for*, so token usage can be attributed to a logical step rather
 * than appearing as one undifferentiated total. Carried on GenerationRequest and ignored by
 * providers — attaching it changes nothing about the call that is made.
 */

export type RequestType =
  | 'initial-generation'
  | 'semantic-validation'
  | 'revision'
  | 'revalidation'
  | 'evaluator'
  | 'pairwise-judge'
  /**
   * A request that reached a provider with no metadata attached. It exists so a call site added
   * later without instrumentation shows up as an unattributed row in the report instead of having
   * its cost silently vanish from the totals.
   */
  | 'unclassified';

export const REQUEST_TYPES: readonly RequestType[] = [
  'initial-generation',
  'semantic-validation',
  'revision',
  'revalidation',
  'evaluator',
  'pairwise-judge',
  'unclassified',
];

/** The large reusable blocks a prompt is assembled from. */
export type PromptComponent =
  | 'skill'
  | 'baseline-prompt'
  | 'validation-rubric'
  | 'evaluator-rubric'
  | 'pairwise-rubric'
  | 'task-instructions'
  | 'case-input'
  | 'previous-output'
  | 'candidate-outputs';

export interface PromptComponentSize {
  component: PromptComponent;
  /**
   * Characters, NOT tokens.
   *
   * No local tokenizer is available in this project, and the provider reports usage only for a whole
   * request — never per section. Splitting a request's token count across its components would mean
   * inventing numbers, so this records the one thing that can be measured exactly. Characters are a
   * rough guide to relative size for deciding what to shorten; they are not a token count and must
   * never be presented as one.
   */
  chars: number;
}

export interface RequestMetadata {
  requestType: RequestType;
  components?: PromptComponentSize[];
}
