import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODEL_ROLES } from '@skills/framework/provider/model-roles';
import { resolveModelRoles } from '@skills/framework/provider/registry';
import type { GenerationRequest, GenerationResult, ModelProvider } from '@skills/framework/provider/types';
import { loadRawModelRolesConfig, MODELS_CONFIG_PATH } from './model-config';

class FakeProvider implements ModelProvider {
  async generate(_request: GenerationRequest): Promise<GenerationResult> {
    throw new Error('never called');
  }
}
const FAKE = { anthropic: () => new FakeProvider() };

describe('config/models.json', () => {
  it('is valid: every role is present with a provider and model', () => {
    const roles = resolveModelRoles(loadRawModelRolesConfig(), FAKE);
    for (const role of MODEL_ROLES) {
      expect(roles[role].providerName).toBe('anthropic');
      expect(roles[role].model.length).toBeGreaterThan(0);
    }
  });
});

describe('config/models.haiku.json', () => {
  it('is valid and keeps the judge on a stronger model than generation', () => {
    const roles = resolveModelRoles(
      loadRawModelRolesConfig(path.join(path.dirname(MODELS_CONFIG_PATH), 'models.haiku.json')),
      FAKE
    );
    expect(roles.generator.model).toContain('haiku');
    expect(roles.evaluator.model).not.toContain('haiku');
    expect(roles.pairwiseJudge.model).not.toContain('haiku');
  });
});
