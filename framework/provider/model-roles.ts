import type { RoleRuntimeConfig } from './role-runtime';
import type { ModelProvider } from './types';

/**
 * Every point in the system that makes its own model call, named by what it does rather than by
 * "the model" as if there were only one. Production code uses generator/validator/reviser; the
 * offline eval framework additionally uses evaluator/pairwiseJudge. Each resolves independently to
 * its own provider + model, so e.g. a cheap model can validate while an expensive one judges.
 */
export type ModelRole = 'generator' | 'validator' | 'reviser' | 'evaluator' | 'pairwiseJudge';

export const MODEL_ROLES: readonly ModelRole[] = ['generator', 'validator', 'reviser', 'evaluator', 'pairwiseJudge'];

/**
 * One role's configuration as authored in JSON: a provider name, that provider's model id, and
 * optionally how that role should be run. The runtime fields are the extension point for
 * role-specific behaviour — they are deliberately here, next to the model, and not on any skill
 * contract, because how hard a role thinks is a property of the role and its model, not of the task
 * a skill is doing. Both are optional; an absent field takes that role's framework default from
 * role-runtime.ts.
 */
export interface RoleModelConfig {
  provider: string;
  model: string;
  reasoning?: RoleRuntimeConfig['reasoning'];
  maxOutputTokens?: number;
}

/** The full model configuration: every role, each with its own provider/model. */
export type ModelRolesConfig = Record<ModelRole, RoleModelConfig>;

/** A role resolved to an actual, ready-to-call provider instance plus the model id to request from it. */
export interface ResolvedRole {
  provider: ModelProvider;
  /** The provider name this role was configured with (e.g. "anthropic") — not the class name. */
  providerName: string;
  model: string;
  /**
   * The role's runtime settings with every default already filled in. `provider` above has them
   * applied to it already (see RoleRuntimeProvider), so this copy is for *recording* what a run
   * used, not for a caller to re-apply.
   */
  runtime: RoleRuntimeConfig;
}

export type ResolvedModelRoles = Record<ModelRole, ResolvedRole>;

/**
 * Strips provider instances back down to the plain, JSON-serialisable shape — for persisting the
 * effective configuration, not for calling anything.
 *
 * It writes the runtime fields out explicitly even when the authored config left them to the
 * default, because this is what a saved run records: a result has to say how much the model was
 * asked to think, not merely that nothing was said about it. That does mean this is not a
 * character-for-character round trip of a config that omitted them — by design.
 */
export function toModelRolesConfig(resolved: ResolvedModelRoles): ModelRolesConfig {
  const config = {} as ModelRolesConfig;
  for (const role of MODEL_ROLES) {
    const { providerName, model, runtime } = resolved[role];
    config[role] = { provider: providerName, model, reasoning: runtime.reasoning, maxOutputTokens: runtime.maxOutputTokens };
  }
  return config;
}
