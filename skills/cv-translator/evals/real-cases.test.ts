import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCases } from './cases-loader';
import type { EvalCase } from './types';

describe('the real benchmark and golden case fixtures', () => {
  const benchmarkDir = path.join(__dirname, 'cases', 'benchmark');
  const goldenDir = path.join(__dirname, 'cases', 'golden');

  function assertCoherent(cases: EvalCase[]) {
    expect(cases.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const kase of cases) {
      expect(ids.has(kase.id)).toBe(false);
      ids.add(kase.id);
      expect(kase.id.length).toBeGreaterThan(0);
      expect(kase.category.length).toBeGreaterThan(0);
      expect(kase.sourceLanguage.length).toBeGreaterThan(0);
      expect(kase.targetLanguage.length).toBeGreaterThan(0);
      expect(kase.input.length).toBeGreaterThan(0);
      expect(kase.instructions.length).toBeGreaterThan(0);
    }
  }

  it('loads the benchmark suite with unique ids and every required field populated', () => {
    assertCoherent(loadCases(benchmarkDir));
  });

  it('loads the golden suite with unique ids and every required field populated', () => {
    assertCoherent(loadCases(goldenDir));
  });

  it('never reuses a golden case id for a benchmark case, so a run over both stays unambiguous', () => {
    const benchmarkIds = new Set(loadCases(benchmarkDir).map((c) => c.id));
    const goldenIds = loadCases(goldenDir).map((c) => c.id);

    for (const id of goldenIds) {
      expect(benchmarkIds.has(id)).toBe(false);
    }
  });

  it('gives every case listing at least one required or expected fact to check faithfulness against', () => {
    // Not a hard schema requirement, but a case with none of these would never be caught by the
    // deterministic checks or the evaluator's expected-facts scoring — coherence worth flagging.
    const withoutAnyCheck = [...loadCases(benchmarkDir), ...loadCases(goldenDir)].filter(
      (kase) =>
        (kase.expectedFacts?.length ?? 0) === 0 &&
        (kase.requiredExactStrings?.length ?? 0) === 0 &&
        (kase.requiredTerms?.length ?? 0) === 0
    );

    expect(withoutAnyCheck.map((c) => c.id)).toEqual([]);
  });
});
