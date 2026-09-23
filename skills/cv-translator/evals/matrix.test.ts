import { describe, expect, it } from 'vitest';
import {
  buildMatrix,
  crossModelPairs,
  findEvaluatorMismatches,
  MatrixConfigError,
  parseMatrixConfig,
} from './matrix';

const twoConfigs = {
  configurations: [
    { label: 'cheap', modelsConfig: 'config/models.haiku.json' },
    { label: 'primary', modelsConfig: 'config/models.json' },
  ],
  variants: ['A', 'B'],
};

describe('parseMatrixConfig', () => {
  it('accepts a two-configuration matrix and keeps the configured order', () => {
    const config = parseMatrixConfig(twoConfigs);

    expect(config.configurations.map((c) => c.label)).toEqual(['cheap', 'primary']);
    expect(config.variants).toEqual(['A', 'B']);
  });

  it('defaults the skill comparison to the baseline and single-shot skill variants', () => {
    const config = parseMatrixConfig(twoConfigs);

    expect(config.skillComparison).toEqual({ withoutSkill: 'A', withSkill: 'B' });
  });

  it('accepts an explicit skill comparison against the self-reviewing pipeline', () => {
    const config = parseMatrixConfig({
      ...twoConfigs,
      variants: ['A', 'C'],
      skillComparison: { withoutSkill: 'A', withSkill: 'C' },
    });

    expect(config.skillComparison).toEqual({ withoutSkill: 'A', withSkill: 'C' });
  });

  it('rejects a configuration that is not an object', () => {
    expect(() => parseMatrixConfig([])).toThrow(MatrixConfigError);
  });

  it('rejects an empty configuration list', () => {
    expect(() => parseMatrixConfig({ ...twoConfigs, configurations: [] })).toThrow(/non-empty "configurations"/);
  });

  it('rejects a configuration with no label', () => {
    expect(() =>
      parseMatrixConfig({ ...twoConfigs, configurations: [{ modelsConfig: 'config/models.json' }] })
    ).toThrow(/non-empty "label"/);
  });

  it('rejects a configuration with no models config path', () => {
    expect(() => parseMatrixConfig({ ...twoConfigs, configurations: [{ label: 'cheap' }] })).toThrow(
      /non-empty "modelsConfig" path/
    );
  });

  it('rejects duplicate configuration labels, which would collide as summary rows', () => {
    expect(() =>
      parseMatrixConfig({
        ...twoConfigs,
        configurations: [
          { label: 'cheap', modelsConfig: 'a.json' },
          { label: 'cheap', modelsConfig: 'b.json' },
        ],
      })
    ).toThrow(/Duplicate configuration label "cheap"/);
  });

  it('rejects an empty variant list', () => {
    expect(() => parseMatrixConfig({ ...twoConfigs, variants: [] })).toThrow(/non-empty "variants"/);
  });

  it('rejects an unknown variant', () => {
    expect(() => parseMatrixConfig({ ...twoConfigs, variants: ['A', 'Z'] })).toThrow(/Unknown variant "Z"/);
  });

  it('rejects a variant listed twice', () => {
    expect(() => parseMatrixConfig({ ...twoConfigs, variants: ['A', 'A'] })).toThrow(/listed more than once/);
  });

  it('leaves the skill comparison unset when the variants cannot form a pair, for a model-only run', () => {
    const config = parseMatrixConfig({ ...twoConfigs, variants: ['A'] });

    expect(config.skillComparison).toBeNull();
    expect(config.variants).toEqual(['A']);
  });

  it('leaves the skill comparison unset rather than guessing a non-default pair', () => {
    // A and C could in principle be compared, but which pair was meant is the author's decision,
    // not something to infer — so it stays unset until named explicitly.
    expect(parseMatrixConfig({ ...twoConfigs, variants: ['A', 'C'] }).skillComparison).toBeNull();
  });

  it('still rejects an explicitly named pair that cannot run', () => {
    expect(() =>
      parseMatrixConfig({ ...twoConfigs, variants: ['A'], skillComparison: { withoutSkill: 'A', withSkill: 'B' } })
    ).toThrow(/not in variants \[A\]/);
  });

  it('rejects a skill comparison of a variant against itself', () => {
    expect(() =>
      parseMatrixConfig({ ...twoConfigs, skillComparison: { withoutSkill: 'B', withSkill: 'B' } })
    ).toThrow(/two different variants/);
  });

  it('rejects a skill comparison naming a variant that is never run', () => {
    expect(() =>
      parseMatrixConfig({ ...twoConfigs, variants: ['A', 'B'], skillComparison: { withoutSkill: 'A', withSkill: 'C' } })
    ).toThrow(/not in variants \[A, B\]/);
  });

  it('rejects a without-skill side that actually loads the skill', () => {
    expect(() =>
      parseMatrixConfig({ ...twoConfigs, variants: ['B', 'C'], skillComparison: { withoutSkill: 'B', withSkill: 'C' } })
    ).toThrow(/must be a baseline variant/);
  });

  it('rejects a skill comparison with the pair the wrong way round', () => {
    expect(() =>
      parseMatrixConfig({ ...twoConfigs, skillComparison: { withoutSkill: 'B', withSkill: 'A' } })
    ).toThrow(/must be a baseline variant/);
  });
});

