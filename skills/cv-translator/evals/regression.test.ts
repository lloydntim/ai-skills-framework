import { describe, expect, it } from 'vitest';
import { compareRuns, type RegressionThresholds } from './regression';
import { makeChangedSkillRun, makeRun, type CaseSpec } from './test-support/make-run';

/** Stated in full so a test never depends on the shipped eval-config.json values. */
const THRESHOLDS: RegressionThresholds = {
  hardFail: {
    forbiddenClaimMatches: 0,
    unsupportedClaims: 0,
    missingRequiredStrings: 0,
    forbiddenCharacterMatches: 0,
    structuralMismatches: 0,
    goldenFailures: 0,
  },
  reviewThresholds: {
    overallScoreDrop: 0.2,
    naturalnessDrop: 0.2,
    faithfulnessDrop: 0.1,
    cvQualityDrop: 0.2,
    tokenIncreasePercent: 25,
  },
};

const THREE_CASES = [{ id: 'golden-001' }, { id: 'golden-002' }, { id: 'golden-003' }];

function compare(previous: Parameters<typeof compareRuns>[0], current: Parameters<typeof compareRuns>[1], options = {}) {
  return compareRuns(previous, current, { thresholds: THRESHOLDS, ...options });
}

function caseNamed(report: ReturnType<typeof compareRuns>, caseId: string) {
  return report.caseComparisons.find((c) => c.caseId === caseId)!;
}

describe('the same case set', () => {
  const baseline = makeRun({ cases: THREE_CASES });
  const current = makeChangedSkillRun({ cases: THREE_CASES });

  it('passes and compares every case', () => {
    const report = compare(baseline, current);

    expect(report.status).toBe('PASS');
    expect(report.comparability).toBe('COMPATIBLE');
    expect(report.caseComparisons).toHaveLength(3);
    expect(report.caseComparisons.every((c) => c.scoresCompared)).toBe(true);
  });

  it('reports nothing missing', () => {
    expect(compare(baseline, current).missingFromCurrent).toEqual([]);
  });

  it('averages the deltas over the comparable cases only', () => {
    // The baseline's removed case scored 4.5 and the added case scores 2.0. Averaging across whole
    // runs would mix the two different case sets into one delta; only the shared cases may be used.
    const report = compare(
      makeRun({ cases: [{ id: 'golden-001', overall: 4.5 }, { id: 'golden-002', overall: 4.5 }] }),
      makeChangedSkillRun({ cases: [{ id: 'golden-001', overall: 4.5 }, { id: 'golden-009', overall: 2.0 }] })
    );

    expect(report.deltaCasesCompared).toBe(1);
    expect(report.overallDeltas.overall).toBeCloseTo(0, 10);
  });
});

describe('an added case', () => {
  const report = compare(
    makeRun({ cases: THREE_CASES }),
    makeChangedSkillRun({ cases: [...THREE_CASES, { id: 'golden-004' }] })
  );

  it('still passes, with the comparison flagged as carrying warnings', () => {
    expect(report.status).toBe('PASS');
    expect(report.comparability).toBe('WARNING');
  });

  it('checks the new case on its own merits and says it has no baseline', () => {
    const added = caseNamed(report, 'golden-004');

    expect(added.scoresCompared).toBe(false);
    expect(added.previous).toBeUndefined();
    expect(added.current).toBeDefined();
    expect(added.reasons.join(' ')).toContain('no baseline score');
  });
});

describe('a removed case', () => {
  const baseline = makeRun({ cases: THREE_CASES });
  const current = makeChangedSkillRun({ cases: [{ id: 'golden-001' }, { id: 'golden-003' }] });
  const report = compare(baseline, current);

  it('blocks the comparison instead of passing on a smaller suite', () => {
    expect(report.status).toBe('INCOMPATIBLE');
  });

  it('never lets the removed case disappear from the comparison', () => {
    expect(report.missingFromCurrent).toEqual(['golden-002']);
    expect(report.caseComparisons.map((c) => c.caseId)).toContain('golden-002');
  });

  it('shows the removed case with its baseline score and no current score', () => {
    const removed = caseNamed(report, 'golden-002');

    expect(removed.status).toBe('INCOMPATIBLE');
    expect(removed.previous?.overall).toBeCloseTo(4.5, 10);
    expect(removed.current).toBeUndefined();
    expect(removed.reasons.join(' ')).toContain('absent from this run');
  });
});

