import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DeterministicCheckResult } from '../src/deterministic-checks';
import { compareRuns, findLatestApproved, IncompatibleRunsError, type RegressionReviewThresholds } from './regression';
import type { CaseResult, EvalRunResult, QualityScore } from './types';

function makeDeterministic(overrides: Partial<DeterministicCheckResult> = {}): DeterministicCheckResult {
  return {
    pass: true,
    missingExactStrings: [],
    missingRequiredGroups: [],
    missingTerms: [],
    matchedForbiddenClaims: [],
    matchedForbiddenCharacters: [],
    unfilledPlaceholders: [],
    unsupportedTechnologies: [],
    unsupportedNumbers: [],
    missingLetterStructure: [],
    openingRestatesAdvert: [],
    phrasesWithoutCvSupport: [],
    usedStandardPhrases: [],
    untriggeredPhrases: [],
    usedPreferences: [],
    unofferedPreferences: [],
    wordCount: 250,
    wordCountOutOfRange: false,
    matchedCliches: [],
    repeatedSentenceOpeners: [],
    ...overrides,
  };
}

function makeQuality(overrides: Partial<QualityScore> = {}): QualityScore {
  return {
    factualGrounding: 5,
    jobRelevance: 5,
    professionalTone: 5,
    specificity: 5,
    naturalness: 5,
    conciseness: 5,
    overall: 5,
    justification: '',
    problems: [],
    missingExpectedFacts: [],
    unsupportedClaims: [],
    ownershipInflationNotes: [],
    unofferedBenefitNotes: [],
    ...overrides,
  };
}

function makeCaseResult(overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    caseId: 'golden-001',
    category: 'ownership-level',
    variant: 'B',
    output: { variant: 'B', caseId: 'golden-001', text: 'A letter.', requestCount: 1, usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 } },
    deterministic: makeDeterministic(),
    quality: makeQuality(),
    caseHash: 'hash-golden-001',
    ...overrides,
  };
}

function makeRun(overrides: Partial<EvalRunResult> = {}): EvalRunResult {
  return {
    schemaVersion: 5,
    skillName: 'cover-letter-writer',
    skillVersion: '0.1.0',
    dataset: 'golden',
    versions: {
      skill: { name: 'cover-letter-writer', version: '0.1.0', hash: 'skill-hash-1' },
      prompts: {},
      datasets: {},
    },
    timestamp: '2026-01-01T00:00:00.000Z',
    gitCommit: 'a'.repeat(40),
    gitDirty: false,
    runId: null,
    skillHash: 'skill-hash-1',
    caseInputHash: 'case-input-hash-1',
    configHash: 'config-hash-1',
    evaluatorPromptHash: 'evaluator-prompt-hash-1',
    modelRoles: {
      generator: { provider: 'anthropic', model: 'claude-sonnet-5' },
      validator: { provider: 'anthropic', model: 'claude-sonnet-5' },
      reviser: { provider: 'anthropic', model: 'claude-sonnet-5' },
      evaluator: { provider: 'anthropic', model: 'claude-opus-5' },
      pairwiseJudge: { provider: 'anthropic', model: 'claude-opus-5' },
    },
    benchmarkVersion: 'golden-v1',
    variants: ['B'],
    caseResults: [makeCaseResult()],
    pairwiseResults: [],
    aggregates: [],
    pairwiseAggregates: [],
    totals: { requestCount: 2, totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 } },
    ...overrides,
  };
}

const THRESHOLDS: RegressionReviewThresholds = {
  overallDrop: 0.5,
  factualGroundingDrop: 0.1,
  jobRelevanceDrop: 0.5,
  professionalToneDrop: 0.5,
  specificityDrop: 0.5,
  naturalnessDrop: 0.5,
  concisenessDrop: 0.5,
  tokenIncreasePercent: 25,
};