describe('buildMatrix', () => {
  it('expands configurations against variants, configuration-major', () => {
    const entries = buildMatrix(parseMatrixConfig(twoConfigs));

    expect(entries.map((e) => `${e.configLabel}/${e.variant}`)).toEqual([
      'cheap/A',
      'cheap/B',
      'primary/A',
      'primary/B',
    ]);
  });

  it('produces exactly the four requested comparison cells', () => {
    const entries = buildMatrix(parseMatrixConfig(twoConfigs));

    expect(entries).toHaveLength(4);
    expect(entries).toEqual([
      { configLabel: 'cheap', modelsConfigPath: 'config/models.haiku.json', variant: 'A', skillMode: 'no-skill' },
      { configLabel: 'cheap', modelsConfigPath: 'config/models.haiku.json', variant: 'B', skillMode: 'skill' },
      { configLabel: 'primary', modelsConfigPath: 'config/models.json', variant: 'A', skillMode: 'no-skill' },
      { configLabel: 'primary', modelsConfigPath: 'config/models.json', variant: 'B', skillMode: 'skill' },
    ]);
  });

  it('derives the skill mode from the variant rather than from configuration', () => {
    const entries = buildMatrix(
      parseMatrixConfig({ ...twoConfigs, variants: ['A', 'C'], skillComparison: { withoutSkill: 'A', withSkill: 'C' } })
    );

    expect(entries.map((e) => e.skillMode)).toEqual([
      'no-skill',
      'skill+self-review',
      'no-skill',
      'skill+self-review',
    ]);
  });

  it('scales to a third configuration without any change to the matrix code', () => {
    const entries = buildMatrix(
      parseMatrixConfig({
        ...twoConfigs,
        configurations: [...twoConfigs.configurations, { label: 'frontier', modelsConfig: 'config/models.opus.json' }],
      })
    );

    expect(entries).toHaveLength(6);
    expect(entries.map((e) => e.configLabel)).toEqual(['cheap', 'cheap', 'primary', 'primary', 'frontier', 'frontier']);
  });
});

describe('crossModelPairs', () => {
  const skillComparison = { withoutSkill: 'A', withSkill: 'B' } as const;

  it('pairs the cheaper configuration with skill against the stronger one without it', () => {
    expect(crossModelPairs(['cheap', 'primary'], skillComparison)).toEqual([
      { cheaperLabel: 'cheap', cheaperVariant: 'B', strongerLabel: 'primary', strongerVariant: 'A' },
    ]);
  });

  it('produces no pair for a single configuration', () => {
    expect(crossModelPairs(['primary'], skillComparison)).toEqual([]);
  });

  it('produces no pair when there is no skill comparison to anchor it', () => {
    expect(crossModelPairs(['cheap', 'primary'], null)).toEqual([]);
  });

  it('pairs every configuration against each one listed after it', () => {
    const pairs = crossModelPairs(['cheap', 'mid', 'primary'], skillComparison);

    expect(pairs.map((p) => `${p.cheaperLabel}+skill vs ${p.strongerLabel}`)).toEqual([
      'cheap+skill vs mid',
      'cheap+skill vs primary',
      'mid+skill vs primary',
    ]);
  });
});

describe('findEvaluatorMismatches', () => {
  const sonnet = { provider: 'anthropic', model: 'claude-sonnet-5' };

  it('reports nothing when every configuration shares one evaluator', () => {
    expect(
      findEvaluatorMismatches([
        { label: 'cheap', evaluator: sonnet },
        { label: 'primary', evaluator: sonnet },
      ])
    ).toEqual([]);
  });

  it('reports nothing for a single configuration', () => {
    expect(findEvaluatorMismatches([{ label: 'primary', evaluator: sonnet }])).toEqual([]);
  });

  it('reports a configuration that judges with a different model', () => {
    const mismatches = findEvaluatorMismatches([
      { label: 'cheap', evaluator: sonnet },
      { label: 'primary', evaluator: { provider: 'anthropic', model: 'claude-opus-5' } },
    ]);

    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toContain('"primary" evaluates with anthropic/claude-opus-5');
    expect(mismatches[0]).toContain('"cheap" evaluates with anthropic/claude-sonnet-5');
  });

  it('reports a configuration that judges with a different provider', () => {
    const mismatches = findEvaluatorMismatches([
      { label: 'cheap', evaluator: sonnet },
      { label: 'primary', evaluator: { provider: 'other', model: 'claude-sonnet-5' } },
    ]);

    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toContain('other/claude-sonnet-5');
  });

  it('reports every mismatching configuration, not just the first', () => {
    const mismatches = findEvaluatorMismatches([
      { label: 'cheap', evaluator: sonnet },
      { label: 'mid', evaluator: { provider: 'anthropic', model: 'claude-opus-5' } },
      { label: 'primary', evaluator: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' } },
    ]);

    expect(mismatches).toHaveLength(2);
  });
});
