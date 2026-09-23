import fs from 'node:fs';
import path from 'node:path';
import { checkCompatibility, type CompatibilityLevel, type CompatibilityReport } from '@skills/framework/evals/regression-compatibility';
import type { CaseResult, EvalRunResult, Variant } from './types';
import evalConfig from './config/eval-config.json';

/**
 * The only three values a quality verdict may take. Comparability problems (case/skill/config
 * hashes differing in a way that makes the two runs not the same measurement) are handled
 * separately, by compareRuns refusing outright (IncompatibleRunsError) unless overridden — see
 * checkCompatibility's CompatibilityLevel for that assessment.
 */
export type RegressionStatus = 'PASS' | 'REVIEW' | 'FAIL';

export interface CaseScores {
  factualGrounding: number;
  jobRelevance: number;
  professionalTone: number;
  specificity: number;
  naturalness: number;
  conciseness: number;
  overall: number;
}

const SCORE_KEYS: (keyof CaseScores)[] = [
  'factualGrounding',
  'jobRelevance',
  'professionalTone',
  'specificity',
  'naturalness',
  'conciseness',
  'overall',
];

export interface CaseComparison {
  caseId: string;
  /** Absent for a case that is new in this run. */
  previous?: CaseScores;
  current: CaseScores;
  status: RegressionStatus;
  /** False when the scores were deliberately not set against each other, and `reasons` says why. */
  scoresCompared: boolean;
  regression: boolean;
  reasons: string[];
}

/** Every field here is read by compareRuns; see evals/config/eval-config.json's "regression.reviewThresholds". */
export interface RegressionReviewThresholds {
  overallDrop: number;
  factualGroundingDrop: number;
  jobRelevanceDrop: number;
  professionalToneDrop: number;
  specificityDrop: number;
  naturalnessDrop: number;
  concisenessDrop: number;
  tokenIncreasePercent: number;
}

export interface TokenComparison {
  previousTotal: number;
  currentTotal: number;
  /** null when no case could be compared, or the baseline reported no tokens. */
  increasePercent: number | null;
  /** How many cases the totals cover: shared, unedited cases only. */
  casesCompared: number;
  exceeded: boolean;
}

export interface RegressionReport {
  status: RegressionStatus;
  compatibility: CompatibilityReport;
  /** True when an INCOMPATIBLE comparison went ahead anyway because of an explicit override. */
  overridden: boolean;
  /** Only cases present in the current run — a case the baseline had but this run does not is reported in `missingFromCurrent` instead, never silently dropped. */
  caseComparisons: CaseComparison[];
  /** Averaged over the comparable cases only — never across the whole run. `deltaCasesCompared` says how many cases the figures cover. */
  overallDeltas: Record<keyof CaseScores, number>;
  deltaCasesCompared: number;
  tokens: TokenComparison;
  failingCases: string[];
  /** Baseline cases absent from this run. Always surfaced, never dropped. */
  missingFromCurrent: string[];
}

export interface CompareOptions {
  compareVariant?: Variant;
  /**
   * Compare anyway even though checkCompatibility found the two runs INCOMPATIBLE. Requires a
   * deliberate choice by the caller (the CLI's --allow-incompatible); the report still records
   * every finding plus the fact that it was overridden.
   */
  allowIncompatible?: boolean;
  /** Defaults to evals/config/eval-config.json's regression.reviewThresholds. Injectable so tests do not depend on the shipped file. */
  thresholds?: RegressionReviewThresholds;
}

/** Thrown by compareRuns when the two runs are not comparable and the caller did not override that. */
export class IncompatibleRunsError extends Error {
  constructor(
    public readonly compatibility: CompatibilityReport,
    public readonly variant: Variant
  ) {
    const blocking = compatibility.findings
      .filter((f) => f.level === 'INCOMPATIBLE')
      .map((f) => f.code)
      .join(', ');
    super(
      `Runs are not comparable for variant ${variant}: ${blocking}. ` +
        'Fix the difference, approve a new baseline, or pass allowIncompatible to compare anyway.'
    );
    this.name = 'IncompatibleRunsError';
  }
}

