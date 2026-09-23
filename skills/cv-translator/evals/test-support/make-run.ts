import type { DeterministicCheckResult } from '../../src/deterministic-checks';
import { hashObject } from '@skills/framework/hash';
import type { RunVersions } from '@skills/framework/manifest/versions';
import { makeVersions } from '@skills/framework/testing/make-run';
import { RESULT_SCHEMA_VERSION, type CaseResult, type EvalRunResult, type QualityScore, type Variant } from '../types';

/**
 * Builds EvalRunResult fixtures for the regression tests. Defaults describe a clean, fully-recorded
 * run, so each test only states the one thing it is about — a changed hash, a missing field, a
 * dropped score — and everything else stays comparable.
 */
export interface CaseSpec {
  id: string;
  /** Content hash. `null` omits it, standing in for a result saved before case hashes existed. */
  hash?: string | null;
  overall?: number;
  naturalness?: number;
  faithfulness?: number;
  cvQuality?: number;
  totalTokens?: number;
  unsupportedClaims?: string[];
  missingExactStrings?: string[];
  matchedForbiddenClaims?: string[];
  matchedForbiddenCharacters?: string[];
  boldMarkerMismatch?: boolean;
  paragraphBreakMismatch?: boolean;
}

export interface RunSpec {
  cases: CaseSpec[];
  variants?: Variant[];
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
  /** Prompt and dataset versions. `null` omits them, as a run saved before they existed would. */
  versions?: RunVersions | null;
}

function quality(spec: CaseSpec): QualityScore {
  const overall = spec.overall ?? 4.5;
  return {
    faithfulness: spec.faithfulness ?? overall,
    naturalness: spec.naturalness ?? overall,
    cvQuality: spec.cvQuality ?? overall,
    terminology: overall,
    conciseness: overall,
    overall,
    justification: '',
    problems: [],
    missingExpectedFacts: [],
    unsupportedClaims: spec.unsupportedClaims ?? [],
    seniorityInflationNotes: [],
    terminologyProblems: [],
    naturalnessProblems: [],
  };
}

function deterministic(spec: CaseSpec): DeterministicCheckResult {
  const missingExactStrings = spec.missingExactStrings ?? [];
  const matchedForbiddenClaims = spec.matchedForbiddenClaims ?? [];
  const matchedForbiddenCharacters = spec.matchedForbiddenCharacters ?? [];
  const boldMarkerMismatch = spec.boldMarkerMismatch ?? false;
  const paragraphBreakMismatch = spec.paragraphBreakMismatch ?? false;
  return {
    pass:
      missingExactStrings.length === 0 &&
      matchedForbiddenClaims.length === 0 &&
      matchedForbiddenCharacters.length === 0 &&
      !boldMarkerMismatch &&
      !paragraphBreakMismatch,
    missingExactStrings,
    missingTerms: [],
    matchedForbiddenClaims,
    matchedForbiddenCharacters,
    lengthExceeded: false,
    boldMarkerMismatch,
    paragraphBreakMismatch,
    repeatedEntryOpeners: [],
  };
}

/** Derived from the id so two runs listing the same case agree unless a test says otherwise. */
function defaultCaseHash(id: string): string {
  return hashObject({ case: id });
}

export function makeRun(spec: RunSpec): EvalRunResult {
  const variants = spec.variants ?? ['B'];
  const caseResults: CaseResult[] = [];

  for (const kase of spec.cases) {
    const hash = kase.hash === null ? undefined : (kase.hash ?? defaultCaseHash(kase.id));
    for (const variant of variants) {
      caseResults.push({
        caseId: kase.id,
        category: 'translation',
        variant,
        output: {
          variant,
          caseId: kase.id,
          text: `output for ${kase.id}`,
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: kase.totalTokens ?? 150 },
          requestCount: 1,
        },
        deterministic: deterministic(kase),
        quality: quality(kase),
        caseHash: hash,
      });
    }
  }

  const evaluatorModel = spec.evaluatorModel ?? 'claude-sonnet-5';
  const generatorModel = spec.generatorModel ?? 'claude-sonnet-5';
  const provider = spec.provider === undefined ? 'anthropic' : spec.provider;

  const run: EvalRunResult = {
    timestamp: '2026-09-13T10:00:00.000Z',
    model: generatorModel,
    evaluatorModel,
    benchmarkVersion: spec.benchmarkVersion ?? 'golden-v1',
    variants,
    caseResults,
    pairwiseResults: [],
    aggregates: [],
  };

  if (spec.schemaVersion !== null) run.schemaVersion = spec.schemaVersion ?? RESULT_SCHEMA_VERSION;
  if (spec.skillHash !== null) run.skillHash = spec.skillHash ?? 'skill-hash-baseline';
  if (spec.configHash !== null) run.configHash = spec.configHash ?? 'config-hash-baseline';
  if (spec.evaluatorPromptHash !== null) {
    run.evaluatorPromptHash = spec.evaluatorPromptHash ?? 'rubric-hash-baseline';
  }
  if (spec.caseInputHash !== null) {
    run.caseInputHash =
      spec.caseInputHash ??
      hashObject(spec.cases.map((c) => [c.id, c.hash === null ? null : (c.hash ?? defaultCaseHash(c.id))]));
  }
  if (spec.versions !== null) run.versions = spec.versions ?? makeVersions();
  if (provider !== null) {
    run.modelRoles = {
      generator: { provider, model: generatorModel },
      validator: { provider, model: generatorModel },
      reviser: { provider, model: generatorModel },
      evaluator: { provider, model: evaluatorModel },
      pairwiseJudge: { provider, model: evaluatorModel },
    };
  }

  return run;
}

/** A run that differs from the baseline only by having a changed skill — the normal regression case. */
export function makeChangedSkillRun(spec: RunSpec): EvalRunResult {
  return makeRun({ skillHash: 'skill-hash-changed', ...spec });
}
