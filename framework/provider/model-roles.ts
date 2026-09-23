import type { ModelProvider } from './types';

/**
 * Every point in the system that makes its own model call, named by what it does rather than by
 * "the model" as if there were only one. Production code uses generator/validator/reviser; the
 * offline eval framework additionally uses evaluator/pairwiseJudge. Each resolves independently to
 * its own provider + model, so e.g. a cheap model can validate while an expensive one judges.
 */
export type ModelRole = 'generator' | 'validator' | 'reviser' | 'evaluator' | 'pairwiseJudge';

export const MODEL_ROLES: readonly ModelRole[] = ['generator', 'validator', 'reviser', 'evaluator', 'pairwiseJudge'];

/** One role's configuration as authored in JSON: a provider name plus that provider's model id. */
export interface RoleModelConfig {
  provider: string;
  model: string;
}

/** The full model configuration: every role, each with its own provider/model. */
export type ModelRolesConfig = Record<ModelRole, RoleModelConfig>;

/** A role resolved to an actual, ready-to-call provider instance plus the model id to request from it. */
export interface ResolvedRole {
  provider: ModelProvider;
  /** The provider name this role was configured with (e.g. "anthropic") — not the class name. */
  providerName: string;
  model: string;
}

export type ResolvedModelRoles = Record<ModelRole, ResolvedRole>;

/** Strips provider instances back down to the plain, JSON-serialisable {provider, model} shape — for persisting the effective configuration, not for calling anything. */
export function toModelRolesConfig(resolved: ResolvedModelRoles): ModelRolesConfig {
  const config = {} as ModelRolesConfig;
  for (const role of MODEL_ROLES) {
    config[role] = { provider: resolved[role].providerName, model: resolved[role].model };
  }
  return config;
}
