import fs from 'node:fs';
import { resolveModelRoles, type ProviderFactory } from './registry';
import type { ResolvedModelRoles } from './model-roles';

/**
 * Reads and validates a skill's model-role configuration from disk. The path is always passed in:
 * the framework does not know where a skill keeps its config. Pass a different path (e.g. via a
 * script's `--models-config=` flag) to run the exact same code against a different provider/model
 * matrix, with no source change.
 */
export function loadRawModelRolesConfig(configPath: string): unknown {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Model role configuration file not found at ${configPath}`);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

/** `factories` defaults to the real provider registry; pass a map of fakes in tests. */
export function loadModelRoles(
  configPath: string,
  factories?: Record<string, ProviderFactory>
): ResolvedModelRoles {
  return resolveModelRoles(loadRawModelRolesConfig(configPath), factories);
}
