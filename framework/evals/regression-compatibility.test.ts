import { describe, expect, it } from 'vitest';
import {
  checkCompatibility,
  diffCaseSets,
  type CompatibilityFinding,
  type CompatibilityReport,
} from './regression-compatibility';
import { makeChangedSkillRun, makeRun } from '../testing/make-run';

const THREE_CASES = [{ id: 'golden-001' }, { id: 'golden-002' }, { id: 'golden-003' }];

function codes(report: CompatibilityReport): string[] {
  return report.findings.map((f) => f.code);
}

function findingFor(report: CompatibilityReport, code: string): CompatibilityFinding | undefined {
  return report.findings.find((f) => f.code === code);
}

describe('the same case set, with only the skill changed', () => {
  const baseline = makeRun({ cases: THREE_CASES });
  const current = makeChangedSkillRun({ cases: THREE_CASES });

  it('is a valid comparison', () => {
    const report = checkCompatibility(baseline, current);

    expect(report.level).toBe('COMPATIBLE');
    expect(report.scoresComparable).toBe(true);
  });

  it('records the skill change as information, not a warning', () => {
    const report = checkCompatibility(baseline, current);

    expect(findingFor(report, 'SKILL_CHANGED')?.level).toBe('INFO');
    expect(report.findings.filter((f) => f.level === 'WARNING')).toEqual([]);
  });

  it('reports no case-set difference', () => {
    const report = checkCompatibility(baseline, current);

    expect(report.caseSet.shared).toEqual(['golden-001', 'golden-002', 'golden-003']);
    expect(report.caseSet.added).toEqual([]);
    expect(report.caseSet.removed).toEqual([]);
    expect(report.caseSet.edited).toEqual([]);
    expect(report.caseSet.renamed).toEqual([]);
  });
});

describe('an unchanged skill', () => {
  it('warns that score movement cannot be a regression', () => {
    const report = checkCompatibility(makeRun({ cases: THREE_CASES }), makeRun({ cases: THREE_CASES }));

    expect(report.level).toBe('WARNING');
    expect(findingFor(report, 'SKILL_UNCHANGED')?.level).toBe('WARNING');
    expect(findingFor(report, 'SKILL_UNCHANGED')?.message).toContain('evaluator noise');
  });
});

describe('an added case', () => {
  const baseline = makeRun({ cases: THREE_CASES });
  const current = makeChangedSkillRun({ cases: [...THREE_CASES, { id: 'golden-004' }] });

  it('is a comparison with warnings, not an incompatible one', () => {
    const report = checkCompatibility(baseline, current);

    expect(report.level).toBe('WARNING');
    expect(report.scoresComparable).toBe(true);
  });

  it('names the added case', () => {
    const report = checkCompatibility(baseline, current);

    expect(report.caseSet.added).toEqual(['golden-004']);
    expect(findingFor(report, 'CASES_ADDED')?.message).toContain('golden-004');
  });
});

describe('a removed case', () => {
  const baseline = makeRun({ cases: THREE_CASES });
  const current = makeChangedSkillRun({ cases: [{ id: 'golden-001' }, { id: 'golden-003' }] });

  it('makes the comparison incompatible rather than quietly smaller', () => {
    const report = checkCompatibility(baseline, current);

    expect(report.level).toBe('INCOMPATIBLE');
    expect(findingFor(report, 'CASES_REMOVED')?.level).toBe('INCOMPATIBLE');
  });

  it('names the removed case and says coverage shrank', () => {
    const report = checkCompatibility(baseline, current);

    expect(report.caseSet.removed).toEqual(['golden-002']);
    expect(findingFor(report, 'CASES_REMOVED')?.message).toContain('golden-002');
    expect(findingFor(report, 'CASES_REMOVED')?.message).toContain('covers less than the baseline');
  });

  it('leaves the remaining cases comparable as scores', () => {
    // Losing a case shrinks coverage; it does not change what the surviving scores measure.
    expect(checkCompatibility(baseline, current).scoresComparable).toBe(true);
  });
});

