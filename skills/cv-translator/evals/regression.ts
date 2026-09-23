import fs from 'node:fs';
import path from 'node:path';
import { checkCompatibility, type CompatibilityLevel, type CompatibilityReport } from '@skills/framework/evals/regression-compatibility';
import type { CaseResult, EvalRunResult, Variant } from './types';
import evalConfig from './config/eval-config.json';

/**
 * PASS/REVIEW/FAIL are verdicts about quality. INCOMPATIBLE is a verdict about the comparison
 * itself: the two runs are not measuring the same thing, so no quality verdict is available. It is
 * reported rather than being collapsed into PASS, which is what "silently appear comparable" means.
 */
export type RegressionStatus = 'PASS' | 'REVIEW' | 'FAIL' | 'INCOMPATIBLE';

export interface CaseScores {
  naturalness: number;
  faithfulness: number;
  cvQuality: number;
  overall: number;
}

export interface CaseComparison {
  caseId: string;
  /** Absent for a case that is new in this run. */
  previous?: CaseScores;
  /** Absent for a case that the baseline had and this run does not. */
  current?: CaseScores;
  status: RegressionStatus;
  /** False when the scores were deliberately not set against each other, and `reasons` says why. */
  scoresCompared: boolean;
  regression: boolean;
  reasons: string[];
}

/** Every field here is read by compareRuns; see evals/config/eval-config.json. */
export interface RegressionThresholds {
  hardFail: {
    forbiddenClaimMatches: number;
    unsupportedClaims: number;
    missingRequiredStrings: number;
    forbiddenCharacterMatches: number;
    structuralMismatches: number;
    /** How many failing cases the suite tolerates before the overall result is FAIL. */
    goldenFailures: number;
  };
  reviewThresholds: {
    overallScoreDrop: number;
    naturalnessDrop: number;
    faithfulnessDrop: number;
    cvQualityDrop: number;
    tokenIncreasePercent: number;
  };
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
  comparability: CompatibilityLevel;
  compatibility: CompatibilityReport;
  /** True when an incompatible comparison went ahead because of an explicit override. */
  overridden: boolean;
  caseComparisons: CaseComparison[];
  /**
   * Averaged over the comparable cases only — never across the whole run. Averaging a baseline that
   * contains a removed case against a run that contains an added one would compare two different
   * case sets and present the result as a single delta. `deltaCasesCompared` says how many cases
   * the figures cover.
   */
  overallDeltas: Record<'overall' | 'naturalness' | 'faithfulness' | 'cvQuality', number>;
  deltaCasesCompared: number;
  tokens: TokenComparison;
  goldenFailures: string[];
  /** Baseline cases absent from this run. Always surfaced, never dropped. */
  missingFromCurrent: string[];
}

export interface CompareOptions {
  compareVariant?: Variant;
  /**
   * Compare scores even when the metadata says they are not the same measurement. Requires a
   * deliberate choice by the caller (the CLI's --allow-incompatible), and the report still records
   * every finding plus the fact that it was overridden.
   */
  allowIncompatible?: boolean;
  /** Defaults to evals/config/eval-config.json. Injectable so tests do not depend on the shipped file. */
  thresholds?: RegressionThresholds;
}

/** A case that exists and is comparable on both sides. The ids differ when the case was renamed. */
interface ComparablePair {
  previousId: string;
  currentId: string;
}

export function loadRun(filePath: string): EvalRunResult {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * `baselineDir` is where `approved-baseline.json` itself lives; `resultsDir` is only where a
 * legacy pointer baseline (see below) resolves the raw run it points at. They differ here: the
 * approved run is a full record of real, translated CV text, so it lives in `reference/evals/results/`,
 * the private folder the export already leaves out — never in the tracked, exported `evals/results/`.
 * Defaulting `baselineDir` to `resultsDir` keeps this usable for a skill that has not made that split.
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
    naturalness: result.quality.naturalness,
    faithfulness: result.quality.faithfulness,
    cvQuality: result.quality.cvQuality,
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

/** Hard guardrail breaches in one result, each gated by its own configured tolerance. */
function hardFailureReasons(result: CaseResult, thresholds: RegressionThresholds): string[] {
  const { hardFail } = thresholds;
  const reasons: string[] = [];

  if (result.deterministic.matchedForbiddenClaims.length > hardFail.forbiddenClaimMatches) {
    reasons.push('forbidden claim detected (possible hallucination)');
  }
  if (result.quality.unsupportedClaims.length > hardFail.unsupportedClaims) {
    reasons.push('evaluator flagged unsupported claims');
  }
  if (result.deterministic.missingExactStrings.length > hardFail.missingRequiredStrings) {
    reasons.push('required exact string (date/company/product/metric) missing');
  }
  if (result.deterministic.matchedForbiddenCharacters.length > hardFail.forbiddenCharacterMatches) {
    reasons.push('forbidden character used (e.g. em/en dash)');
  }

  const structuralMismatches =
    (result.deterministic.boldMarkerMismatch ? 1 : 0) + (result.deterministic.paragraphBreakMismatch ? 1 : 0);
  if (structuralMismatches > hardFail.structuralMismatches) {
    reasons.push('structural formatting not preserved (bold markers or paragraph/entry structure)');
  }

  return reasons;
}

function exceedsReviewThreshold(previous: CaseScores, current: CaseScores, thresholds: RegressionThresholds): boolean {
  const { reviewThresholds } = thresholds;
  return (
    previous.overall - current.overall > reviewThresholds.overallScoreDrop ||
    previous.naturalness - current.naturalness > reviewThresholds.naturalnessDrop ||
    previous.faithfulness - current.faithfulness > reviewThresholds.faithfulnessDrop ||
    previous.cvQuality - current.cvQuality > reviewThresholds.cvQualityDrop
  );
}

function compareTokens(
  previous: EvalRunResult,
  current: EvalRunResult,
  variant: Variant,
  comparablePairs: ComparablePair[],
  thresholds: RegressionThresholds
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
    exceeded: increasePercent !== null && increasePercent > thresholds.reviewThresholds.tokenIncreasePercent,
  };
}

