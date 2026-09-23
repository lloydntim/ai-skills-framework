import type { ModelRolesConfig, ModelRole } from '@skills/framework/provider/model-roles';
import { DEFAULT_PRICING, estimateCost, hasPricing, type PricingTable } from '@skills/framework/provider/pricing';
import { aggregateForVariant } from './aggregate';
import { crossModelPairs, SKILL_MODE_BY_VARIANT, type SkillComparison, type SkillMode } from './matrix';
import type { CaseResult, Variant } from './types';

/** One generator configuration's finished results, as handed to the summary. */
export interface ConfigurationRun {
  label: string;
  /** The effective provider/model for every role in this configuration. */
  roles: ModelRolesConfig;
  caseResults: CaseResult[];
}

export interface DimensionScores {
  faithfulness: number;
  naturalness: number;
  cvQuality: number;
  terminology: number;
  conciseness: number;
  overall: number;
}

export interface MatrixCell {
  configLabel: string;
  variant: Variant;
  skillMode: SkillMode;
  /** The generator's provider and model — the thing under test in this cell. */
  provider: string;
  model: string;
  cases: number;
  scores: DimensionScores;
  /**
   * Cases whose hard deterministic checks failed (`DeterministicCheckResult.pass === false`):
   * a missing required string or term, a forbidden claim or character, or broken structure. Soft
   * signals (length, repeated openers) are excluded, exactly as they are from `pass` itself.
   */
  deterministicFailures: number;
  deterministicFailureCaseIds: string[];
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestCount: number;
  /**
   * Averaged over only the cases that reported a latency, and null when none did — so "unmeasured"
   * never reads as a real 0. Variant C's latency is the sum across its generate/validate/revise
   * calls, not the time of one call.
   */
  avgLatencyMs: number | null;
  totalLatencyMs: number | null;
  /** null when cost cannot be known; `costUnavailableReason` then says why. */
  estimatedCost: number | null;
  costUnavailableReason?: string;
}

export interface SkillDelta {
  configLabel: string;
  withoutSkill: Variant;
  withSkill: Variant;
  /** With-skill minus without-skill. Positive means the with-skill cell scored higher. */
  qualityDelta: number;
  qualityDeltaByDimension: DimensionScores;
  extraInputTokens: number;
  extraOutputTokens: number;
  extraTotalTokens: number;
  /** null when the without-skill cell used no tokens, so there is no base to take a percentage of. */
  extraTotalTokensPercent: number | null;
  extraRequests: number;
  /** null when either side's cost is unknown. */
  costDelta: number | null;
  costDeltaPercent: number | null;
  deterministicFailureDelta: number;
}

export interface CrossModelComparison {
  cheaperLabel: string;
  cheaperVariant: Variant;
  cheaperModel: string;
  strongerLabel: string;
  strongerVariant: Variant;
  strongerModel: string;
  /** Cheaper-with-skill minus stronger-without-skill. Positive means the cheaper cell scored higher. */
  qualityGap: number;
  qualityGapByDimension: DimensionScores;
  tokenDelta: number;
  costDelta: number | null;
  /** Cheaper cost as a multiple of stronger cost (0.2 = a fifth the cost). null when either is unknown. */
  costRatio: number | null;
  deterministicFailureDelta: number;
}

export interface MatrixSummary {
  /** Configuration labels in the order they were configured: cheapest first. */
  configOrder: string[];
  /** null when the chosen variants could not form a with/without-skill pair; see MatrixConfig. */
  skillComparison: SkillComparison | null;
  cells: MatrixCell[];
  skillDeltas: SkillDelta[];
  crossModel: CrossModelComparison[];
  /** Models that appeared in the run but have no entry in the pricing table. */
  modelsWithoutPricing: string[];
}

const DIMENSION_KEYS: readonly (keyof DimensionScores)[] = [
  'faithfulness',
  'naturalness',
  'cvQuality',
  'terminology',
  'conciseness',
  'overall',
];

/** Roles whose token usage is pooled into a variant's recorded usage, per skill mode. */
const ROLES_CONTRIBUTING_USAGE: Record<SkillMode, ModelRole[]> = {
  'no-skill': ['generator'],
  skill: ['generator'],
  'skill+self-review': ['generator', 'validator', 'reviser'],
};

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function percentChange(from: number, to: number): number | null {
  if (from === 0) return null;
  return ((to - from) / from) * 100;
}

function subtractDimensions(from: DimensionScores, to: DimensionScores): DimensionScores {
  const result = {} as DimensionScores;
  for (const key of DIMENSION_KEYS) {
    result[key] = to[key] - from[key];
  }
  return result;
}

