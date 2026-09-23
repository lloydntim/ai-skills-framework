import { describe, expect, it } from 'vitest';
import { formatRegressionReport } from './regression-reporter';
import type { RegressionReport } from './regression';

function makeReport(overrides: Partial<RegressionReport> = {}): RegressionReport {
  return {
    status: 'PASS',
    compatibility: { level: 'COMPATIBLE', findings: [], caseSet: { shared: ['golden-001'], added: [], removed: [], renamed: [], edited: [], contentComparable: true }, scoresComparable: true, pairwiseComparable: true },
    overridden: false,
    caseComparisons: [
      {
        caseId: 'golden-001',
        previous: { factualGrounding: 5, jobRelevance: 5, professionalTone: 5, specificity: 5, naturalness: 5, conciseness: 5, overall: 5 },
        current: { factualGrounding: 5, jobRelevance: 5, professionalTone: 5, specificity: 5, naturalness: 5, conciseness: 5, overall: 5 },
        status: 'PASS',
        scoresCompared: true,
        regression: false,
        reasons: [],
      },
    ],
    overallDeltas: { factualGrounding: 0, jobRelevance: 0, professionalTone: 0, specificity: 0, naturalness: 0, conciseness: 0, overall: 0 },
    deltaCasesCompared: 1,
    tokens: { previousTotal: 100, currentTotal: 100, increasePercent: 0, casesCompared: 1, exceeded: false },
    failingCases: [],
    missingFromCurrent: [],
    ...overrides,
  };
}

describe('formatRegressionReport', () => {
  it('includes the overall result and the per-case status', () => {
    const text = formatRegressionReport('B', makeReport(), 'previous.json', 'current.json');

    expect(text).toContain('RESULT: PASS');
    expect(text).toContain('golden-001');
    expect(text).toContain('previous.json -> current.json');
  });

  it('surfaces compatibility findings and the overridden flag clearly', () => {
    const report = makeReport({
      status: 'FAIL',
      overridden: true,
      compatibility: {
        level: 'INCOMPATIBLE',
        findings: [{ level: 'INCOMPATIBLE', code: 'CASES_REMOVED', message: 'golden-002 is missing.' }],
        caseSet: { shared: [], added: [], removed: ['golden-002'], renamed: [], edited: [], contentComparable: true },
        scoresComparable: true, pairwiseComparable: true,
      },
      missingFromCurrent: ['golden-002'],
    });

    const text = formatRegressionReport('B', report, 'previous.json', 'current.json');

    expect(text).toContain('OVERRIDDEN');
    expect(text).toContain('CASES_REMOVED');
    expect(text).toContain('golden-002');
    expect(text).toContain('RESULT: FAIL');
  });

  it('reports when no case was comparable rather than a misleading zero delta', () => {
    const report = makeReport({ caseComparisons: [], deltaCasesCompared: 0, tokens: { previousTotal: 0, currentTotal: 0, increasePercent: null, casesCompared: 0, exceeded: false } });

    const text = formatRegressionReport('B', report, 'previous.json', 'current.json');

    expect(text).toContain('no case was comparable');
    expect(text).toContain('no comparable case, so no token comparison was made');
  });
});
