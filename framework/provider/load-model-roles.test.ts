import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadModelRoles, loadRawModelRolesConfig } from './load-model-roles';
import { MODEL_ROLES } from './model-roles';
import type { GenerationRequest, GenerationResult, ModelProvider } from './types';

class FakeProvider implements ModelProvider {
  async generate(_request: GenerationRequest): Promise<GenerationResult> {
    throw new Error('FakeProvider.generate should never be called by these tests');
  }
}

const FAKE_FACTORIES = { anthropic: () => new FakeProvider() };

function writeConfig(config: unknown): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'models-')), 'models.json');
  fs.writeFileSync(file, JSON.stringify(config));
  return file;
}

describe('loadRawModelRolesConfig', () => {
  it('throws a clear error for a path that does not exist', () => {
    expect(() => loadRawModelRolesConfig('/nonexistent/path/models.json')).toThrow(/not found/);
  });
});

describe('loadModelRoles', () => {
  it('resolves every role from a config file', () => {
    const config = Object.fromEntries(MODEL_ROLES.map((r) => [r, { provider: 'anthropic', model: 'm' }]));
    const roles = loadModelRoles(writeConfig(config), FAKE_FACTORIES);
    for (const role of MODEL_ROLES) expect(roles[role].model).toBe('m');
  });

  it('fails when a role is missing', () => {
    const config = { generator: { provider: 'anthropic', model: 'm' } };
    expect(() => loadModelRoles(writeConfig(config), FAKE_FACTORIES)).toThrow(/missing/);
  });
});
