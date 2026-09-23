import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODEL_ROLES } from '@skills/framework/provider/model-roles';
import { resolveModelRoles } from '@skills/framework/provider/registry';
import { buildReasoningParams } from '@skills/framework/provider/anthropic-provider';
import type { GenerationRequest, GenerationResult, ModelProvider } from '@skills/framework/provider/types';
import { loadRawModelRolesConfig, MODELS_CONFIG_PATH } from './model-config';

class FakeProvider implements ModelProvider {
  async generate(_request: GenerationRequest): Promise<GenerationResult> {
    throw new Error('never called');
  }
}
const FAKE = { anthropic: () => new FakeProvider() };

const CONFIG_FILES = ['models.json', 'models.haiku.json'];
const configPath = (file: string) => path.join(path.dirname(MODELS_CONFIG_PATH), file);

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

describe('every shipped model configuration is actually callable', () => {
  // The reasoning settings and the model have to agree: claude-haiku-4-5 rejects
  // output_config.effort, and a thinking budget must fit inside the output budget. Getting that
  // pairing wrong is a 400 at the first paid call, so it is checked here for free instead.
  it.each(CONFIG_FILES)('translates every role in %s into request fields the model accepts', (file) => {
    const roles = resolveModelRoles(loadRawModelRolesConfig(configPath(file)), FAKE);
    for (const role of MODEL_ROLES) {
      const { model, runtime } = roles[role];
      expect(() => buildReasoningParams(model, runtime.reasoning, runtime.maxOutputTokens), `${role} (${model})`).not.toThrow();
    }
  });

  it.each(CONFIG_FILES)('gives every role in %s room for reasoning as well as an answer', (file) => {
    const roles = resolveModelRoles(loadRawModelRolesConfig(configPath(file)), FAKE);
    for (const role of MODEL_ROLES) {
      // The budgets that caused the original failure were 2,000 and 4,000.
      expect(roles[role].runtime.maxOutputTokens, role).toBeGreaterThanOrEqual(8000);
      expect(roles[role].runtime.reasoning, role).not.toBe('none');
    }
  });
});