/**
 * A variant's recorded usage is pooled across every model call it made, so it can only be priced
 * when all the roles that contributed to that pool bill at the same rate. Returns the single model
 * to price at, or a reason why no honest single price exists — it is better to report no cost than
 * to cost a Haiku validator's tokens at Sonnet's rate and call the result a measurement.
 */
function resolveCostModel(
  roles: ModelRolesConfig,
  skillMode: SkillMode,
  pricing: PricingTable
): { model: string } | { reason: string } {
  const contributing = ROLES_CONTRIBUTING_USAGE[skillMode];
  const distinct = [...new Set(contributing.map((role) => `${roles[role].provider}/${roles[role].model}`))];

  if (distinct.length > 1) {
    return {
      reason:
        `usage is pooled across ${contributing.join(', ')}, which bill at different rates ` +
        `(${distinct.join(', ')}), so no single price applies`,
    };
  }

  const model = roles[contributing[0]].model;
  if (!hasPricing(model, pricing)) {
    return { reason: `no pricing configured for "${model}"` };
  }
  return { model };
}

function buildCell(
  run: ConfigurationRun,
  variant: Variant,
  pricing: PricingTable
): MatrixCell {
  const group = run.caseResults.filter((r) => r.variant === variant);
  const aggregate = aggregateForVariant(variant, run.caseResults);
  const skillMode = SKILL_MODE_BY_VARIANT[variant];

  const failures = group.filter((r) => !r.deterministic.pass);

  const latencies = group.map((r) => r.output.latencyMs).filter((ms): ms is number => ms !== undefined);
  const totalLatencyMs = latencies.length > 0 ? sum(latencies) : null;

  const costModel = resolveCostModel(run.roles, skillMode, pricing);
  let estimatedCost: number | null = null;
  let costUnavailableReason: string | undefined;

  if ('reason' in costModel) {
    costUnavailableReason = costModel.reason;
  } else {
    const perCase = group.map((r) => estimateCost(costModel.model, r.output.usage, pricing));
    const unpriced = perCase.filter((c) => c === undefined).length;
    if (group.length === 0 || unpriced > 0) {
      costUnavailableReason =
        group.length === 0
          ? 'no cases ran for this cell'
          : `${unpriced} of ${group.length} case(s) reported no token usage`;
    } else {
      estimatedCost = sum(perCase as number[]);
    }
  }

  return {
    configLabel: run.label,
    variant,
    skillMode,
    provider: run.roles.generator.provider,
    model: run.roles.generator.model,
    cases: group.length,
    scores: {
      faithfulness: aggregate.avgFaithfulness,
      naturalness: aggregate.avgNaturalness,
      cvQuality: aggregate.avgCvQuality,
      terminology: aggregate.avgTerminology,
      conciseness: aggregate.avgConciseness,
      overall: aggregate.avgOverall,
    },
    deterministicFailures: failures.length,
    deterministicFailureCaseIds: failures.map((r) => r.caseId),
    inputTokens: sum(group.map((r) => r.output.usage?.inputTokens ?? 0)),
    outputTokens: sum(group.map((r) => r.output.usage?.outputTokens ?? 0)),
    totalTokens: sum(group.map((r) => r.output.usage?.totalTokens ?? 0)),
    requestCount: sum(group.map((r) => r.output.requestCount ?? 0)),
    avgLatencyMs: totalLatencyMs === null ? null : totalLatencyMs / latencies.length,
    totalLatencyMs,
    estimatedCost,
    costUnavailableReason,
  };
}

function findCell(cells: MatrixCell[], configLabel: string, variant: Variant): MatrixCell | undefined {
  return cells.find((c) => c.configLabel === configLabel && c.variant === variant);
}

function buildSkillDelta(without: MatrixCell, withSkill: MatrixCell): SkillDelta {
  const bothCostsKnown = without.estimatedCost !== null && withSkill.estimatedCost !== null;
  return {
    configLabel: without.configLabel,
    withoutSkill: without.variant,
    withSkill: withSkill.variant,
    qualityDelta: withSkill.scores.overall - without.scores.overall,
    qualityDeltaByDimension: subtractDimensions(without.scores, withSkill.scores),
    extraInputTokens: withSkill.inputTokens - without.inputTokens,
    extraOutputTokens: withSkill.outputTokens - without.outputTokens,
    extraTotalTokens: withSkill.totalTokens - without.totalTokens,
    extraTotalTokensPercent: percentChange(without.totalTokens, withSkill.totalTokens),
    extraRequests: withSkill.requestCount - without.requestCount,
    costDelta: bothCostsKnown ? withSkill.estimatedCost! - without.estimatedCost! : null,
    costDeltaPercent: bothCostsKnown ? percentChange(without.estimatedCost!, withSkill.estimatedCost!) : null,
    deterministicFailureDelta: withSkill.deterministicFailures - without.deterministicFailures,
  };
}