describe('a changed evaluator', () => {
  const baseline = makeRun({ cases: THREE_CASES });
  const current = makeChangedSkillRun({ cases: THREE_CASES, evaluatorModel: 'claude-opus-5' });

  it('does not compare the scores', () => {
    const report = compare(baseline, current);

    expect(report.status).toBe('INCOMPATIBLE');
    expect(report.caseComparisons.every((c) => c.scoresCompared === false)).toBe(true);
    expect(caseNamed(report, 'golden-001').reasons.join(' ')).toContain('EVALUATOR_MODEL_CHANGED');
  });

  it('compares them when explicitly overridden, and records that it did', () => {
    const report = compare(baseline, current, { allowIncompatible: true });

    expect(report.overridden).toBe(true);
    expect(report.comparability).toBe('INCOMPATIBLE');
    expect(report.caseComparisons.every((c) => c.scoresCompared)).toBe(true);
    expect(report.status).toBe('PASS');
  });

  it('makes no token comparison while the scores are not comparable', () => {
    expect(compare(baseline, current).tokens.casesCompared).toBe(0);
  });
});

describe('a changed skill', () => {
  it('is the ordinary case and compares cleanly', () => {
    const report = compare(makeRun({ cases: THREE_CASES }), makeChangedSkillRun({ cases: THREE_CASES }));

    expect(report.status).toBe('PASS');
    expect(report.comparability).toBe('COMPATIBLE');
    expect(report.compatibility.findings.map((f) => f.code)).toContain('SKILL_CHANGED');
  });
});

describe('a changed eval configuration', () => {
  it('warns but still compares the scores', () => {
    const report = compare(
      makeRun({ cases: THREE_CASES }),
      makeChangedSkillRun({ cases: THREE_CASES, configHash: 'config-hash-v2' })
    );

    expect(report.status).toBe('PASS');
    expect(report.comparability).toBe('WARNING');
    expect(report.caseComparisons.every((c) => c.scoresCompared)).toBe(true);
  });
});

describe('a case edited under the same id', () => {
  it('is excluded from the score comparison while the others continue', () => {
    const report = compare(
      makeRun({ cases: THREE_CASES }),
      makeChangedSkillRun({
        cases: [{ id: 'golden-001' }, { id: 'golden-002', hash: 'edited' }, { id: 'golden-003' }],
      })
    );

    expect(report.status).toBe('INCOMPATIBLE');
    expect(caseNamed(report, 'golden-002').scoresCompared).toBe(false);
    expect(caseNamed(report, 'golden-002').reasons.join(' ')).toContain('content changed');
    expect(caseNamed(report, 'golden-001').scoresCompared).toBe(true);
    expect(report.tokens.casesCompared).toBe(2);
  });
});

describe('a renamed case', () => {
  it('carries the baseline score across to the new id', () => {
    const baseline = makeRun({ cases: THREE_CASES });
    const movedHash = baseline.caseResults.find((r) => r.caseId === 'golden-002')!.caseHash;
    const report = compare(
      baseline,
      makeChangedSkillRun({
        cases: [{ id: 'golden-001' }, { id: 'metrics-002', hash: movedHash }, { id: 'golden-003' }],
      })
    );

    const renamed = caseNamed(report, 'metrics-002');
    expect(renamed.scoresCompared).toBe(true);
    expect(renamed.previous?.overall).toBeCloseTo(4.5, 10);
    expect(renamed.reasons.join(' ')).toContain('renamed from "golden-002"');
    expect(report.missingFromCurrent).toEqual([]);
  });
});

