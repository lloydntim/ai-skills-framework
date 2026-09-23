import { MODEL_ROLES, type ResolvedModelRoles } from '../provider/model-roles';
import type { ModelProvider } from '../provider/types';

/**
 * Builds a ResolvedModelRoles where every role points at the same fake provider/model — for tests
 * that don't care about per-role differentiation and just need something to pass where the real
 * pipeline now expects resolved roles instead of a single provider.
 */
export function makeUniformRoles(
  provider: ModelProvider,
  model = 'fake-model',
  providerName = 'fake'
): ResolvedModelRoles {
  const roles = {} as ResolvedModelRoles;
  for (const role of MODEL_ROLES) {
    roles[role] = { provider, providerName, model };
  }
  return roles;
}
