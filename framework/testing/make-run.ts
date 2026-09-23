import { hashObject } from '../hash';
import type { ComparableRun } from '../evals/regression-compatibility';
import type { RunVersions } from '../manifest/versions';

/**
 * Builds saved-run fixtures for the comparison tests. Defaults describe a clean, fully recorded
 * run, so each test only states the one thing it is about: a changed hash, a missing field, a
 * renamed case. Everything else stays comparable.
 */
export interface CaseSpec {
  id: string;
  /** Content hash. `null` omits it, standing in for a result saved before case hashes existed. */
  hash?: string | null;
}

export interface RunSpec {
  cases: CaseSpec[];
  variants?: string[];
  /** `null` omits the field, standing in for a result saved before it existed. */
  schemaVersion?: number | null;
  skillHash?: string | null;
  caseInputHash?: string | null;
  configHash?: string | null;
  evaluatorPromptHash?: string | null;
  evaluatorModel?: string;
  generatorModel?: string;
  /** `null` omits modelRoles entirely, as a result saved before per-role config existed would. */
  provider?: string | null;
  benchmarkVersion?: string;
  dataset?: string;
  gitDirty?: boolean | null;
  /** Prompt and dataset versions. `null` omits them, as a run saved before they were recorded would. */
  versions?: RunVersions | null;
  pairwiseJudgeModel?: string;
  validatorModel?: string;
  reviserModel?: string;
}

/** Derived from the id so two runs listing the same case agree unless a test says otherwise. */
function defaultCaseHash(id: string): string {
  return hashObject({ case: id });
}

export function makeVersions(overrides: Partial<Record<string, string>> = {}): RunVersions {
  const file = (name: string, version = '1') => ({ version, hash: overrides[`${name}Hash`] ?? `${name}-hash-baseline` });
  return {
    skill: { name: 'demo', version: '1.0.0', hash: 'skill-hash-baseline' },
    prompts: {
      validator: file('validator'),
      reviser: file('reviser'),
      evaluator: file('evaluator'),
      pairwiseEvaluator: file('pairwiseEvaluator'),
    },
    datasets: { golden: { version: '1', hash: 'golden-hash-baseline', caseCount: 3 } },
  };
}

export function makeRun(spec: RunSpec): ComparableRun {
  const variants = spec.variants ?? ['B'];
  const caseResults: ComparableRun['caseResults'] = [];

  for (const kase of spec.cases) {
    const hash = kase.hash === null ? undefined : (kase.hash ?? defaultCaseHash(kase.id));
    for (const variant of variants) caseResults.push({ caseId: kase.id, variant, caseHash: hash });
  }

  const evaluatorModel = spec.evaluatorModel ?? 'claude-sonnet-5';
  const generatorModel = spec.generatorModel ?? 'claude-sonnet-5';
  const provider = spec.provider === undefined ? 'anthropic' : spec.provider;

  const run: ComparableRun = {
    model: generatorModel,
    evaluatorModel,
    benchmarkVersion: spec.benchmarkVersion ?? 'golden-v1',
    caseResults,
  };

  if (spec.schemaVersion !== null) run.schemaVersion = spec.schemaVersion ?? 1;
  if (spec.skillHash !== null) run.skillHash = spec.skillHash ?? 'skill-hash-baseline';
  if (spec.configHash !== null) run.configHash = spec.configHash ?? 'config-hash-baseline';
  if (spec.evaluatorPromptHash !== null) run.evaluatorPromptHash = spec.evaluatorPromptHash ?? 'rubric-hash-baseline';
  if (spec.caseInputHash !== null) {
    run.caseInputHash =
      spec.caseInputHash ??
      hashObject(spec.cases.map((c) => [c.id, c.hash === null ? null : (c.hash ?? defaultCaseHash(c.id))]));
  }
  if (spec.dataset !== undefined) run.dataset = spec.dataset;
  if (spec.gitDirty !== undefined) run.gitDirty = spec.gitDirty;
  if (spec.versions !== null) run.versions = spec.versions ?? makeVersions();
  if (provider !== null) {
    run.modelRoles = {
      generator: { provider, model: generatorModel },
      validator: { provider, model: spec.validatorModel ?? generatorModel },
      reviser: { provider, model: spec.reviserModel ?? generatorModel },
      evaluator: { provider, model: evaluatorModel },
      pairwiseJudge: { provider, model: spec.pairwiseJudgeModel ?? evaluatorModel },
    };
  }

  return run;
}

/** A run that differs from the baseline only by having a changed skill, the normal regression case. */
export function makeChangedSkillRun(spec: RunSpec): ComparableRun {
  return makeRun({ skillHash: 'skill-hash-changed', ...spec });
}