describe('a legacy result missing newer metadata', () => {
  const legacy = makeRun({
    cases: [{ id: 'golden-001', hash: null }, { id: 'golden-002', hash: null }],
    skillHash: null,
    configHash: null,
    caseInputHash: null,
    evaluatorPromptHash: null,
    provider: null,
  });

  it('still compares the scores, with the gaps reported as warnings', () => {
    const report = compare(legacy, makeChangedSkillRun({ cases: [{ id: 'golden-001' }, { id: 'golden-002' }] }));

    expect(report.status).toBe('PASS');
    expect(report.comparability).toBe('WARNING');
    expect(report.caseComparisons.every((c) => c.scoresCompared)).toBe(true);
  });

  it('still catches a threshold violation against it', () => {
    const report = compare(
      legacy,
      makeChangedSkillRun({ cases: [{ id: 'golden-001', overall: 4.0 }, { id: 'golden-002' }] })
    );

    expect(report.status).toBe('REVIEW');
  });
});

describe('review thresholds', () => {
  it('flags an overall drop beyond the configured threshold', () => {
    const report = compare(
      makeRun({ cases: THREE_CASES }),
      makeChangedSkillRun({ cases: [{ id: 'golden-001', overall: 4.2 }, { id: 'golden-002' }, { id: 'golden-003' }] })
    );

    expect(report.status).toBe('REVIEW');
    expect(caseNamed(report, 'golden-001').reasons.join(' ')).toContain('beyond review threshold');
    expect(caseNamed(report, 'golden-002').status).toBe('PASS');
  });

  it('ignores a drop that stays within the threshold', () => {
    // Only `overall` moves here: the per-dimension thresholds differ, so a test about one of them
    // has to hold the others still or it measures the tightest threshold instead.
    const report = compare(
      makeRun({ cases: THREE_CASES }),
      makeChangedSkillRun({
        cases: [
          { id: 'golden-001', overall: 4.35, faithfulness: 4.5, naturalness: 4.5, cvQuality: 4.5 },
          { id: 'golden-002' },
          { id: 'golden-003' },
        ],
      })
    );

    expect(report.status).toBe('PASS');
  });

  it('applies the tighter faithfulness threshold independently of the overall score', () => {
    // overall is unchanged; faithfulness drops 0.15, past its own 0.1 threshold.
    const report = compare(
      makeRun({ cases: THREE_CASES }),
      makeChangedSkillRun({
        cases: [{ id: 'golden-001', overall: 4.5, faithfulness: 4.35 }, { id: 'golden-002' }, { id: 'golden-003' }],
      })
    );

    expect(report.status).toBe('REVIEW');
  });

  it('reads the threshold from configuration rather than hard-coding it', () => {
    const lenient: RegressionThresholds = {
      ...THRESHOLDS,
      reviewThresholds: { ...THRESHOLDS.reviewThresholds, overallScoreDrop: 1 },
    };
    const current = makeChangedSkillRun({
      cases: [
        { id: 'golden-001', overall: 4.2, faithfulness: 4.5, naturalness: 4.5, cvQuality: 4.5 },
        { id: 'golden-002' },
        { id: 'golden-003' },
      ],
    });

    expect(compare(makeRun({ cases: THREE_CASES }), current).status).toBe('REVIEW');
    expect(compareRuns(makeRun({ cases: THREE_CASES }), current, { thresholds: lenient }).status).toBe('PASS');
  });
});

