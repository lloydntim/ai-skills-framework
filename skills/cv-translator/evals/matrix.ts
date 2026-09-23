import type { RoleModelConfig } from '@skills/framework/provider/model-roles';
import type { Variant } from './types';

/**
 * Whether a cell ran the skill at all. Derived from the variant rather than configured separately,
 * so there is no way to label a run "skill" while actually running the baseline prompt.
 */
export type SkillMode = 'no-skill' | 'skill' | 'skill+self-review';

const VARIANTS: readonly Variant[] = ['A', 'B', 'C', 'D'];

export const SKILL_MODE_BY_VARIANT: Record<Variant, SkillMode> = {
  A: 'no-skill',
  B: 'skill',
  C: 'skill+self-review',
  D: 'skill+self-review',
};

/** One generator configuration: a label for reports, and the model-role config file it runs with. */
export interface GeneratorConfiguration {
  label: string;
  modelsConfig: string;
}

/** Which two variants form the "does the skill help?" pair for every configuration. */
export interface SkillComparison {
  withoutSkill: Variant;
  withSkill: Variant;
}

export interface MatrixConfig {
  /**
   * Ordered cheapest-first. The order is meaningful: it is what defines "a cheaper model" for the
   * cross-model comparison, so no model name has to be hard-coded anywhere to know which side of
   * that comparison a configuration sits on.
   */
  configurations: GeneratorConfiguration[];
  variants: Variant[];
  /**
   * null when the chosen variants cannot form a with/without-skill pair — a model-only comparison,
   * such as narrowing a run to one variant as a cheap wiring check. The skill and cross-model
   * deltas are then not computed, and the report says so rather than leaving it to be noticed.
   */
  skillComparison: SkillComparison | null;
}

/** One cell of the matrix: one generator configuration run at one variant. */
export interface MatrixEntry {
  configLabel: string;
  modelsConfigPath: string;
  variant: Variant;
  skillMode: SkillMode;
}

/** A cheaper configuration's with-skill result set against a stronger configuration's without-skill result. */
export interface CrossModelPair {
  cheaperLabel: string;
  cheaperVariant: Variant;
  strongerLabel: string;
  strongerVariant: Variant;
}

export class MatrixConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MatrixConfigError';
  }
}

const DEFAULT_SKILL_COMPARISON: SkillComparison = { withoutSkill: 'A', withSkill: 'B' };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVariant(value: unknown): value is Variant {
  return typeof value === 'string' && (VARIANTS as readonly string[]).includes(value);
}

function parseConfigurations(raw: unknown): GeneratorConfiguration[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new MatrixConfigError('Matrix configuration needs a non-empty "configurations" array.');
  }

  const configurations: GeneratorConfiguration[] = [];
  const seen = new Set<string>();

  raw.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new MatrixConfigError(`configurations[${index}] must be an object with "label" and "modelsConfig".`);
    }
    const { label, modelsConfig } = entry;
    if (typeof label !== 'string' || label.trim().length === 0) {
      throw new MatrixConfigError(`configurations[${index}] is missing a non-empty "label" string.`);
    }
    if (typeof modelsConfig !== 'string' || modelsConfig.trim().length === 0) {
      throw new MatrixConfigError(`configurations[${index}] ("${label}") is missing a non-empty "modelsConfig" path.`);
    }
    if (seen.has(label)) {
      throw new MatrixConfigError(
        `Duplicate configuration label "${label}". Labels identify rows in the summary and must be unique.`
      );
    }
    seen.add(label);
    configurations.push({ label, modelsConfig });
  });

  return configurations;
}

function parseVariants(raw: unknown): Variant[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new MatrixConfigError('Matrix configuration needs a non-empty "variants" array.');
  }

  const variants: Variant[] = [];
  for (const entry of raw) {
    if (!isVariant(entry)) {
      throw new MatrixConfigError(`Unknown variant ${JSON.stringify(entry)}. Known variants: ${VARIANTS.join(', ')}.`);
    }
    if (variants.includes(entry)) {
      throw new MatrixConfigError(`Variant "${entry}" is listed more than once.`);
    }
    variants.push(entry);
  }
  return variants;
}

