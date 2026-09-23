import { AnthropicProvider } from './anthropic-provider';
import { MODEL_ROLES, type ModelRole, type ResolvedModelRoles } from './model-roles';
import type { ModelProvider } from './types';

/** Thrown for any problem in a model-role configuration: missing role, unknown provider, or a malformed entry. */
export class ModelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelConfigError';
  }
}

export type ProviderFactory = () => ModelProvider;

/**
 * The only place a concrete provider class is named. Adding a second provider later (OpenAI,
 * Gemini, ...) is one more entry here — nothing in src/runtime or evals needs to change, since they
 * only ever see the ModelProvider interface via a ResolvedRole.
 */
const DEFAULT_PROVIDER_FACTORIES: Record<string, ProviderFactory> = {
  anthropic: () => new AnthropicProvider(),
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates and resolves a raw (e.g. JSON-loaded) model-role configuration into ready-to-call
 * providers. `factories` defaults to the real provider registry; tests pass their own map (e.g.
 * `{ fake: () => new FakeProvider() }`) so resolution never has to construct a real provider or
 * touch an API key.
 *
 * Providers are instantiated at most once per distinct provider name and shared across every role
 * that names it — resolving 5 roles that all say "anthropic" does not open 5 separate clients.
 */
export function resolveModelRoles(
  raw: unknown,
  factories: Record<string, ProviderFactory> = DEFAULT_PROVIDER_FACTORIES
): ResolvedModelRoles {
  if (!isPlainObject(raw)) {
    throw new ModelConfigError(
      'Model role configuration must be an object mapping each role to { provider, model }.'
    );
  }

  const missingRoles = MODEL_ROLES.filter((role) => !(role in raw));
  if (missingRoles.length > 0) {
    throw new ModelConfigError(
      `Model role configuration is missing: ${missingRoles.join(', ')}. ` +
        `Every role must be configured: ${MODEL_ROLES.join(', ')}.`
    );
  }

  const providerInstances = new Map<string, ModelProvider>();
  const resolved = {} as ResolvedModelRoles;

  for (const role of MODEL_ROLES) {
    resolved[role] = resolveRole(role, raw[role], factories, providerInstances);
  }

  return resolved;
}

function resolveRole(
  role: ModelRole,
  entry: unknown,
  factories: Record<string, ProviderFactory>,
  providerInstances: Map<string, ModelProvider>
) {
  if (!isPlainObject(entry)) {
    throw new ModelConfigError(`Model role "${role}" must be an object with "provider" and "model" strings.`);
  }

  const { provider: providerName, model } = entry;

  if (typeof providerName !== 'string' || providerName.length === 0) {
    throw new ModelConfigError(`Model role "${role}" is missing a valid "provider" string.`);
  }
  if (typeof model !== 'string' || model.length === 0) {
    throw new ModelConfigError(`Model role "${role}" is missing a valid "model" string.`);
  }

  const factory = factories[providerName];
  if (!factory) {
    throw new ModelConfigError(
      `Model role "${role}" specifies unknown provider "${providerName}". ` +
        `Known providers: ${Object.keys(factories).join(', ') || '(none registered)'}.`
    );
  }

  if (!providerInstances.has(providerName)) {
    providerInstances.set(providerName, factory());
  }

  return { provider: providerInstances.get(providerName)!, providerName, model };
}
