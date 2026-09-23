import { describe, expect, it } from 'vitest';
import type { DeterministicCheckResult } from '../src/deterministic-checks';
import { MODEL_ROLES, type ModelRole, type ModelRolesConfig, type RoleModelConfig } from '@skills/framework/provider/model-roles';
import type { PricingTable } from '@skills/framework/provider/pricing';
import { formatMatrixReport, summarizeMatrix, type ConfigurationRun } from './matrix-summary';
import type { CaseResult, QualityScore, Variant } from './types';

const PRICING: PricingTable = {
  'cheap-model': { input: 1, output: 2 },
  'primary-model': { input: 10, output: 20 },
};

const SKILL_COMPARISON = { withoutSkill: 'A', withSkill: 'B' } as const;

function quality(overall: number, overrides: Partial<QualityScore> = {}): QualityScore {
  return {
    faithfulness: overall,
    naturalness: overall,
    cvQuality: overall,
    terminology: overall,
    conciseness: overall,
    overall,
    justification: '',
    problems: [],
    missingExpectedFacts: [],
    unsupportedClaims: [],
    seniorityInflationNotes: [],
    terminologyProblems: [],
    naturalnessProblems: [],
    ...overrides,
  };
}

function deterministic(pass: boolean): DeterministicCheckResult {
  return {
    pass,
    missingExactStrings: pass ? [] : ['Northwind Labs'],
    missingTerms: [],
    matchedForbiddenClaims: [],
    matchedForbiddenCharacters: [],
    lengthExceeded: false,
    boldMarkerMismatch: false,
    paragraphBreakMismatch: false,
    repeatedEntryOpeners: [],
  };
}

interface CaseOptions {
  caseId: string;
  variant: Variant;
  score: number;
  inputTokens?: number;
  outputTokens?: number;
  requestCount?: number;
  latencyMs?: number;
  pass?: boolean;
  /** Set to true to model a provider that reported no usage at all for this call. */
  noUsage?: boolean;
}