describe('a changed evaluator', () => {
  it('is incompatible when the evaluator model changed', () => {
    const report = checkCompatibility(
      makeRun({ cases: THREE_CASES }),
      makeChangedSkillRun({ cases: THREE_CASES, evaluatorModel: 'claude-opus-5' })
    );

    expect(report.level).toBe('INCOMPATIBLE');
    expect(report.scoresComparable).toBe(false);
    expect(findingFor(report, 'EVALUATOR_MODEL_CHANGED')?.current).toBe('claude-opus-5');
  });

  it('is incompatible when the evaluator ran on a different provider', () => {
    const report = checkCompatibility(
      makeRun({ cases: THREE_CASES }),
      makeChangedSkillRun({ cases: THREE_CASES, provider: 'someone-else' })
    );

    expect(report.level).toBe('INCOMPATIBLE');
    expect(report.scoresComparable).toBe(false);
    expect(codes(report)).toContain('EVALUATOR_PROVIDER_CHANGED');
  });

  it('is incompatible when the scoring rubric changed', () => {
    const report = checkCompatibility(
      makeRun({ cases: THREE_CASES }),
      makeChangedSkillRun({ cases: THREE_CASES, evaluatorPromptHash: 'rubric-hash-v2' })
    );

    expect(report.level).toBe('INCOMPATIBLE');
    expect(report.scoresComparable).toBe(false);
    expect(findingFor(report, 'RUBRIC_CHANGED')?.message).toContain('not the same measurement');
  });
});

describe('a changed result schema version', () => {
  it('warns but keeps the scores comparable', () => {
    const report = checkCompatibility(
      makeRun({ cases: THREE_CASES }),
      makeChangedSkillRun({ cases: THREE_CASES, schemaVersion: 2 })
    );

    expect(report.level).toBe('WARNING');
    expect(report.scoresComparable).toBe(true);
    expect(findingFor(report, 'SCHEMA_VERSION_CHANGED')?.level).toBe('WARNING');
    expect(findingFor(report, 'SCHEMA_VERSION_CHANGED')?.current).toBe('2');
  });
});

describe('a changed eval configuration', () => {
  it('warns but keeps the scores comparable', () => {
    const report = checkCompatibility(
      makeRun({ cases: THREE_CASES }),
      makeChangedSkillRun({ cases: THREE_CASES, configHash: 'config-hash-v2' })
    );

    expect(report.level).toBe('WARNING');
    expect(report.scoresComparable).toBe(true);
    expect(findingFor(report, 'CONFIG_CHANGED')?.level).toBe('WARNING');
  });
});

describe('a changed generator model', () => {
  it('warns that a score difference need not come from the skill', () => {
    const report = checkCompatibility(
      makeRun({ cases: THREE_CASES }),
      makeChangedSkillRun({ cases: THREE_CASES, generatorModel: 'claude-haiku-4-5-20251001' })
    );

    expect(report.level).toBe('WARNING');
    expect(findingFor(report, 'GENERATOR_MODEL_CHANGED')?.current).toBe('claude-haiku-4-5-20251001');
  });
});

describe('a case edited under the same id', () => {
  const baseline = makeRun({ cases: THREE_CASES });
  const current = makeChangedSkillRun({
    cases: [{ id: 'golden-001' }, { id: 'golden-002', hash: 'edited-content' }, { id: 'golden-003' }],
  });

  it('is incompatible, because its scores measure different inputs', () => {
    const report = checkCompatibility(baseline, current);

    expect(report.level).toBe('INCOMPATIBLE');
    expect(report.caseSet.edited).toEqual(['golden-002']);
    expect(findingFor(report, 'CASES_EDITED')?.message).toContain('golden-002');
  });

  it('does not mistake the edit for an addition or a removal', () => {
    const report = checkCompatibility(baseline, current);

    expect(report.caseSet.added).toEqual([]);
    expect(report.caseSet.removed).toEqual([]);
  });

  it('leaves the other cases globally comparable', () => {
    // The global flag stays true; the affected case is named individually instead.
    expect(checkCompatibility(baseline, current).scoresComparable).toBe(true);
  });
});

describe('a renamed case', () => {
  const baseline = makeRun({ cases: THREE_CASES });
  const current = makeChangedSkillRun({
    cases: [{ id: 'golden-001' }, { id: 'metrics-002', hash: undefined }, { id: 'golden-003' }],
  });

  it('is detected as a rename, not as a removal plus an addition', () => {
    // golden-002's content hash is carried over to the new id, which is what identifies the rename.
    const renamed = makeChangedSkillRun({
      cases: [
        { id: 'golden-001' },
        { id: 'metrics-002', hash: baseline.caseResults.find((r) => r.caseId === 'golden-002')!.caseHash },
        { id: 'golden-003' },
      ],
    });
    const report = checkCompatibility(baseline, renamed);

    expect(report.caseSet.renamed).toEqual([{ previousId: 'golden-002', currentId: 'metrics-002' }]);
    expect(report.caseSet.removed).toEqual([]);
    expect(report.caseSet.added).toEqual([]);
    expect(report.level).toBe('WARNING');
  });

  it('shows as a removal plus an addition when the content genuinely differs', () => {
    const report = checkCompatibility(baseline, current);

    expect(report.caseSet.renamed).toEqual([]);
    expect(report.caseSet.removed).toEqual(['golden-002']);
    expect(report.caseSet.added).toEqual(['metrics-002']);
  });
});

