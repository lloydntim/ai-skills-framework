import { describe, expect, it } from 'vitest';
import { ABSOLUTE_MAX_REVISIONS, DEFAULT_RUNTIME_SETTINGS, resolveSettings } from './config';
import { RuntimeFailure } from './failure';

describe('resolveSettings', () => {
  it('returns the defaults when nothing overrides them', () => {
    expect(resolveSettings()).toEqual(DEFAULT_RUNTIME_SETTINGS);
  });

  it('has no budget limit by default, but always bounds revisions', () => {
    expect(DEFAULT_RUNTIME_SETTINGS.budget).toEqual({});
    expect(DEFAULT_RUNTIME_SETTINGS.execution.maxRevisions).toBeGreaterThanOrEqual(0);
  });

  it('applies skill over defaults and run options over the skill, field by field', () => {
    const settings = resolveSettings({
      skill: { execution: { maxRevisions: 5 }, budget: { maxCostUsd: 0.5, maxTokens: 10_000 } },
      run: { budget: { maxCostUsd: 0.1 } },
    });
    expect(settings.execution.maxRevisions).toBe(5); // from the skill
    expect(settings.budget).toEqual({ maxCostUsd: 0.1, maxTokens: 10_000 }); // run wins per field, skill keeps the rest
    expect(settings.validation.enabled).toBe(true); // untouched default
    expect(settings.tracing.enabled).toBe(true);
  });

  it('lets a run turn validation off without touching anything else', () => {
    const settings = resolveSettings({ skill: { execution: { maxRevisions: 4 } }, run: { validation: { enabled: false } } });
    expect(settings.validation.enabled).toBe(false);
    expect(settings.execution.maxRevisions).toBe(4);
  });

  it('does not mutate the defaults', () => {
    resolveSettings({ skill: { budget: { maxTokens: 1 } } });
    expect(DEFAULT_RUNTIME_SETTINGS.budget).toEqual({});
  });

  it.each([
    ['an unknown key', { execution: { maxRetries: 2 } }],
    ['a negative revision count', { execution: { maxRevisions: -1 } }],
    ['a fractional revision count', { execution: { maxRevisions: 1.5 } }],
    ['a zero cost limit', { budget: { maxCostUsd: 0 } }],
    ['a string where a number belongs', { budget: { maxTokens: '100' } }],
  ])('rejects %s as a CONFIGURATION_ERROR naming the layer', (_name, bad) => {
    for (const layer of ['skill', 'run'] as const) {
      try {
        resolveSettings({ [layer]: bad });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeFailure);
        expect((err as RuntimeFailure).kind).toBe('CONFIGURATION_ERROR');
        expect((err as RuntimeFailure).message).toContain(layer === 'skill' ? 'skill' : 'run options');
      }
    }
  });
});

describe('the revision ceiling', () => {
  it('is the runtime\'s own safety policy, and no default exceeds it', () => {
    expect(ABSOLUTE_MAX_REVISIONS).toBe(10);
    expect(DEFAULT_RUNTIME_SETTINGS.execution.maxRevisions).toBeLessThanOrEqual(ABSOLUTE_MAX_REVISIONS);
  });

  it('allows a skill or a run to configure exactly the ceiling', () => {
    expect(resolveSettings({ skill: { execution: { maxRevisions: ABSOLUTE_MAX_REVISIONS } } }).execution.maxRevisions).toBe(ABSOLUTE_MAX_REVISIONS);
    expect(resolveSettings({ run: { execution: { maxRevisions: ABSOLUTE_MAX_REVISIONS } } }).execution.maxRevisions).toBe(ABSOLUTE_MAX_REVISIONS);
  });

  it.each([
    ['skill', 'skill'],
    ['run', 'run options'],
  ] as const)('refuses more than the ceiling from the %s layer, and says it is a runtime limit', (layer, named) => {
    try {
      resolveSettings({ [layer]: { execution: { maxRevisions: ABSOLUTE_MAX_REVISIONS + 1 } } });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeFailure);
      expect((err as RuntimeFailure).kind).toBe('CONFIGURATION_ERROR');
      expect((err as RuntimeFailure).message).toContain(named);
      expect((err as RuntimeFailure).message).toMatch(/runtime.*ceiling.*10/i);
    }
  });

  it('has no way to ask for unlimited revisions', () => {
    expect(() => resolveSettings({ run: { execution: { maxRevisions: Infinity } } })).toThrow(RuntimeFailure);
  });
});