function buildCrossModel(cheaper: MatrixCell, stronger: MatrixCell): CrossModelComparison {
  const bothCostsKnown = cheaper.estimatedCost !== null && stronger.estimatedCost !== null;
  return {
    cheaperLabel: cheaper.configLabel,
    cheaperVariant: cheaper.variant,
    cheaperModel: cheaper.model,
    strongerLabel: stronger.configLabel,
    strongerVariant: stronger.variant,
    strongerModel: stronger.model,
    qualityGap: cheaper.scores.overall - stronger.scores.overall,
    qualityGapByDimension: subtractDimensions(stronger.scores, cheaper.scores),
    tokenDelta: cheaper.totalTokens - stronger.totalTokens,
    costDelta: bothCostsKnown ? cheaper.estimatedCost! - stronger.estimatedCost! : null,
    costRatio:
      bothCostsKnown && stronger.estimatedCost! !== 0 ? cheaper.estimatedCost! / stronger.estimatedCost! : null,
    deterministicFailureDelta: cheaper.deterministicFailures - stronger.deterministicFailures,
  };
}

/**
 * Turns finished per-configuration results into one comparable set of cells plus the deltas worth
 * reading. Every figure here is measured; nothing in this module ranks configurations or picks a
 * winner, because a single aggregate judge score is not a sound basis for that (see the caveats
 * printed by formatMatrixReport).
 */
export function summarizeMatrix(
  runs: ConfigurationRun[],
  variants: Variant[],
  skillComparison: SkillComparison | null,
  pricing: PricingTable = DEFAULT_PRICING
): MatrixSummary {
  const cells: MatrixCell[] = [];
  for (const run of runs) {
    for (const variant of variants) {
      cells.push(buildCell(run, variant, pricing));
    }
  }

  const skillDeltas: SkillDelta[] = [];
  if (skillComparison) {
    for (const run of runs) {
      const without = findCell(cells, run.label, skillComparison.withoutSkill);
      const withSkill = findCell(cells, run.label, skillComparison.withSkill);
      if (without && withSkill) {
        skillDeltas.push(buildSkillDelta(without, withSkill));
      }
    }
  }

  const configOrder = runs.map((r) => r.label);
  const crossModel: CrossModelComparison[] = [];
  for (const pair of crossModelPairs(configOrder, skillComparison)) {
    const cheaper = findCell(cells, pair.cheaperLabel, pair.cheaperVariant);
    const stronger = findCell(cells, pair.strongerLabel, pair.strongerVariant);
    if (cheaper && stronger) {
      crossModel.push(buildCrossModel(cheaper, stronger));
    }
  }

  const modelsWithoutPricing = [
    ...new Set(
      runs
        .flatMap((run) => Object.values(run.roles).map((role) => role.model))
        .filter((model) => !hasPricing(model, pricing))
    ),
  ];

  return { configOrder, skillComparison, cells, skillDeltas, crossModel, modelsWithoutPricing };
}

/* ---------- report formatting ---------- */

function signed(value: number, digits: number): string {
  const formatted = value.toFixed(digits);
  return value > 0 ? `+${formatted}` : formatted;
}

function integer(value: number): string {
  return value.toLocaleString('en-GB');
}

function signedInteger(value: number): string {
  const formatted = integer(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return '0';
}

function money(value: number | null): string {
  return value === null ? 'n/a' : `$${value.toFixed(4)}`;
}

function signedMoney(value: number | null): string {
  if (value === null) return 'n/a';
  const formatted = `$${Math.abs(value).toFixed(4)}`;
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function percent(value: number | null): string {
  return value === null ? 'n/a' : `${signed(value, 0)}%`;
}

function renderTable(headers: string[], rows: string[][]): string[] {
  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map((row) => (row[i] ?? '').length)));
  const line = (cells: string[]) =>
    cells.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join('  ').trimEnd();
  return [line(headers), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)];
}