describe('compareRuns — PASS', () => {
  it('passes when nothing changed', () => {
    const previous = makeRun();
    const current = makeRun({ timestamp: '2026-01-02T00:00:00.000Z' });

    const report = compareRuns(previous, current, { thresholds: THRESHOLDS });

    expect(report.status).toBe('PASS');
    expect(report.caseComparisons[0].status).toBe('PASS');
    expect(report.caseComparisons[0].regression).toBe(false);
  });

  it('passes a brand-new case with no baseline to compare against', () => {
    const previous = makeRun({ caseResults: [] });
    const current = makeRun({ caseResults: [makeCaseResult()] });

    const report = compareRuns(previous, current, { thresholds: THRESHOLDS });

    expect(report.status).toBe('PASS');
    expect(report.caseComparisons[0].scoresCompared).toBe(false);
    expect(report.caseComparisons[0].reasons).toContain('new case, so there is no baseline score to compare against');
  });
});

describe('compareRuns — FAIL for hard-rule regressions', () => {
  it('fails a case whose current result breaks a deterministic hard rule, independent of its scores', () => {
    const previous = makeRun();
    const current = makeRun({
      caseResults: [
        makeCaseResult({
          deterministic: makeDeterministic({ pass: false, matchedForbiddenClaims: ['led the launch'] }),
          quality: makeQuality(), // perfect scores — must not paper over the hard-rule break
        }),
      ],
    });

    const report = compareRuns(previous, current, { thresholds: THRESHOLDS });

    expect(report.status).toBe('FAIL');
    expect(report.caseComparisons[0].status).toBe('FAIL');
    expect(report.caseComparisons[0].reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('forbidden claim present: "led the launch"')])
    );
    expect(report.failingCases).toEqual(['golden-001']);
  });

  it('reports the overall status as FAIL when any case fails, even if others pass', () => {
    const previous = makeRun({
      caseResults: [makeCaseResult({ caseId: 'golden-001' }), makeCaseResult({ caseId: 'golden-002', caseHash: 'hash-2' })],
    });
    const current = makeRun({
      caseResults: [
        makeCaseResult({ caseId: 'golden-001' }),
        makeCaseResult({ caseId: 'golden-002', caseHash: 'hash-2', deterministic: makeDeterministic({ pass: false, unsupportedNumbers: ['42'] }) }),
      ],
    });

    const report = compareRuns(previous, current, { thresholds: THRESHOLDS });

    expect(report.status).toBe('FAIL');
    expect(report.caseComparisons.find((c) => c.caseId === 'golden-001')?.status).toBe('PASS');
    expect(report.caseComparisons.find((c) => c.caseId === 'golden-002')?.status).toBe('FAIL');
  });
});

describe('compareRuns — REVIEW for quality drops beyond threshold', () => {
  it('flags a case whose score dropped beyond the configured threshold', () => {
    const previous = makeRun({ caseResults: [makeCaseResult({ quality: makeQuality({ factualGrounding: 5 }) })] });
    const current = makeRun({ caseResults: [makeCaseResult({ quality: makeQuality({ factualGrounding: 4 }) })] }); // drop of 1 > 0.1 threshold

    const report = compareRuns(previous, current, { thresholds: THRESHOLDS });

    expect(report.status).toBe('REVIEW');
    expect(report.caseComparisons[0].status).toBe('REVIEW');
    expect(report.caseComparisons[0].reasons).toContain('quality score dropped beyond review threshold');
  });

  it('does not flag a drop within the configured threshold', () => {
    const previous = makeRun({ caseResults: [makeCaseResult({ quality: makeQuality({ jobRelevance: 5 }) })] });
    const current = makeRun({ caseResults: [makeCaseResult({ quality: makeQuality({ jobRelevance: 4.6 }) })] }); // drop of 0.4 < 0.5 threshold

    const report = compareRuns(previous, current, { thresholds: THRESHOLDS });

    expect(report.status).toBe('PASS');
  });

  it('flags REVIEW when token usage increases beyond the configured percentage', () => {
    const previous = makeRun({
      caseResults: [makeCaseResult({ output: { variant: 'B', caseId: 'golden-001', text: 'x', requestCount: 1, usage: { inputTokens: 100, outputTokens: 0, totalTokens: 100 } } })],
    });
    const current = makeRun({
      caseResults: [makeCaseResult({ output: { variant: 'B', caseId: 'golden-001', text: 'x', requestCount: 1, usage: { inputTokens: 200, outputTokens: 0, totalTokens: 200 } } })],
    });

    const report = compareRuns(previous, current, { thresholds: THRESHOLDS });

    expect(report.tokens.exceeded).toBe(true);
    expect(report.status).toBe('REVIEW');
  });

  it('FAIL still wins over REVIEW when both are present', () => {
    const previous = makeRun({
      caseResults: [makeCaseResult({ caseId: 'golden-001' }), makeCaseResult({ caseId: 'golden-002', caseHash: 'hash-2' })],
    });
    const current = makeRun({
      caseResults: [
        makeCaseResult({ caseId: 'golden-001', quality: makeQuality({ factualGrounding: 4 }) }), // REVIEW
        makeCaseResult({ caseId: 'golden-002', caseHash: 'hash-2', deterministic: makeDeterministic({ pass: false, matchedForbiddenCharacters: ['—'] }) }), // FAIL
      ],
    });

    const report = compareRuns(previous, current, { thresholds: THRESHOLDS });

    expect(report.status).toBe('FAIL');
  });
});