/**
 * Compares a run against a baseline, after establishing whether they may be compared at all.
 *
 * Two things are deliberate here. Hard guardrail checks run on the current result regardless of
 * comparability, because a missing required string is wrong on its own terms and needs no baseline.
 * Score comparisons do not run when the metadata says the scores are not the same measurement —
 * that is the difference between reporting a number and reporting a meaningful one.
 */
export function compareRuns(
  previous: EvalRunResult,
  current: EvalRunResult,
  options: CompareOptions = {}
): RegressionReport {
  const variant = options.compareVariant ?? 'B';
  const thresholds = options.thresholds ?? (evalConfig.regression as RegressionThresholds);
  const allowIncompatible = options.allowIncompatible ?? false;

  const compatibility = checkCompatibility(previous, current, variant);
  const { caseSet } = compatibility;
  const addedIds = new Set(caseSet.added);
  const renamedByCurrentId = new Map(caseSet.renamed.map((r) => [r.currentId, r.previousId]));
  const editedIds = new Set(caseSet.edited);

  const scoresComparable = compatibility.scoresComparable || allowIncompatible;
  const blockingCodes = compatibility.findings
    .filter((f) => f.level === 'INCOMPATIBLE')
    .map((f) => f.code);

  const caseComparisons: CaseComparison[] = [];
  const goldenFailures: string[] = [];
  const comparablePairs: ComparablePair[] = [];

  // Baseline order first so a removed case keeps its place in the report, then cases new to this run.
  const orderedIds = [
    ...caseSet.shared,
    ...caseSet.removed,
    ...caseSet.renamed.map((r) => r.currentId),
    ...caseSet.added,
  ];

  for (const caseId of orderedIds) {
    const currentResult = resultFor(current.caseResults, caseId, variant);

    // A case the baseline covered and this run does not. Reported as its own state rather than
    // being skipped, so shrinking coverage cannot look like a clean comparison.
    if (!currentResult) {
      const previousResult = resultFor(previous.caseResults, caseId, variant);
      caseComparisons.push({
        caseId,
        previous: previousResult ? scoresOf(previousResult) : undefined,
        current: undefined,
        status: 'INCOMPATIBLE',
        scoresCompared: false,
        regression: true,
        reasons: ['present in the baseline but absent from this run, so it was not checked'],
      });
      continue;
    }

    const previousId = renamedByCurrentId.get(caseId) ?? caseId;
    const previousResult = resultFor(previous.caseResults, previousId, variant);

    const reasons = hardFailureReasons(currentResult, thresholds);
    let status: RegressionStatus = reasons.length > 0 ? 'FAIL' : 'PASS';

    if (renamedByCurrentId.has(caseId)) {
      reasons.push(`renamed from "${previousId}"; baseline scores carried across`);
    }

    let scoresCompared = false;

    if (!previousResult) {
      // Telling these two apart matters: a new case has no history yet, whereas a baseline that
      // never ran this variant means the comparison is incomplete for a different reason.
      reasons.push(
        addedIds.has(caseId)
          ? 'new case, so there is no baseline score to compare against'
          : `the baseline has no variant ${variant} result for this case, so its scores were not compared`
      );
    } else if (editedIds.has(caseId)) {
      reasons.push('case content changed under the same id, so its scores were not compared');
      if (status !== 'FAIL') status = 'INCOMPATIBLE';
    } else if (!scoresComparable) {
      reasons.push(`scores not compared (${blockingCodes.join(', ')})`);
      if (status !== 'FAIL') status = 'INCOMPATIBLE';
    } else {
      scoresCompared = true;
      comparablePairs.push({ previousId, currentId: caseId });
      if (status !== 'FAIL' && exceedsReviewThreshold(scoresOf(previousResult), scoresOf(currentResult), thresholds)) {
        status = 'REVIEW';
        reasons.push('quality score dropped beyond review threshold');
      }
    }

    if (status === 'FAIL') {
      goldenFailures.push(caseId);
    }

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
    avgScoreOver(current.caseResults, variant, currentIds, key) -
    avgScoreOver(previous.caseResults, variant, previousIds, key);

  const overallDeltas = {
    overall: delta('overall'),
    naturalness: delta('naturalness'),
    faithfulness: delta('faithfulness'),
    cvQuality: delta('cvQuality'),
  };

  const incompatible = compatibility.level === 'INCOMPATIBLE' && !allowIncompatible;

  const status: RegressionStatus =
    goldenFailures.length > thresholds.hardFail.goldenFailures
      ? 'FAIL'
      : incompatible
      ? 'INCOMPATIBLE'
      : caseComparisons.some((c) => c.status === 'REVIEW') || tokens.exceeded
      ? 'REVIEW'
      : 'PASS';

  return {
    status,
    comparability: compatibility.level,
    compatibility,
    overridden: allowIncompatible && compatibility.level === 'INCOMPATIBLE',
    caseComparisons,
    overallDeltas,
    deltaCasesCompared: comparablePairs.length,
    tokens,
    goldenFailures,
    missingFromCurrent: [...caseSet.removed],
  };
}

/** Exposed so the CLI can name a renamed case's previous id without re-deriving the diff. */
export type { CompatibilityLevel, CompatibilityReport };