function caseResult(options: CaseOptions): CaseResult {
  const inputTokens = options.inputTokens ?? 100;
  const outputTokens = options.outputTokens ?? 50;
  return {
    caseId: options.caseId,
    category: 'translation',
    variant: options.variant,
    output: {
      variant: options.variant,
      caseId: options.caseId,
      text: 'output text',
      usage: options.noUsage ? undefined : { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      latencyMs: options.latencyMs,
      requestCount: options.requestCount ?? 1,
    },
    deterministic: deterministic(options.pass ?? true),
    quality: quality(options.score),
  };
}

function rolesFor(model: string, overrides: Partial<Record<ModelRole, RoleModelConfig>> = {}): ModelRolesConfig {
  const roles = {} as ModelRolesConfig;
  for (const role of MODEL_ROLES) {
    roles[role] = overrides[role] ?? { provider: 'anthropic', model };
  }
  // The evaluator is held constant across the matrix in practice; default it so a test changing the
  // generator does not accidentally imply a different judge.
  roles.evaluator = overrides.evaluator ?? { provider: 'anthropic', model: 'primary-model' };
  return roles;
}

/** cheap: A scores 3, B scores 4 and costs more. primary: A scores 4, B scores 4.5. */
function twoConfigurationRuns(): ConfigurationRun[] {
  return [
    {
      label: 'cheap',
      roles: rolesFor('cheap-model'),
      caseResults: [
        caseResult({ caseId: 'c1', variant: 'A', score: 3, inputTokens: 100, outputTokens: 50 }),
        caseResult({ caseId: 'c2', variant: 'A', score: 3, inputTokens: 100, outputTokens: 50 }),
        caseResult({ caseId: 'c1', variant: 'B', score: 4, inputTokens: 400, outputTokens: 60 }),
        caseResult({ caseId: 'c2', variant: 'B', score: 4, inputTokens: 400, outputTokens: 60 }),
      ],
    },
    {
      label: 'primary',
      roles: rolesFor('primary-model'),
      caseResults: [
        caseResult({ caseId: 'c1', variant: 'A', score: 4, inputTokens: 100, outputTokens: 50 }),
        caseResult({ caseId: 'c2', variant: 'A', score: 4, inputTokens: 100, outputTokens: 50 }),
        caseResult({ caseId: 'c1', variant: 'B', score: 4.5, inputTokens: 400, outputTokens: 60 }),
        caseResult({ caseId: 'c2', variant: 'B', score: 4.5, inputTokens: 400, outputTokens: 60 }),
      ],
    },
  ];
}

function summarize(runs: ConfigurationRun[], variants: Variant[] = ['A', 'B']) {
  return summarizeMatrix(runs, variants, SKILL_COMPARISON, PRICING);
}

describe('cells', () => {
  it('produces one cell per configuration and variant, in configuration order', () => {
    const summary = summarize(twoConfigurationRuns());

    expect(summary.cells.map((c) => `${c.configLabel}/${c.variant}`)).toEqual([
      'cheap/A',
      'cheap/B',
      'primary/A',
      'primary/B',
    ]);
    expect(summary.configOrder).toEqual(['cheap', 'primary']);
  });

  it('records the generator model, provider and skill mode for each cell', () => {
    const summary = summarize(twoConfigurationRuns());
    const cheapWithSkill = summary.cells.find((c) => c.configLabel === 'cheap' && c.variant === 'B')!;

    expect(cheapWithSkill.model).toBe('cheap-model');
    expect(cheapWithSkill.provider).toBe('anthropic');
    expect(cheapWithSkill.skillMode).toBe('skill');
    expect(summary.cells.find((c) => c.variant === 'A')!.skillMode).toBe('no-skill');
  });

  it('averages the evaluator scores across the cases in the cell', () => {
    const summary = summarize([
      {
        label: 'cheap',
        roles: rolesFor('cheap-model'),
        caseResults: [
          caseResult({ caseId: 'c1', variant: 'A', score: 3 }),
          caseResult({ caseId: 'c2', variant: 'A', score: 5 }),
        ],
      },
    ]);

    const cell = summary.cells.find((c) => c.variant === 'A')!;
    expect(cell.cases).toBe(2);
    expect(cell.scores.overall).toBe(4);
    expect(cell.scores.faithfulness).toBe(4);
  });

  it('counts the cases whose hard deterministic checks failed, and names them', () => {
    const summary = summarize([
      {
        label: 'cheap',
        roles: rolesFor('cheap-model'),
        caseResults: [
          caseResult({ caseId: 'c1', variant: 'A', score: 4, pass: false }),
          caseResult({ caseId: 'c2', variant: 'A', score: 4, pass: true }),
          caseResult({ caseId: 'c3', variant: 'A', score: 4, pass: false }),
        ],
      },
    ]);

    const cell = summary.cells.find((c) => c.variant === 'A')!;
    expect(cell.deterministicFailures).toBe(2);
    expect(cell.deterministicFailureCaseIds).toEqual(['c1', 'c3']);
  });

  it('totals input tokens, output tokens and request counts', () => {
    const summary = summarize([
      {
        label: 'cheap',
        roles: rolesFor('cheap-model'),
        caseResults: [
          caseResult({ caseId: 'c1', variant: 'C', score: 4, inputTokens: 100, outputTokens: 20, requestCount: 2 }),
          caseResult({ caseId: 'c2', variant: 'C', score: 4, inputTokens: 300, outputTokens: 40, requestCount: 4 }),
        ],
      },
    ], ['C']);

    const cell = summary.cells[0];
    expect(cell.inputTokens).toBe(400);
    expect(cell.outputTokens).toBe(60);
    expect(cell.totalTokens).toBe(460);
    expect(cell.requestCount).toBe(6);
  });

  it('reports latency as null when no case measured it, so unmeasured never reads as zero', () => {
    const summary = summarize([
      {
        label: 'cheap',
        roles: rolesFor('cheap-model'),
        caseResults: [caseResult({ caseId: 'c1', variant: 'A', score: 4 })],
      },
    ], ['A']);

    expect(summary.cells[0].avgLatencyMs).toBeNull();
    expect(summary.cells[0].totalLatencyMs).toBeNull();
  });

  it('averages latency over only the cases that reported one', () => {
    const summary = summarize([
      {
        label: 'cheap',
        roles: rolesFor('cheap-model'),
        caseResults: [
          caseResult({ caseId: 'c1', variant: 'A', score: 4, latencyMs: 1000 }),
          caseResult({ caseId: 'c2', variant: 'A', score: 4, latencyMs: 2000 }),
          caseResult({ caseId: 'c3', variant: 'A', score: 4 }),
        ],
      },
    ], ['A']);

    expect(summary.cells[0].totalLatencyMs).toBe(3000);
    expect(summary.cells[0].avgLatencyMs).toBe(1500);
  });
});

describe('estimated cost', () => {
  it('costs a single-shot variant at the generator model price', () => {
    const summary = summarize(twoConfigurationRuns());
    const cheapBaseline = summary.cells.find((c) => c.configLabel === 'cheap' && c.variant === 'A')!;

    // 2 cases x (100 input @ $1/M + 50 output @ $2/M) = 2 x (0.0001 + 0.0001) = 0.0004
    expect(cheapBaseline.estimatedCost).toBeCloseTo(0.0004, 10);
    expect(cheapBaseline.costUnavailableReason).toBeUndefined();
  });

  it('costs the same tokens higher for the more expensive model', () => {
    const summary = summarize(twoConfigurationRuns());
    const cheap = summary.cells.find((c) => c.configLabel === 'cheap' && c.variant === 'A')!;
    const primary = summary.cells.find((c) => c.configLabel === 'primary' && c.variant === 'A')!;

    expect(primary.estimatedCost).toBeGreaterThan(cheap.estimatedCost!);
  });

  it('reports no cost, with a reason, when the model has no configured price', () => {
    const summary = summarize([
      {
        label: 'unpriced',
        roles: rolesFor('some-new-model'),
        caseResults: [caseResult({ caseId: 'c1', variant: 'A', score: 4 })],
      },
    ], ['A']);

    expect(summary.cells[0].estimatedCost).toBeNull();
    expect(summary.cells[0].costUnavailableReason).toContain('no pricing configured for "some-new-model"');
  });

  it('reports no cost when a case reported no token usage at all', () => {
    const summary = summarize([
      {
        label: 'cheap',
        roles: rolesFor('cheap-model'),
        caseResults: [
          caseResult({ caseId: 'c1', variant: 'A', score: 4 }),
          caseResult({ caseId: 'c2', variant: 'A', score: 4, noUsage: true }),
        ],
      },
    ], ['A']);

    expect(summary.cells[0].estimatedCost).toBeNull();
    expect(summary.cells[0].costUnavailableReason).toContain('1 of 2 case(s) reported no token usage');
  });

  it('reports no cost for the self-reviewing pipeline when its roles bill at different rates', () => {
    // Variant C pools generate + validate + revise usage into one figure, so pricing it at the
    // generator's rate would silently charge the validator's tokens at the wrong price.
    const summary = summarize([
      {
        label: 'mixed',
        roles: rolesFor('cheap-model', { validator: { provider: 'anthropic', model: 'primary-model' } }),
        caseResults: [caseResult({ caseId: 'c1', variant: 'C', score: 4, requestCount: 2 })],
      },
    ], ['C']);

    expect(summary.cells[0].estimatedCost).toBeNull();
    expect(summary.cells[0].costUnavailableReason).toContain('bill at different rates');
    expect(summary.cells[0].costUnavailableReason).toContain('generator, validator, reviser');
  });

  it('costs the self-reviewing pipeline when every contributing role shares one model', () => {
    const summary = summarize([
      {
        label: 'uniform',
        roles: rolesFor('cheap-model'),
        caseResults: [caseResult({ caseId: 'c1', variant: 'C', score: 4, inputTokens: 1000, outputTokens: 500, requestCount: 2 })],
      },
    ], ['C']);

    // 1000 input @ $1/M + 500 output @ $2/M = 0.001 + 0.001
    expect(summary.cells[0].estimatedCost).toBeCloseTo(0.002, 10);
  });

  it('ignores a differently-priced evaluator, whose tokens are not in the measured usage', () => {
    const summary = summarize([
      {
        label: 'cheap',
        roles: rolesFor('cheap-model', { evaluator: { provider: 'anthropic', model: 'primary-model' } }),
        caseResults: [caseResult({ caseId: 'c1', variant: 'B', score: 4 })],
      },
    ], ['B']);

    expect(summary.cells[0].estimatedCost).not.toBeNull();
  });

  it('lists models that appeared in the run with no pricing entry', () => {
    const summary = summarize([
      {
        label: 'unpriced',
        roles: rolesFor('some-new-model', { evaluator: { provider: 'anthropic', model: 'primary-model' } }),
        caseResults: [caseResult({ caseId: 'c1', variant: 'A', score: 4 })],
      },
    ], ['A']);

    expect(summary.modelsWithoutPricing).toEqual(['some-new-model']);
  });

  it('reports no cost for a cell that ran no cases', () => {
    const summary = summarize([
      {
        label: 'cheap',
        roles: rolesFor('cheap-model'),
        caseResults: [caseResult({ caseId: 'c1', variant: 'A', score: 4 })],
      },
    ], ['A', 'B']);

    const empty = summary.cells.find((c) => c.variant === 'B')!;
    expect(empty.cases).toBe(0);
    expect(empty.estimatedCost).toBeNull();
    expect(empty.costUnavailableReason).toBe('no cases ran for this cell');
  });
});

describe('effect of adding the skill', () => {
  it('reports one delta per configuration', () => {
    const summary = summarize(twoConfigurationRuns());

    expect(summary.skillDeltas.map((d) => d.configLabel)).toEqual(['cheap', 'primary']);
    expect(summary.skillDeltas[0].withoutSkill).toBe('A');
    expect(summary.skillDeltas[0].withSkill).toBe('B');
  });

  it('measures the quality change from adding the skill', () => {
    const summary = summarize(twoConfigurationRuns());

    expect(summary.skillDeltas[0].qualityDelta).toBeCloseTo(1, 10);
    expect(summary.skillDeltas[0].qualityDeltaByDimension.naturalness).toBeCloseTo(1, 10);
    expect(summary.skillDeltas[1].qualityDelta).toBeCloseTo(0.5, 10);
  });

  it('measures the extra tokens the skill costs, in absolute terms and as a percentage', () => {
    const summary = summarize(twoConfigurationRuns());
    const delta = summary.skillDeltas[0];

    // without skill: 2 x 150 = 300. with skill: 2 x 460 = 920.
    expect(delta.extraTotalTokens).toBe(620);
    expect(delta.extraInputTokens).toBe(600);
    expect(delta.extraOutputTokens).toBe(20);
    expect(delta.extraTotalTokensPercent).toBeCloseTo((620 / 300) * 100, 6);
  });

  it('reports a negative delta when the skill reduces tokens', () => {
    const summary = summarize([
      {
        label: 'cheap',
        roles: rolesFor('cheap-model'),
        caseResults: [
          caseResult({ caseId: 'c1', variant: 'A', score: 4, inputTokens: 500, outputTokens: 500 }),
          caseResult({ caseId: 'c1', variant: 'B', score: 4, inputTokens: 100, outputTokens: 100 }),
        ],
      },
    ]);

    expect(summary.skillDeltas[0].extraTotalTokens).toBe(-800);
    expect(summary.skillDeltas[0].extraTotalTokensPercent).toBeCloseTo(-80, 6);
  });

  it('reports the token percentage as null when the without-skill side used no tokens', () => {
    const summary = summarize([
      {
        label: 'cheap',
        roles: rolesFor('cheap-model'),
        caseResults: [
          caseResult({ caseId: 'c1', variant: 'A', score: 4, inputTokens: 0, outputTokens: 0 }),
          caseResult({ caseId: 'c1', variant: 'B', score: 4, inputTokens: 100, outputTokens: 100 }),
        ],
      },
    ]);

    expect(summary.skillDeltas[0].extraTotalTokens).toBe(200);
    expect(summary.skillDeltas[0].extraTotalTokensPercent).toBeNull();
  });

  it('measures the cost change from adding the skill', () => {
    const summary = summarize(twoConfigurationRuns());
    const delta = summary.skillDeltas[0];

    // without: 0.0004. with: 2 x (400/1M x 1 + 60/1M x 2) = 2 x (0.0004 + 0.00012) = 0.00104
    expect(delta.costDelta).toBeCloseTo(0.00064, 10);
    expect(delta.costDeltaPercent).toBeCloseTo(160, 6);
  });

  it('reports the cost change as null when either side has no known cost', () => {
    const summary = summarize([
      {
        label: 'unpriced',
        roles: rolesFor('some-new-model'),
        caseResults: [
          caseResult({ caseId: 'c1', variant: 'A', score: 3 }),
          caseResult({ caseId: 'c1', variant: 'B', score: 4 }),
        ],
      },
    ]);

    expect(summary.skillDeltas[0].costDelta).toBeNull();
    expect(summary.skillDeltas[0].costDeltaPercent).toBeNull();
  });

  it('measures extra requests and the change in deterministic failures', () => {
    const summary = summarize([
      {
        label: 'cheap',
        roles: rolesFor('cheap-model'),
        caseResults: [
          caseResult({ caseId: 'c1', variant: 'A', score: 3, requestCount: 1, pass: false }),
          caseResult({ caseId: 'c1', variant: 'B', score: 4, requestCount: 3, pass: true }),
        ],
      },
    ]);

    expect(summary.skillDeltas[0].extraRequests).toBe(2);
    expect(summary.skillDeltas[0].deterministicFailureDelta).toBe(-1);
  });

  it('omits a delta when the configuration did not run both sides of the comparison', () => {
    const summary = summarize(
      [
        {
          label: 'cheap',
          roles: rolesFor('cheap-model'),
          caseResults: [caseResult({ caseId: 'c1', variant: 'A', score: 3 })],
        },
      ],
      ['A']
    );

    expect(summary.skillDeltas).toEqual([]);
  });
});

describe('cheaper model with skill vs stronger model without skill', () => {
  it('compares the cheaper configuration with the skill against the stronger one without it', () => {
    const summary = summarize(twoConfigurationRuns());

    expect(summary.crossModel).toHaveLength(1);
    const comparison = summary.crossModel[0];
    expect(comparison.cheaperLabel).toBe('cheap');
    expect(comparison.cheaperVariant).toBe('B');
    expect(comparison.cheaperModel).toBe('cheap-model');
    expect(comparison.strongerLabel).toBe('primary');
    expect(comparison.strongerVariant).toBe('A');
    expect(comparison.strongerModel).toBe('primary-model');
  });

  it('measures the quality gap as cheaper-with-skill minus stronger-without-skill', () => {
    const summary = summarize(twoConfigurationRuns());

    // cheap/B scores 4, primary/A scores 4 — the skill closed the gap exactly on this data.
    expect(summary.crossModel[0].qualityGap).toBeCloseTo(0, 10);
  });

  it('reports a negative gap when the cheap model with the skill still scores lower', () => {
    const runs = twoConfigurationRuns();
    runs[0].caseResults = runs[0].caseResults.map((r) =>
      r.variant === 'B' ? { ...r, quality: quality(3.5) } : r
    );

    const summary = summarize(runs);
    expect(summary.crossModel[0].qualityGap).toBeCloseTo(-0.5, 10);
  });

  it('measures the cost difference and the cost ratio', () => {
    const summary = summarize(twoConfigurationRuns());
    const comparison = summary.crossModel[0];

    // cheap/B = 0.00104, primary/A = 2 x (100/1M x 10 + 50/1M x 20) = 2 x 0.002 = 0.004
    expect(comparison.costDelta).toBeCloseTo(0.00104 - 0.004, 10);
    expect(comparison.costRatio).toBeCloseTo(0.26, 6);
  });

  it('reports the cost ratio as null when a cost is unknown', () => {
    const runs = twoConfigurationRuns();
    runs[1].roles = rolesFor('some-new-model', { evaluator: { provider: 'anthropic', model: 'primary-model' } });

    const summary = summarize(runs);
    expect(summary.crossModel[0].costRatio).toBeNull();
    expect(summary.crossModel[0].costDelta).toBeNull();
  });

  it('measures the token gap and the deterministic failure gap', () => {
    const runs = twoConfigurationRuns();
    runs[0].caseResults = runs[0].caseResults.map((r) =>
      r.variant === 'B' ? { ...r, deterministic: deterministic(false) } : r
    );

    const summary = summarize(runs);
    // cheap/B = 920 tokens, primary/A = 300 tokens
    expect(summary.crossModel[0].tokenDelta).toBe(620);
    expect(summary.crossModel[0].deterministicFailureDelta).toBe(2);
  });

  it('produces no cross-model comparison for a single configuration', () => {
    const summary = summarize([twoConfigurationRuns()[0]]);
    expect(summary.crossModel).toEqual([]);
  });
});

describe('a model-only run, with no with/without-skill pair', () => {
  it('still reports the cells', () => {
    const summary = summarizeMatrix(twoConfigurationRuns(), ['A'], null, PRICING);

    expect(summary.cells.map((c) => `${c.configLabel}/${c.variant}`)).toEqual(['cheap/A', 'primary/A']);
    expect(summary.cells[0].estimatedCost).not.toBeNull();
  });

  it('computes no skill or cross-model deltas', () => {
    const summary = summarizeMatrix(twoConfigurationRuns(), ['A'], null, PRICING);

    expect(summary.skillDeltas).toEqual([]);
    expect(summary.crossModel).toEqual([]);
    expect(summary.skillComparison).toBeNull();
  });

  it('says in the report why the deltas are missing, instead of leaving it to be noticed', () => {
    const report = formatMatrixReport(summarizeMatrix(twoConfigurationRuns(), ['A'], null, PRICING));

    expect(report).toContain('No with/without-skill pair was run');
    expect(report).not.toContain('EFFECT OF ADDING THE SKILL');
  });
});

describe('formatMatrixReport', () => {
  it('renders a row per cell with the model and cost', () => {
    const report = formatMatrixReport(summarize(twoConfigurationRuns()));

    expect(report).toContain('MODEL x SKILL MATRIX');
    expect(report).toContain('cheap-model');
    expect(report).toContain('primary-model');
    expect(report).toContain('no-skill');
    expect(report).toContain('$0.0004');
  });

  it('shows the skill-effect and cross-model sections', () => {
    const report = formatMatrixReport(summarize(twoConfigurationRuns()));

    expect(report).toContain('EFFECT OF ADDING THE SKILL');
    expect(report).toContain('A -> B');
    expect(report).toContain('CHEAPER MODEL WITH SKILL vs STRONGER MODEL WITHOUT SKILL');
    expect(report).toContain('cheap/B');
    expect(report).toContain('primary/A');
  });

  it('states that the figures are measurements and not a ranking', () => {
    const report = formatMatrixReport(summarize(twoConfigurationRuns()));

    expect(report).toContain('These are measurements, not a ranking');
    expect(report).toContain('0.2-0.3');
  });

  it('never names a configuration as the better or winning one', () => {
    const report = formatMatrixReport(summarize(twoConfigurationRuns()));

    expect(report).not.toMatch(/\bwinner\b/i);
    expect(report).not.toMatch(/\brecommended\b/i);
    expect(report).not.toMatch(/\bis better\b/i);
  });

  it('explains each cell whose cost could not be determined', () => {
    const report = formatMatrixReport(
      summarize([
        {
          label: 'unpriced',
          roles: rolesFor('some-new-model', { evaluator: { provider: 'anthropic', model: 'primary-model' } }),
          caseResults: [caseResult({ caseId: 'c1', variant: 'A', score: 4 })],
        },
      ], ['A'])
    );

    expect(report).toContain('Cost not available for:');
    expect(report).toContain('unpriced/A: no pricing configured for "some-new-model"');
    expect(report).toContain('No pricing configured for: some-new-model');
  });
});
