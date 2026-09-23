import { describe, expect, it } from 'vitest';
import { compareRuns } from './regression';
import { formatRegressionReport } from './regression-reporter';
import { makeChangedSkillRun, makeRun } from './test-support/make-run';

const THREE_CASES = [{ id: 'golden-001' }, { id: 'golden-002' }, { id: 'golden-003' }];

function render(previous = makeRun({ cases: THREE_CASES }), current = makeChangedSkillRun({ cases: THREE_CASES })) {
  return formatRegressionReport('B', compareRuns(previous, current), 'baseline.json', 'current.json');
}

describe('formatRegressionReport', () => {
  it('names the two files it compared and the final result', () => {
    const report = render();

    expect(report).toContain('CV SKILL REGRESSION REPORT — variant B');
    expect(report).toContain('Compared: baseline.json -> current.json');
    expect(report).toContain('RESULT: PASS');
  });

  it('states the comparability level before any score', () => {
    const report = render();
    const comparabilityAt = report.indexOf('Comparability:');
    const deltasAt = report.indexOf('Overall deltas');

    expect(comparabilityAt).toBeGreaterThan(-1);
    expect(comparabilityAt).toBeLessThan(deltasAt);
    expect(report).toContain('Comparability: COMPATIBLE');
  });

  it('lists each finding with its level and code', () => {
    const report = render();

    expect(report).toMatch(/\[INFO\]\s+SKILL_CHANGED:/);
  });

  it('gives a removed case its own section and a per-case line', () => {
    const report = render(
      makeRun({ cases: THREE_CASES }),
      makeChangedSkillRun({ cases: [{ id: 'golden-001' }, { id: 'golden-003' }] })
    );

    expect(report).toContain('Cases in the baseline but NOT in this run');
    expect(report).toMatch(/\[INCOMPATIBLE\]\s+golden-002: overall 4\.50 -> not run/);
    expect(report).toContain('RESULT: INCOMPATIBLE');
  });

  it('says how many cases the deltas cover, so they cannot be read as whole-suite figures', () => {
    const report = render(
      makeRun({ cases: THREE_CASES }),
      makeChangedSkillRun({ cases: [{ id: 'golden-001' }, { id: 'golden-003' }] })
    );

    expect(report).toContain('over 2 comparable case(s)');
  });

  it('reports no delta at all when nothing was comparable', () => {
    const report = render(
      makeRun({ cases: THREE_CASES }),
      makeChangedSkillRun({ cases: THREE_CASES, evaluatorModel: 'claude-opus-5' })
    );

    expect(report).toContain('no case was comparable, so no delta was computed');
    expect(report).toContain('Tokens: no comparable case');
  });

  it('marks a token rise past the threshold inline', () => {
    const report = render(
      makeRun({ cases: [{ id: 'golden-001', totalTokens: 100 }] }),
      makeChangedSkillRun({ cases: [{ id: 'golden-001', totalTokens: 200 }] })
    );

    expect(report).toContain('beyond tokenIncreasePercent threshold');
    expect(report).toContain('100 -> 200 (+100.0%)');
  });

  it('says plainly when an incompatible comparison was overridden', () => {
    const report = formatRegressionReport(
      'B',
      compareRuns(makeRun({ cases: THREE_CASES }), makeChangedSkillRun({ cases: THREE_CASES, evaluatorModel: 'claude-opus-5' }), {
        allowIncompatible: true,
      }),
      'baseline.json',
      'current.json'
    );

    expect(report).toContain('OVERRIDDEN by --allow-incompatible');
  });

  it('says so explicitly when the two runs differ in nothing', () => {
    const identical = makeRun({ cases: THREE_CASES });
    const report = formatRegressionReport('B', compareRuns(identical, identical), 'a.json', 'b.json');

    expect(report).toContain('Comparability: WARNING');
    expect(report).toContain('SKILL_UNCHANGED');
  });
});
