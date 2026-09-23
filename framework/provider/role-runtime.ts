import type { ModelRole } from './model-roles';
import type { GenerationRequest, GenerationResult, ModelProvider } from './types';

/**
 * How much reasoning a role is asked to do, as a provider-neutral ladder from "none" up to "max".
 *
 * It is deliberately not an Anthropic field. A skill says how hard the job is; each provider
 * decides what that means on the wire — for Anthropic, adaptive thinking plus
 * `output_config.effort` on the models that take it, and a thinking budget on the ones that do not
 * (see anthropic-provider.ts). A second provider maps the same ladder onto its own controls
 * without a skill changing.
 *
 * "none" asks for no reasoning at all. It exists as a deliberate, per-role opt-out, and is never
 * the framework default: on Claude Opus 5 turning thinking off is documented to make the model
 * occasionally write a tool call into visible text and to leak `<thinking>` tags into the answer,
 * so the supported way to spend less on reasoning is a lower rung of this ladder, not "none".
 */
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const REASONING_EFFORTS: readonly ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * One role's runtime behaviour, resolved: both fields are always present, so nothing downstream has
 * to re-apply a default and no two places can disagree about what the default was.
 */
export interface RoleRuntimeConfig {
  reasoning: ReasoningEffort;
  /**
   * Output budget for one call, covering reasoning *and* the visible answer — the model spends this
   * on both, so a budget sized only for the answer is the failure this field exists to prevent.
   */
  maxOutputTokens: number;
}

/**
 * Hard bounds on an authored budget.
 *
 * The ceiling is not the models' own limit (Sonnet 5 and Opus 5 accept up to 128,000): it is the
 * largest budget this provider can honestly ask for, because it makes one non-streaming request and
 * a budget that large needs streaming to stay under the HTTP timeout. Accepting a number the
 * request cannot actually spend would be a configuration that silently means something else.
 */
export const MAX_ALLOWED_OUTPUT_TOKENS = 64_000;
export const MIN_ALLOWED_OUTPUT_TOKENS = 256;

/**
 * The framework's role defaults, chosen from what each role is actually asked to do rather than
 * from an assumption that scoring is always cheaper than writing. The reasoning behind each is in
 * docs/ARCHITECTURE.md ("Runtime configuration"); in short:
 *
 * - generator/reviser produce the deliverable under many hard constraints from a large input, and
 *   the reviser additionally has to reconcile a list of failures, so neither is asked to think less
 *   than the model would choose on its own ("high" is also the provider's own default effort).
 * - validator/evaluator/pairwiseJudge score against a fixed rubric, but that rubric makes them
 *   trace every claim back to the source — a comparison, not a lookup — so they sit one rung down
 *   at "medium" rather than at "low". "low" is the tuning target once a paid run shows headroom;
 *   it is not something to assume for free.
 *
 * Budgets follow the same principle: reliable output first. 16,000 is the largest budget a single
 * non-streaming request can comfortably finish within the SDK's timeout, and the scoring roles get
 * half of that because their visible answer is a small fixed JSON object — what they need room for
 * is the reasoning in front of it, not the answer.
 */
export const DEFAULT_ROLE_RUNTIME: Record<ModelRole, RoleRuntimeConfig> = {
  generator: { reasoning: 'high', maxOutputTokens: 16_000 },
  reviser: { reasoning: 'high', maxOutputTokens: 16_000 },
  validator: { reasoning: 'medium', maxOutputTokens: 8_000 },
  evaluator: { reasoning: 'medium', maxOutputTokens: 8_000 },
  pairwiseJudge: { reasoning: 'medium', maxOutputTokens: 8_000 },
};

/** Thrown for a runtime setting that is present but not usable: an unknown rung, or a budget out of range. */
export class RoleRuntimeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoleRuntimeConfigError';
  }
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && (REASONING_EFFORTS as readonly string[]).includes(value);
}

/**
 * Reads the optional `reasoning` / `maxOutputTokens` fields off one authored role entry, falling
 * back to `defaults` for whichever is absent. `roleName` only names the role in error messages, so
 * this also serves a caller whose roles are not `ModelRole`s (the skill-framework advisor).
 *
 * Absent means "use the default", which is a real choice and is recorded as such. A *present* but
 * wrong value is always an error — never quietly corrected to the default — because a typo'd
 * effort rung that silently became "high" is exactly the kind of thing a run would later be
 * attributed to.
 */
export function parseRoleRuntime(
  roleName: string,
  entry: Record<string, unknown>,
  defaults: RoleRuntimeConfig
): RoleRuntimeConfig {
  let reasoning = defaults.reasoning;
  if (entry.reasoning !== undefined) {
    if (!isReasoningEffort(entry.reasoning)) {
      throw new RoleRuntimeConfigError(
        `Model role "${roleName}" has an unknown "reasoning" value ${JSON.stringify(entry.reasoning)}. ` +
          `Valid values: ${REASONING_EFFORTS.join(', ')}.`
      );
    }
    reasoning = entry.reasoning;
  }

  let maxOutputTokens = defaults.maxOutputTokens;
  if (entry.maxOutputTokens !== undefined) {
    const value = entry.maxOutputTokens;
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new RoleRuntimeConfigError(
        `Model role "${roleName}" has a non-integer "maxOutputTokens" value ${JSON.stringify(value)}.`
      );
    }
    if (value < MIN_ALLOWED_OUTPUT_TOKENS || value > MAX_ALLOWED_OUTPUT_TOKENS) {
      throw new RoleRuntimeConfigError(
        `Model role "${roleName}" has "maxOutputTokens" ${value}, outside the allowed range ` +
          `${MIN_ALLOWED_OUTPUT_TOKENS}-${MAX_ALLOWED_OUTPUT_TOKENS}. A budget below the minimum cannot fit ` +
          `reasoning and an answer; one above the maximum needs a streaming request, which this provider does not make.`
      );
    }
    maxOutputTokens = value;
  }

  return { reasoning, maxOutputTokens };
}

/**
 * Applies one role's runtime configuration to every request passing through it, so no call site has
 * to know that reasoning exists. Wraps the shared provider instance per role, exactly as
 * InstrumentingProvider does, so two roles on the same provider still get their own settings.
 *
 * `reasoning` is set unconditionally: it is a property of the role, and there is no call site in
 * this repository that is better placed to choose it.
 *
 * `maxOutputTokens` is a **floor**, not an override. A call site that asks for more than the role's
 * budget genuinely needs more (it is producing something longer), and lowering it would reintroduce
 * the bug this exists to fix; a call site asking for less is nearly always a number written before
 * reasoning was configured, and raising it costs nothing — `max_tokens` is a ceiling, not an
 * allocation, so an unused budget is not billed.
 */
export class RoleRuntimeProvider implements ModelProvider {
  constructor(
    /** The shared, unwrapped provider underneath. Public so a caller can tell two roles apart from two clients. */
    readonly inner: ModelProvider,
    readonly runtime: RoleRuntimeConfig
  ) {}

  generate(request: GenerationRequest): Promise<GenerationResult> {
    return this.inner.generate({
      ...request,
      reasoning: this.runtime.reasoning,
      maxOutputTokens: Math.max(request.maxOutputTokens ?? 0, this.runtime.maxOutputTokens),
    });
  }
}
