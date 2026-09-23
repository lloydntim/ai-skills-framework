import { describe, expect, it } from 'vitest';
import { ModelConfigError, resolveModelRoles } from './registry';
import { toModelRolesConfig } from './model-roles';
import type { GenerationRequest, GenerationResult, ModelProvider } from './types';

/** A ModelProvider that makes no network/API calls at all — for testing config resolution only. */
class FakeProvider implements ModelProvider {
  constructor(public readonly label: string) {}
  async generate(_request: GenerationRequest): Promise<GenerationResult> {
    throw new Error('FakeProvider.generate should never be called by these tests');
  }
}

const FAKE_FACTORIES = {
  fake: () => new FakeProvider('fake'),
  other: () => new FakeProvider('other'),
};

const VALID_CONFIG = {
  generator: { provider: 'fake', model: 'fake-small' },
  validator: { provider: 'fake', model: 'fake-small' },
  reviser: { provider: 'fake', model: 'fake-small' },
  evaluator: { provider: 'fake', model: 'fake-large' },
  pairwiseJudge: { provider: 'fake', model: 'fake-large' },
};

describe('resolveModelRoles — valid configuration', () => {
  it('resolves every role to a provider instance and its configured model', () => {
    const roles = resolveModelRoles(VALID_CONFIG, FAKE_FACTORIES);

    expect(roles.generator.model).toBe('fake-small');
    expect(roles.validator.model).toBe('fake-small');
    expect(roles.reviser.model).toBe('fake-small');
    expect(roles.evaluator.model).toBe('fake-large');
    expect(roles.pairwiseJudge.model).toBe('fake-large');
    expect(roles.generator.providerName).toBe('fake');
    expect(roles.generator.provider).toBeInstanceOf(FakeProvider);
  });

  it('shares one provider instance across every role that names the same provider', () => {
    const roles = resolveModelRoles(VALID_CONFIG, FAKE_FACTORIES);

    // All 5 roles say "fake" in VALID_CONFIG — this must not construct 5 separate clients.
    expect(roles.generator.provider).toBe(roles.validator.provider);
    expect(roles.generator.provider).toBe(roles.evaluator.provider);
    expect(roles.generator.provider).toBe(roles.pairwiseJudge.provider);
  });

  it('resolves different roles to different provider instances when they name different providers', () => {
    const mixed = { ...VALID_CONFIG, evaluator: { provider: 'other', model: 'other-model' } };
    const roles = resolveModelRoles(mixed, FAKE_FACTORIES);

    expect(roles.generator.provider).not.toBe(roles.evaluator.provider);
    expect(roles.evaluator.providerName).toBe('other');
  });

  it('round-trips through toModelRolesConfig back to the plain provider/model shape', () => {
    const roles = resolveModelRoles(VALID_CONFIG, FAKE_FACTORIES);
    expect(toModelRolesConfig(roles)).toEqual(VALID_CONFIG);
  });
});

describe('resolveModelRoles — fails clearly on missing roles', () => {
  it('throws ModelConfigError naming the specific missing role', () => {
    const { reviser, ...withoutReviser } = VALID_CONFIG;
    void reviser;

    expect(() => resolveModelRoles(withoutReviser, FAKE_FACTORIES)).toThrow(ModelConfigError);
    expect(() => resolveModelRoles(withoutReviser, FAKE_FACTORIES)).toThrow(/reviser/);
  });

  it('names every missing role when more than one is absent', () => {
    const { reviser, evaluator, ...partial } = VALID_CONFIG;
    void reviser;
    void evaluator;

    expect(() => resolveModelRoles(partial, FAKE_FACTORIES)).toThrow(/reviser/);
    expect(() => resolveModelRoles(partial, FAKE_FACTORIES)).toThrow(/evaluator/);
  });
});

describe('resolveModelRoles — fails clearly on an unknown provider', () => {
  it('throws ModelConfigError naming the unknown provider and the role that specified it', () => {
    const config = { ...VALID_CONFIG, validator: { provider: 'openai', model: 'gpt-5' } };

    expect(() => resolveModelRoles(config, FAKE_FACTORIES)).toThrow(ModelConfigError);
    expect(() => resolveModelRoles(config, FAKE_FACTORIES)).toThrow(/validator/);
    expect(() => resolveModelRoles(config, FAKE_FACTORIES)).toThrow(/openai/);
  });

  it('lists the known providers in the error to help fix the typo', () => {
    const config = { ...VALID_CONFIG, generator: { provider: 'anthropik', model: 'x' } };

    expect(() => resolveModelRoles(config, FAKE_FACTORIES)).toThrow(/fake/);
  });
});

describe('resolveModelRoles — fails clearly on invalid configuration shape', () => {
  it('rejects a non-object root', () => {
    expect(() => resolveModelRoles('not an object', FAKE_FACTORIES)).toThrow(ModelConfigError);
    expect(() => resolveModelRoles(null, FAKE_FACTORIES)).toThrow(ModelConfigError);
    expect(() => resolveModelRoles(['a', 'b'], FAKE_FACTORIES)).toThrow(ModelConfigError);
  });

  it('rejects a role entry that is not an object', () => {
    const config = { ...VALID_CONFIG, generator: 'fake-small' };
    expect(() => resolveModelRoles(config, FAKE_FACTORIES)).toThrow(/generator/);
  });

  it('rejects a role entry missing "model"', () => {
    const config = { ...VALID_CONFIG, validator: { provider: 'fake' } };
    expect(() => resolveModelRoles(config, FAKE_FACTORIES)).toThrow(/validator/);
    expect(() => resolveModelRoles(config, FAKE_FACTORIES)).toThrow(/"model"/);
  });

  it('rejects a role entry missing "provider"', () => {
    const config = { ...VALID_CONFIG, evaluator: { model: 'fake-large' } };
    expect(() => resolveModelRoles(config, FAKE_FACTORIES)).toThrow(/evaluator/);
    expect(() => resolveModelRoles(config, FAKE_FACTORIES)).toThrow(/"provider"/);
  });

  it('rejects an empty-string model or provider rather than accepting it', () => {
    const emptyModel = { ...VALID_CONFIG, generator: { provider: 'fake', model: '' } };
    const emptyProvider = { ...VALID_CONFIG, generator: { provider: '', model: 'fake-small' } };

    expect(() => resolveModelRoles(emptyModel, FAKE_FACTORIES)).toThrow(ModelConfigError);
    expect(() => resolveModelRoles(emptyProvider, FAKE_FACTORIES)).toThrow(ModelConfigError);
  });
});