function parseSkillComparison(raw: unknown, variants: Variant[]): SkillComparison | null {
  // Absent and not inferable is a model-only run, not a mistake. An explicitly named pair that
  // cannot run *is* a mistake, and every check below still throws for it.
  if (raw === undefined) {
    const fallback = DEFAULT_SKILL_COMPARISON;
    const runnable = variants.includes(fallback.withoutSkill) && variants.includes(fallback.withSkill);
    return runnable ? fallback : null;
  }

  if (!isPlainObject(raw)) {
    throw new MatrixConfigError('"skillComparison" must be an object with "withoutSkill" and "withSkill" variants.');
  }

  const { withoutSkill, withSkill } = raw;
  if (!isVariant(withoutSkill) || !isVariant(withSkill)) {
    throw new MatrixConfigError('"skillComparison" needs "withoutSkill" and "withSkill" to be known variants.');
  }
  if (withoutSkill === withSkill) {
    throw new MatrixConfigError('"skillComparison" needs two different variants; comparing a variant to itself measures nothing.');
  }
  for (const [field, variant] of [['withoutSkill', withoutSkill], ['withSkill', withSkill]] as const) {
    if (!variants.includes(variant)) {
      throw new MatrixConfigError(
        `"skillComparison.${field}" is "${variant}", which is not in variants [${variants.join(', ')}], ` +
          `so it would never be run.`
      );
    }
  }
  if (SKILL_MODE_BY_VARIANT[withoutSkill] !== 'no-skill') {
    throw new MatrixConfigError(
      `"skillComparison.withoutSkill" is "${withoutSkill}", which runs with the skill ` +
        `(${SKILL_MODE_BY_VARIANT[withoutSkill]}). The without-skill side must be a baseline variant.`
    );
  }
  // Unreachable while A is the only baseline variant (withSkill must differ from a withoutSkill
  // that has already been checked to be the baseline). Kept so adding a second no-skill variant
  // cannot silently produce a comparison of two baselines.
  if (SKILL_MODE_BY_VARIANT[withSkill] === 'no-skill') {
    throw new MatrixConfigError(
      `"skillComparison.withSkill" is "${withSkill}", which runs without the skill. ` +
        `The with-skill side must be a variant that loads the skill.`
    );
  }

  return { withoutSkill, withSkill };
}

/** Validates a raw (e.g. JSON-loaded) matrix configuration. Throws MatrixConfigError on any problem. */
export function parseMatrixConfig(raw: unknown): MatrixConfig {
  if (!isPlainObject(raw)) {
    throw new MatrixConfigError('Matrix configuration must be an object.');
  }
  const configurations = parseConfigurations(raw.configurations);
  const variants = parseVariants(raw.variants);
  const skillComparison = parseSkillComparison(raw.skillComparison, variants);
  return { configurations, variants, skillComparison };
}

/**
 * Expands configurations x variants into the flat list of runs to perform, configuration-major so a
 * configuration's models are loaded once and all its variants run together.
 */
export function buildMatrix(config: MatrixConfig): MatrixEntry[] {
  const entries: MatrixEntry[] = [];
  for (const configuration of config.configurations) {
    for (const variant of config.variants) {
      entries.push({
        configLabel: configuration.label,
        modelsConfigPath: configuration.modelsConfig,
        variant,
        skillMode: SKILL_MODE_BY_VARIANT[variant],
      });
    }
  }
  return entries;
}

/**
 * The cheaper-with-skill vs stronger-without-skill pairs implied by the configuration order. Every
 * configuration is paired against each configuration listed after it, so this generalises past two
 * models without naming any of them.
 */
export function crossModelPairs(
  configLabels: string[],
  skillComparison: SkillComparison | null
): CrossModelPair[] {
  if (!skillComparison) return [];

  const pairs: CrossModelPair[] = [];
  for (let cheaper = 0; cheaper < configLabels.length; cheaper += 1) {
    for (let stronger = cheaper + 1; stronger < configLabels.length; stronger += 1) {
      pairs.push({
        cheaperLabel: configLabels[cheaper],
        cheaperVariant: skillComparison.withSkill,
        strongerLabel: configLabels[stronger],
        strongerVariant: skillComparison.withoutSkill,
      });
    }
  }
  return pairs;
}

/**
 * Scores from different judges are not comparable, so a matrix whose configurations evaluate with
 * different evaluator models produces numbers that cannot be set side by side. Returns one
 * description per configuration that disagrees with the first; an empty array means all agree.
 */
export function findEvaluatorMismatches(
  configured: { label: string; evaluator: RoleModelConfig }[]
): string[] {
  if (configured.length < 2) return [];

  const [reference, ...rest] = configured;
  const mismatches: string[] = [];

  for (const entry of rest) {
    const sameProvider = entry.evaluator.provider === reference.evaluator.provider;
    const sameModel = entry.evaluator.model === reference.evaluator.model;
    if (sameProvider && sameModel) continue;
    mismatches.push(
      `"${entry.label}" evaluates with ${entry.evaluator.provider}/${entry.evaluator.model} ` +
        `but "${reference.label}" evaluates with ${reference.evaluator.provider}/${reference.evaluator.model}`
    );
  }

  return mismatches;
}