export function loadRun(filePath: string): EvalRunResult {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * `baselineDir` is where `approved-baseline.json` itself lives; `resultsDir` is only where a
 * legacy pointer baseline (see below) resolves the raw run it points at. They differ for
 * cover-letter-writer: the approved run is a full record of one candidate's actual letters, so it
 * lives in `reference/evals/results/`, the private folder the export already leaves out — never in
 * the tracked, exported `evals/results/`. Defaulting `baselineDir` to `resultsDir` keeps this
 * usable for a skill that has not made that split.
 */
export function findLatestApproved(resultsDir: string, baselineDir: string = resultsDir): string {
  const pointerPath = path.join(baselineDir, 'approved-baseline.json');
  if (!fs.existsSync(pointerPath)) {
    throw new Error(
      `No approved baseline found at ${pointerPath}. Run "npm run eval:approve" once you have a trusted run to lock in as the baseline.`
    );
  }
  const baseline = JSON.parse(fs.readFileSync(pointerPath, 'utf-8'));
  // A baseline is the approved run itself, so it travels with the skill. Baselines approved before
  // that were a pointer ({ "file": "<run>.json" }) to another run in this folder.
  if (Array.isArray(baseline.caseResults)) return pointerPath;
  return path.join(resultsDir, baseline.file);
}

function resultFor(results: CaseResult[], caseId: string, variant: Variant): CaseResult | undefined {
  return results.find((r) => r.caseId === caseId && r.variant === variant);
}

function scoresOf(result: CaseResult): CaseScores {
  return {
    factualGrounding: result.quality.factualGrounding,
    jobRelevance: result.quality.jobRelevance,
    professionalTone: result.quality.professionalTone,
    specificity: result.quality.specificity,
    naturalness: result.quality.naturalness,
    conciseness: result.quality.conciseness,
    overall: result.quality.overall,
  };
}

function avgScoreOver(results: CaseResult[], variant: Variant, caseIds: string[], key: keyof CaseScores): number {
  const wanted = new Set(caseIds);
  const values = results
    .filter((r) => r.variant === variant && wanted.has(r.caseId))
    .map((r) => r.quality[key]);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/**
 * Readable reasons for a hard-rule failure on the CURRENT result. The trigger itself is always
 * `!currentResult.deterministic.pass` — deterministic-checks.ts already aggregates every hard rule
 * (fabrication, forbidden claims/characters, missing required text, unfilled placeholders,
 * unoffered preferences, missing house-format) into that one boolean, so there is no separate
 * per-field threshold to configure here; this only expands it into a readable list.
 */
function hardFailureReasons(result: CaseResult): string[] {
  const d = result.deterministic;
  const reasons: string[] = [];
  for (const s of d.missingExactStrings) reasons.push(`missing required exact string: "${s}"`);
  for (const g of d.missingRequiredGroups) reasons.push(`missing required text (any of): ${g}`);
  for (const t of d.missingTerms) reasons.push(`missing required term: "${t}"`);
  for (const c of d.matchedForbiddenClaims) reasons.push(`forbidden claim present: "${c}"`);
  for (const c of d.matchedForbiddenCharacters) reasons.push(`forbidden character used: "${c}"`);
  for (const p of d.unfilledPlaceholders) reasons.push(`unfilled placeholder: "${p}"`);
  for (const t of d.unsupportedTechnologies) reasons.push(`technology not in the CV: "${t}"`);
  for (const n of d.unsupportedNumbers) reasons.push(`number not in the CV: "${n}"`);
  for (const id of d.phrasesWithoutCvSupport) reasons.push(`standard phrase not supported by the CV: "${id}"`);
  for (const id of d.unofferedPreferences) reasons.push(`job preference the advert never offered: "${id}"`);
  for (const s of d.missingLetterStructure) reasons.push(`missing house-format marker (any of): ${s}`);
  return reasons;
}

function exceedsReviewThreshold(previous: CaseScores, current: CaseScores, thresholds: RegressionReviewThresholds): boolean {
  return (
    previous.overall - current.overall > thresholds.overallDrop ||
    previous.factualGrounding - current.factualGrounding > thresholds.factualGroundingDrop ||
    previous.jobRelevance - current.jobRelevance > thresholds.jobRelevanceDrop ||
    previous.professionalTone - current.professionalTone > thresholds.professionalToneDrop ||
    previous.specificity - current.specificity > thresholds.specificityDrop ||
    previous.naturalness - current.naturalness > thresholds.naturalnessDrop ||
    previous.conciseness - current.conciseness > thresholds.concisenessDrop
  );
}

function compareTokens(
  previous: EvalRunResult,
  current: EvalRunResult,
  variant: Variant,
  comparablePairs: { previousId: string; currentId: string }[],
  thresholds: RegressionReviewThresholds
): TokenComparison {
  let previousTotal = 0;
  let currentTotal = 0;
  let casesCompared = 0;

  for (const pair of comparablePairs) {
    const previousResult = resultFor(previous.caseResults, pair.previousId, variant);
    const currentResult = resultFor(current.caseResults, pair.currentId, variant);
    if (!previousResult || !currentResult) continue;
    previousTotal += previousResult.output.usage?.totalTokens ?? 0;
    currentTotal += currentResult.output.usage?.totalTokens ?? 0;
    casesCompared += 1;
  }

  const increasePercent = previousTotal > 0 ? ((currentTotal - previousTotal) / previousTotal) * 100 : null;

  return {
    previousTotal,
    currentTotal,
    increasePercent,
    casesCompared,
    exceeded: increasePercent !== null && increasePercent > thresholds.tokenIncreasePercent,
  };
}

/**
 * Compares a run against a baseline, after establishing whether they may be compared at all.
 *
 * Two things are deliberate here. Hard guardrail checks run on the current result regardless of
 * comparability, because a missing required string is wrong on its own terms and needs no baseline.
 * Score comparisons do not run when the metadata says the scores are not the same measurement —
 * that is the difference between reporting a number and reporting a meaningful one.
 *
 * Throws IncompatibleRunsError when checkCompatibility finds the runs INCOMPATIBLE, unless
 * `options.allowIncompatible` is set — this is the "refuse ... when runs are not comparable"
 * requirement. A merely WARNING-level compatibility issue does not block the comparison; it is
 * still carried on the returned report's `compatibility` field for the caller to display
 * prominently ("clearly warn").
 */
export function compareRuns(previous: EvalRunResult, current: EvalRunResult, options: CompareOptions = {}): RegressionReport {
  const variant = options.compareVariant ?? 'B';
  const thresholds = options.thresholds ?? (evalConfig.regression.reviewThresholds as RegressionReviewThresholds);
  const allowIncompatible = options.allowIncompatible ?? false;

  const compatibility = checkCompatibility(previous, current, variant);

  if (compatibility.level === 'INCOMPATIBLE' && !allowIncompatible) {
    throw new IncompatibleRunsError(compatibility, variant);
  }

  const { caseSet } = compatibility;
  const renamedByCurrentId = new Map(caseSet.renamed.map((r) => [r.currentId, r.previousId]));
  const editedIds = new Set(caseSet.edited);
  const addedIds = new Set(caseSet.added);

  // Baseline order first so a case's report position is stable across runs, then cases new to this run.
  const orderedIds = [...caseSet.shared, ...caseSet.renamed.map((r) => r.currentId), ...caseSet.added];

  const caseComparisons: CaseComparison[] = [];
  const failingCases: string[] = [];
  const comparablePairs: { previousId: string; currentId: string }[] = [];

  for (const caseId of orderedIds) {
    const currentResult = resultFor(current.caseResults, caseId, variant);
    if (!currentResult) continue; // orderedIds is built only from ids the current run actually has for this variant

    const previousId = renamedByCurrentId.get(caseId) ?? caseId;
    const previousResult = resultFor(previous.caseResults, previousId, variant);

    const reasons = hardFailureReasons(currentResult);
    let status: RegressionStatus = reasons.length > 0 ? 'FAIL' : 'PASS';

    if (renamedByCurrentId.has(caseId)) {
      reasons.push(`renamed from "${previousId}"; baseline scores carried across`);
    }

    let scoresCompared = false;

    if (!previousResult) {
      reasons.push(
        addedIds.has(caseId)
          ? 'new case, so there is no baseline score to compare against'
          : `the baseline has no variant ${variant} result for this case, so its scores were not compared`
      );
    } else if (editedIds.has(caseId)) {
      reasons.push('case content changed under the same id, so its scores were not compared');
    } else if (!compatibility.scoresComparable) {
      reasons.push('scores not compared: the evaluator model, provider or rubric differs between runs');
    } else {
      scoresCompared = true;
      comparablePairs.push({ previousId, currentId: caseId });
      if (status !== 'FAIL' && exceedsReviewThreshold(scoresOf(previousResult), scoresOf(currentResult), thresholds)) {
        status = 'REVIEW';
        reasons.push('quality score dropped beyond review threshold');
      }
    }

    if (status === 'FAIL') failingCases.push(caseId);

    caseComparisons.push({
      caseId,
      previous: previousResult ? scoresOf(previousResult) : undefined,
      current: scoresOf(currentResult),
      status,
      scoresCompared,
      regression: status !== 'PASS',
      reasons,
    });
  }

  const tokens = compareTokens(previous, current, variant, comparablePairs, thresholds);

  const previousIds = comparablePairs.map((p) => p.previousId);
  const currentIds = comparablePairs.map((p) => p.currentId);
  const delta = (key: keyof CaseScores) =>
    avgScoreOver(current.caseResults, variant, currentIds, key) - avgScoreOver(previous.caseResults, variant, previousIds, key);

  const overallDeltas = Object.fromEntries(SCORE_KEYS.map((key) => [key, delta(key)])) as Record<keyof CaseScores, number>;

  const status: RegressionStatus =
    failingCases.length > 0 ? 'FAIL' : caseComparisons.some((c) => c.status === 'REVIEW') || tokens.exceeded ? 'REVIEW' : 'PASS';

  return {
    status,
    compatibility,
    overridden: allowIncompatible && compatibility.level === 'INCOMPATIBLE',
    caseComparisons,
    overallDeltas,
    deltaCasesCompared: comparablePairs.length,
    tokens,
    failingCases,
    missingFromCurrent: [...caseSet.removed],
  };
}

export type { CompatibilityLevel, CompatibilityReport };
