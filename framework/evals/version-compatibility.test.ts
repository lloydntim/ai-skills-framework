import { describe, expect, it } from 'vitest';
import { checkCompatibility } from './regression-compatibility';
import { makeRun, makeVersions } from '../testing/make-run';

const CASES = [{ id: 'g1' }, { id: 'g2' }];
const codes = (report: ReturnType<typeof checkCompatibility>) => report.findings.map((f) => f.code);

describe('a changed evaluator or dataset is never read as a quality change', () => {
  it('blocks when the evaluator prompt changes', () => {
    const report = checkCompatibility(makeRun({ cases: CASES }), makeRun({ cases: CASES, evaluatorPromptHash: 'other' }));
    expect(report.level).toBe('INCOMPATIBLE');
    expect(report.scoresComparable).toBe(false);
    expect(codes(report)).toContain('RUBRIC_CHANGED');
  });

  it('blocks when the evaluator model changes', () => {
    const report = checkCompatibility(makeRun({ cases: CASES }), makeRun({ cases: CASES, evaluatorModel: 'claude-opus-5' }));
    expect(report.level).toBe('INCOMPATIBLE');
    expect(codes(report)).toContain('EVALUATOR_MODEL_CHANGED');
  });

  it('blocks when a case is edited in place', () => {
    const report = checkCompatibility(
      makeRun({ cases: CASES }),
      makeRun({ cases: [{ id: 'g1', hash: 'edited' }, { id: 'g2' }] })
    );
    expect(report.level).toBe('INCOMPATIBLE');
    expect(codes(report)).toContain('CASES_EDITED');
  });

  it('blocks when the two runs used different datasets', () => {
    const report = checkCompatibility(
      makeRun({ cases: CASES, dataset: 'golden' }),
      makeRun({ cases: CASES, dataset: 'benchmark' })
    );
    expect(report.level).toBe('INCOMPATIBLE');
    expect(codes(report)).toContain('DATASET_CHANGED');
  });
});

describe('pairwise judge changes', () => {
  it('flags a changed pairwise prompt without blocking single-output scores', () => {
    const report = checkCompatibility(
      makeRun({ cases: CASES, versions: makeVersions() }),
      makeRun({ cases: CASES, versions: makeVersions({ pairwiseEvaluatorHash: 'changed' }) })
    );
    expect(codes(report)).toContain('PAIRWISE_RUBRIC_CHANGED');
    expect(report.pairwiseComparable).toBe(false);
    expect(report.scoresComparable).toBe(true);
  });

  it('flags a changed pairwise judge model', () => {
    const report = checkCompatibility(
      makeRun({ cases: CASES }),
      makeRun({ cases: CASES, pairwiseJudgeModel: 'claude-opus-5' })
    );
    expect(codes(report)).toContain('PAIRWISE_JUDGE_MODEL_CHANGED');
    expect(report.pairwiseComparable).toBe(false);
  });
});

describe('the system under test', () => {
  it('reports a changed validator prompt as information, and does not call the skill "unchanged"', () => {
    const report = checkCompatibility(
      makeRun({ cases: CASES, versions: makeVersions() }),
      makeRun({ cases: CASES, versions: makeVersions({ validatorHash: 'changed' }) })
    );
    expect(codes(report)).toContain('VALIDATOR_PROMPT_CHANGED');
    expect(codes(report)).not.toContain('SKILL_UNCHANGED');
  });

  it('warns when the validator or reviser model changes', () => {
    const report = checkCompatibility(
      makeRun({ cases: CASES }),
      makeRun({ cases: CASES, validatorModel: 'claude-haiku-4-5-20251001', reviserModel: 'claude-haiku-4-5-20251001' })
    );
    expect(codes(report)).toEqual(expect.arrayContaining(['VALIDATOR_MODEL_CHANGED', 'REVISER_MODEL_CHANGED']));
  });
});

describe('version numbers against content hashes', () => {
  it('warns when content changed but the version did not', () => {
    const changed = makeVersions({ validatorHash: 'changed' });
    const report = checkCompatibility(
      makeRun({ cases: CASES, versions: makeVersions() }),
      makeRun({ cases: CASES, versions: changed })
    );
    expect(report.findings.find((f) => f.code === 'VERSION_NOT_BUMPED')?.message).toMatch(/validator prompt/);
  });

  it('says so when a version was bumped with no change', () => {
    const bumped = makeVersions();
    bumped.prompts.validator.version = '2';
    const report = checkCompatibility(
      makeRun({ cases: CASES, versions: makeVersions() }),
      makeRun({ cases: CASES, versions: bumped })
    );
    expect(codes(report)).toContain('VERSION_BUMPED_WITHOUT_CHANGE');
  });

  it('cannot check versions when a run predates them', () => {
    const report = checkCompatibility(makeRun({ cases: CASES, versions: null }), makeRun({ cases: CASES }));
    expect(codes(report)).toContain('VERSIONS_UNVERIFIABLE');
  });
});

describe('uncommitted changes', () => {
  it('is mentioned as information and does not change the level', () => {
    const report = checkCompatibility(makeRun({ cases: CASES, gitDirty: true }), makeRun({ cases: CASES }));
    expect(codes(report)).toContain('WORKING_TREE_DIRTY');
    expect(report.findings.find((f) => f.code === 'WORKING_TREE_DIRTY')?.level).toBe('INFO');
  });
});