describe('compareRuns — refuses when runs are not comparable', () => {
  it('throws IncompatibleRunsError when the evaluator model changed, rather than silently comparing', () => {
    const previous = makeRun();
    const current = makeRun({
      modelRoles: { ...previous.modelRoles, evaluator: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' } },
    });

    expect(() => compareRuns(previous, current, { thresholds: THRESHOLDS })).toThrow(IncompatibleRunsError);
  });

  it('throws when a case was removed from the baseline, rather than silently shrinking coverage', () => {
    const previous = makeRun({
      caseResults: [makeCaseResult({ caseId: 'golden-001' }), makeCaseResult({ caseId: 'golden-002', caseHash: 'hash-2' })],
    });
    const current = makeRun({ caseResults: [makeCaseResult({ caseId: 'golden-001' })] });

    expect(() => compareRuns(previous, current, { thresholds: THRESHOLDS })).toThrow(IncompatibleRunsError);
  });

  it('proceeds and clearly marks the report as overridden when allowIncompatible is set', () => {
    const previous = makeRun();
    const current = makeRun({
      modelRoles: { ...previous.modelRoles, evaluator: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' } },
    });

    const report = compareRuns(previous, current, { thresholds: THRESHOLDS, allowIncompatible: true });

    expect(report.overridden).toBe(true);
    expect(report.compatibility.level).toBe('INCOMPATIBLE');
    // Scores are still not compared even under the override — the override lets the comparison
    // proceed and be reported, it does not manufacture a meaningful score delta.
    expect(report.caseComparisons[0].scoresCompared).toBe(false);
  });

  it('never proceeds past the throw to compute case comparisons when not overridden', () => {
    const previous = makeRun();
    const current = makeRun({ configHash: 'irrelevant', skillHash: 'irrelevant-too', caseResults: [] });

    // caseResults: [] on current makes the shared golden-001 case "removed" -> INCOMPATIBLE -> throw.
    let thrown: unknown;
    try {
      compareRuns(previous, current, { thresholds: THRESHOLDS });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(IncompatibleRunsError);
    expect((thrown as IncompatibleRunsError).compatibility.caseSet.removed).toEqual(['golden-001']);
  });

  it('does not throw for a merely WARNING-level difference (e.g. an added case)', () => {
    const previous = makeRun();
    const current = makeRun({ caseResults: [makeCaseResult(), makeCaseResult({ caseId: 'golden-002', caseHash: 'hash-2' })] });

    expect(() => compareRuns(previous, current, { thresholds: THRESHOLDS })).not.toThrow();
  });
});

describe('compareRuns — renamed cases carry their baseline scores across', () => {
  it('compares a renamed case (same content hash, new id) against its previous score', () => {
    const previous = makeRun({ caseResults: [makeCaseResult({ caseId: 'golden-old-name', caseHash: 'same-hash', quality: makeQuality({ overall: 5 }) })] });
    const current = makeRun({ caseResults: [makeCaseResult({ caseId: 'golden-new-name', caseHash: 'same-hash', quality: makeQuality({ overall: 4 }) })] });

    const report = compareRuns(previous, current, { thresholds: THRESHOLDS });

    expect(report.caseComparisons[0].caseId).toBe('golden-new-name');
    expect(report.caseComparisons[0].scoresCompared).toBe(true);
    expect(report.caseComparisons[0].previous?.overall).toBe(5);
    expect(report.caseComparisons[0].reasons).toEqual(expect.arrayContaining([expect.stringContaining('renamed from "golden-old-name"')]));
  });
});

describe('findLatestApproved', () => {
  // The approved baseline is a full record of real candidate letters, so run-regression.ts writes
  // and reads it from a separate, private baselineDir (reference/evals/results/), never from the
  // tracked, exported resultsDir (evals/results/) that raw runs live in.
  function makeDirs(): { resultsDir: string; baselineDir: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-'));
    const resultsDir = path.join(root, 'evals', 'results');
    const baselineDir = path.join(root, 'reference', 'evals', 'results');
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.mkdirSync(baselineDir, { recursive: true });
    return { resultsDir, baselineDir };
  }

  it('reads the pointer from baselineDir, not resultsDir, when they differ', () => {
    const { resultsDir, baselineDir } = makeDirs();
    const run = makeRun();
    fs.writeFileSync(path.join(baselineDir, 'approved-baseline.json'), JSON.stringify(run));

    expect(findLatestApproved(resultsDir, baselineDir)).toBe(path.join(baselineDir, 'approved-baseline.json'));
  });

  it('throws, rather than silently falling back to resultsDir, when baselineDir has no approved baseline', () => {
    const { resultsDir, baselineDir } = makeDirs();
    fs.writeFileSync(path.join(resultsDir, 'approved-baseline.json'), JSON.stringify(makeRun()));

    expect(() => findLatestApproved(resultsDir, baselineDir)).toThrow(/No approved baseline found/);
  });

  it('defaults baselineDir to resultsDir for a caller that has not split them', () => {
    const { resultsDir } = makeDirs();
    fs.writeFileSync(path.join(resultsDir, 'approved-baseline.json'), JSON.stringify(makeRun()));

    expect(findLatestApproved(resultsDir)).toBe(path.join(resultsDir, 'approved-baseline.json'));
  });

  it('still resolves a legacy pointer baseline against resultsDir, not baselineDir', () => {
    const { resultsDir, baselineDir } = makeDirs();
    fs.writeFileSync(path.join(resultsDir, 'a-real-run.json'), JSON.stringify(makeRun()));
    fs.writeFileSync(path.join(baselineDir, 'approved-baseline.json'), JSON.stringify({ file: 'a-real-run.json' }));

    expect(findLatestApproved(resultsDir, baselineDir)).toBe(path.join(resultsDir, 'a-real-run.json'));
  });
});

describe('compareRuns — deltas and missing coverage', () => {
  it('reports missingFromCurrent for a baseline case dropped, without throwing, once overridden', () => {
    const previous = makeRun({
      caseResults: [makeCaseResult({ caseId: 'golden-001' }), makeCaseResult({ caseId: 'golden-002', caseHash: 'hash-2' })],
    });
    const current = makeRun({ caseResults: [makeCaseResult({ caseId: 'golden-001' })] });

    const report = compareRuns(previous, current, { thresholds: THRESHOLDS, allowIncompatible: true });

    expect(report.missingFromCurrent).toEqual(['golden-002']);
    expect(report.caseComparisons.map((c) => c.caseId)).toEqual(['golden-001']);
  });

  it('computes overallDeltas only over genuinely comparable cases', () => {
    const previous = makeRun({ caseResults: [makeCaseResult({ quality: makeQuality({ overall: 3 }) })] });
    const current = makeRun({ caseResults: [makeCaseResult({ quality: makeQuality({ overall: 5 }) })] });

    const report = compareRuns(previous, current, { thresholds: THRESHOLDS });

    expect(report.deltaCasesCompared).toBe(1);
    expect(report.overallDeltas.overall).toBeCloseTo(2);
  });
});