describe('the token increase threshold', () => {
  it('flags a token increase beyond the configured percentage', () => {
    const report = compare(
      makeRun({ cases: [{ id: 'golden-001', totalTokens: 100 }, { id: 'golden-002', totalTokens: 100 }] }),
      makeChangedSkillRun({ cases: [{ id: 'golden-001', totalTokens: 150 }, { id: 'golden-002', totalTokens: 150 }] })
    );

    expect(report.tokens.increasePercent).toBeCloseTo(50, 6);
    expect(report.tokens.exceeded).toBe(true);
    expect(report.status).toBe('REVIEW');
  });

  it('accepts an increase within the threshold', () => {
    const report = compare(
      makeRun({ cases: [{ id: 'golden-001', totalTokens: 100 }] }),
      makeChangedSkillRun({ cases: [{ id: 'golden-001', totalTokens: 120 }] })
    );

    expect(report.tokens.increasePercent).toBeCloseTo(20, 6);
    expect(report.tokens.exceeded).toBe(false);
    expect(report.status).toBe('PASS');
  });

  it('counts only shared, comparable cases so an added case cannot skew it', () => {
    const report = compare(
      makeRun({ cases: [{ id: 'golden-001', totalTokens: 100 }] }),
      makeChangedSkillRun({
        cases: [{ id: 'golden-001', totalTokens: 100 }, { id: 'golden-002', totalTokens: 100000 }],
      })
    );

    expect(report.tokens.casesCompared).toBe(1);
    expect(report.tokens.currentTotal).toBe(100);
    expect(report.tokens.exceeded).toBe(false);
  });
});

describe('hard guardrail failures', () => {
  const baseline = makeRun({ cases: THREE_CASES });

  const breaches: [label: string, breach: Partial<CaseSpec>, expectedReason: string][] = [
    ['a forbidden claim', { matchedForbiddenClaims: ['sole architect'] }, 'forbidden claim'],
    ['an unsupported claim from the judge', { unsupportedClaims: ['invented a metric'] }, 'unsupported claims'],
    ['a missing required string', { missingExactStrings: ['Northwind Labs'] }, 'required exact string'],
    ['a forbidden character', { matchedForbiddenCharacters: ['—'] }, 'forbidden character'],
    ['broken bold formatting', { boldMarkerMismatch: true }, 'structural formatting'],
    ['broken paragraph structure', { paragraphBreakMismatch: true }, 'structural formatting'],
  ];

  for (const [label, breach, expectedReason] of breaches) {
    it(`fails on ${label}`, () => {
      const report = compare(
        baseline,
        makeChangedSkillRun({ cases: [{ id: 'golden-001', ...breach }, { id: 'golden-002' }, { id: 'golden-003' }] })
      );

      expect(report.status).toBe('FAIL');
      expect(report.goldenFailures).toEqual(['golden-001']);
      expect(caseNamed(report, 'golden-001').reasons.join(' ')).toContain(expectedReason);
    });
  }

  it('fails even when the comparison is otherwise incompatible, because the breach needs no baseline', () => {
    const report = compare(
      baseline,
      makeChangedSkillRun({
        cases: [{ id: 'golden-001', matchedForbiddenClaims: ['sole architect'] }, { id: 'golden-003' }],
      })
    );

    expect(report.comparability).toBe('INCOMPATIBLE');
    expect(report.status).toBe('FAIL');
  });

  it('tolerates failing cases up to the configured allowance', () => {
    const tolerant: RegressionThresholds = {
      ...THRESHOLDS,
      hardFail: { ...THRESHOLDS.hardFail, goldenFailures: 1 },
    };
    const current = makeChangedSkillRun({
      cases: [{ id: 'golden-001', matchedForbiddenCharacters: ['—'] }, { id: 'golden-002' }, { id: 'golden-003' }],
    });

    expect(compare(makeRun({ cases: THREE_CASES }), current).status).toBe('FAIL');

    const report = compareRuns(makeRun({ cases: THREE_CASES }), current, { thresholds: tolerant });
    expect(report.goldenFailures).toEqual(['golden-001']);
    expect(report.status).not.toBe('FAIL');
  });

  it('reads each hard-fail allowance from configuration rather than hard-coding zero', () => {
    const tolerant: RegressionThresholds = {
      ...THRESHOLDS,
      hardFail: { ...THRESHOLDS.hardFail, forbiddenCharacterMatches: 1 },
    };
    const current = makeChangedSkillRun({
      cases: [{ id: 'golden-001', matchedForbiddenCharacters: ['—'] }, { id: 'golden-002' }, { id: 'golden-003' }],
    });

    expect(compareRuns(makeRun({ cases: THREE_CASES }), current, { thresholds: tolerant }).status).toBe('PASS');
  });
});