/** A compact terminal report: one row per model/variant cell, then the deltas, then the caveats. */
export function formatMatrixReport(summary: MatrixSummary): string {
  const lines: string[] = [];

  lines.push('MODEL x SKILL MATRIX');
  lines.push('====================');
  lines.push('');

  lines.push(
    ...renderTable(
      ['Config', 'Var', 'Mode', 'Model', 'Cases', 'Overall', 'Faith', 'Nat', 'CV', 'Term', 'DetFail', 'In tok', 'Out tok', 'Reqs', 'Avg ms', 'Cost'],
      summary.cells.map((cell) => [
        cell.configLabel,
        cell.variant,
        cell.skillMode,
        cell.model,
        String(cell.cases),
        cell.scores.overall.toFixed(2),
        cell.scores.faithfulness.toFixed(2),
        cell.scores.naturalness.toFixed(2),
        cell.scores.cvQuality.toFixed(2),
        cell.scores.terminology.toFixed(2),
        String(cell.deterministicFailures),
        integer(cell.inputTokens),
        integer(cell.outputTokens),
        integer(cell.requestCount),
        cell.avgLatencyMs === null ? 'n/a' : cell.avgLatencyMs.toFixed(0),
        money(cell.estimatedCost),
      ])
    )
  );

  const unavailable = summary.cells.filter((c) => c.costUnavailableReason);
  if (unavailable.length > 0) {
    lines.push('');
    lines.push('Cost not available for:');
    for (const cell of unavailable) {
      lines.push(`  ${cell.configLabel}/${cell.variant}: ${cell.costUnavailableReason}`);
    }
  }

  if (summary.skillDeltas.length > 0) {
    lines.push('');
    lines.push('EFFECT OF ADDING THE SKILL (same model, with-skill minus without-skill)');
    lines.push('');
    lines.push(
      ...renderTable(
        ['Config', 'Compared', 'Overall', 'Faith', 'Nat', 'Extra tokens', 'Tokens %', 'Extra reqs', 'Cost', 'Cost %', 'DetFail'],
        summary.skillDeltas.map((delta) => [
          delta.configLabel,
          `${delta.withoutSkill} -> ${delta.withSkill}`,
          signed(delta.qualityDelta, 2),
          signed(delta.qualityDeltaByDimension.faithfulness, 2),
          signed(delta.qualityDeltaByDimension.naturalness, 2),
          signedInteger(delta.extraTotalTokens),
          percent(delta.extraTotalTokensPercent),
          signedInteger(delta.extraRequests),
          signedMoney(delta.costDelta),
          percent(delta.costDeltaPercent),
          signedInteger(delta.deterministicFailureDelta),
        ])
      )
    );
  }

  if (summary.skillComparison === null) {
    lines.push('');
    lines.push(
      'No with/without-skill pair was run, so the skill and cross-model deltas are not shown. ' +
        'Run both a baseline and a skill variant to get them.'
    );
  }

  if (summary.crossModel.length > 0) {
    lines.push('');
    lines.push('CHEAPER MODEL WITH SKILL vs STRONGER MODEL WITHOUT SKILL');
    lines.push('');
    lines.push(
      ...renderTable(
        ['Cheaper + skill', 'Stronger, no skill', 'Overall gap', 'Faith gap', 'Nat gap', 'Token gap', 'Cost gap', 'Cost ratio', 'DetFail gap'],
        summary.crossModel.map((c) => [
          `${c.cheaperLabel}/${c.cheaperVariant}`,
          `${c.strongerLabel}/${c.strongerVariant}`,
          signed(c.qualityGap, 2),
          signed(c.qualityGapByDimension.faithfulness, 2),
          signed(c.qualityGapByDimension.naturalness, 2),
          signedInteger(c.tokenDelta),
          signedMoney(c.costDelta),
          c.costRatio === null ? 'n/a' : `${c.costRatio.toFixed(2)}x`,
          signedInteger(c.deterministicFailureDelta),
        ])
      )
    );
  }

  if (summary.modelsWithoutPricing.length > 0) {
    lines.push('');
    lines.push(`No pricing configured for: ${summary.modelsWithoutPricing.join(', ')} (add it to config/pricing.json).`);
  }

  lines.push('');
  lines.push('HOW TO READ THIS');
  lines.push('  These are measurements, not a ranking. No configuration is marked "better" here.');
  lines.push('  - Judge scores move by roughly 0.2-0.3 between identical runs, so an overall gap');
  lines.push('    smaller than that is not evidence of a difference. Re-run before concluding.');
  lines.push('  - A quality gap and a deterministic failure are not interchangeable: a cell with');
  lines.push('    fewer hard failures may still score lower, and hard failures are the stricter signal.');
  lines.push('  - Cost figures are estimates from config/pricing.json and the tokens actually reported.');
  lines.push('  - Read the per-case results in the saved run files before acting on any row here.');

  return lines.join('\n');
}
