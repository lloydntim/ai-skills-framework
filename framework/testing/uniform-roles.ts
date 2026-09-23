import { MODEL_ROLES, type ResolvedModelRoles } from '../provider/model-roles';
import { DEFAULT_ROLE_RUNTIME } from '../provider/role-runtime';
import type { ModelProvider } from '../provider/types';

/**
 * Builds a ResolvedModelRoles where every role points at the same fake provider/model — for tests
 * that don't care about per-role differentiation and just need something to pass where the real
 * pipeline now expects resolved roles instead of a single provider.
 *
 * The fake provider is handed over unwrapped, unlike a role resolved from real configuration: a
 * pipeline test asserting on what a call site sent should see exactly that, not the role runtime's
 * adjustments on top of it. `runtime` still carries the real defaults, so anything reading the
 * effective configuration off a role sees what production would.
 */
export function makeUniformRoles(
  provider: ModelProvider,
  model = 'fake-model',
  providerName = 'fake'
): ResolvedModelRoles {
  const roles = {} as ResolvedModelRoles;
  for (const role of MODEL_ROLES) {
    roles[role] = { provider, providerName, model, runtime: { ...DEFAULT_ROLE_RUNTIME[role] } };
  }
  return roles;
}