describe('a legacy result missing the newer metadata', () => {
  const legacy = makeRun({
    cases: [{ id: 'golden-001', hash: null }, { id: 'golden-002', hash: null }],
    schemaVersion: null,
    skillHash: null,
    configHash: null,
    caseInputHash: null,
    evaluatorPromptHash: null,
    provider: null,
  });
  const current = makeChangedSkillRun({ cases: [{ id: 'golden-001' }, { id: 'golden-002' }] });

  it('warns about each thing it cannot verify instead of assuming it matched', () => {
    const report = checkCompatibility(legacy, current);

    expect(codes(report)).toContain('SCHEMA_VERSION_UNVERIFIABLE');
    expect(codes(report)).toContain('SKILL_UNVERIFIABLE');
    expect(codes(report)).toContain('CONFIG_UNVERIFIABLE');
    expect(codes(report)).toContain('RUBRIC_UNVERIFIABLE');
    expect(codes(report)).toContain('DATASET_HASH_UNVERIFIABLE');
    expect(codes(report)).toContain('CASE_CONTENT_UNVERIFIABLE');
    expect(codes(report)).toContain('EVALUATOR_PROVIDER_UNVERIFIABLE');
  });

  it('is a comparison with warnings, not a blocked one', () => {
    const report = checkCompatibility(legacy, current);

    expect(report.level).toBe('WARNING');
    expect(report.scoresComparable).toBe(true);
  });

  it('still catches a changed evaluator model, which legacy results do record', () => {
    const report = checkCompatibility(legacy, makeChangedSkillRun({ cases: THREE_CASES, evaluatorModel: 'claude-opus-5' }));

    expect(report.level).toBe('INCOMPATIBLE');
    expect(report.scoresComparable).toBe(false);
  });

  it('says rename and edit detection is unavailable rather than guessing', () => {
    const report = checkCompatibility(legacy, current);

    expect(report.caseSet.contentComparable).toBe(false);
    expect(report.caseSet.edited).toEqual([]);
    expect(findingFor(report, 'CASE_CONTENT_UNVERIFIABLE')?.message).toContain('Re-approve a baseline');
  });
});

describe('dataset fingerprint with no case-level difference', () => {
  it('warns that something moved without a case changing', () => {
    const report = checkCompatibility(
      makeRun({ cases: THREE_CASES }),
      makeChangedSkillRun({ cases: THREE_CASES, caseInputHash: 'reordered-dataset' })
    );

    expect(codes(report)).toContain('DATASET_HASH_CHANGED_WITHOUT_CASE_DIFF');
    expect(report.level).toBe('WARNING');
  });

  it('stays quiet when an added case already explains the difference', () => {
    const report = checkCompatibility(
      makeRun({ cases: THREE_CASES }),
      makeChangedSkillRun({ cases: [...THREE_CASES, { id: 'golden-004' }] })
    );

    expect(codes(report)).not.toContain('DATASET_HASH_CHANGED_WITHOUT_CASE_DIFF');
  });
});

describe('benchmark version and variant coverage', () => {
  it('warns when the declared benchmark version differs', () => {
    const report = checkCompatibility(
      makeRun({ cases: THREE_CASES }),
      makeChangedSkillRun({ cases: THREE_CASES, benchmarkVersion: 'golden-v2' })
    );

    expect(findingFor(report, 'BENCHMARK_VERSION_CHANGED')?.current).toBe('golden-v2');
  });

  it('warns when the baseline holds no results for the variant being compared', () => {
    const report = checkCompatibility(
      makeRun({ cases: THREE_CASES, variants: ['B'] }),
      makeChangedSkillRun({ cases: THREE_CASES, variants: ['B', 'C'] }),
      'C'
    );

    expect(findingFor(report, 'VARIANT_MISSING_FROM_BASELINE')?.level).toBe('WARNING');
  });

  it('is incompatible when this run holds no results for the variant at all', () => {
    const report = checkCompatibility(
      makeRun({ cases: THREE_CASES, variants: ['B', 'C'] }),
      makeChangedSkillRun({ cases: THREE_CASES, variants: ['B'] }),
      'C'
    );

    expect(findingFor(report, 'VARIANT_MISSING_FROM_RUN')?.level).toBe('INCOMPATIBLE');
    expect(report.level).toBe('INCOMPATIBLE');
  });
});

describe('diffCaseSets', () => {
  it('ignores which variants a case was run under when comparing id sets', () => {
    const diff = diffCaseSets(
      makeRun({ cases: THREE_CASES, variants: ['B'] }),
      makeRun({ cases: THREE_CASES, variants: ['B', 'C'] })
    );

    expect(diff.shared).toEqual(['golden-001', 'golden-002', 'golden-003']);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });
});
