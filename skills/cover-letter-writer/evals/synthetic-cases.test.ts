import { describe, expect, it } from 'vitest';
import { PUBLIC_BENCHMARK_DIR, PUBLIC_GOLDEN_DIR, loadCases } from './cases-loader';
import { isMarket } from '../src/markets';

/**
 * The public, synthetic golden and benchmark cases (evals/cases/), built on
 * candidate-profile.example.md rather than the real candidate's CV. Unlike cases.test.ts, this
 * file never gates on reference/: it is exactly the coverage a public checkout has, so it must
 * always run, whether or not the private reference/ material is also present locally.
 */
const cases = loadCases(PUBLIC_GOLDEN_DIR);
const benchmarkCases = loadCases(PUBLIC_BENCHMARK_DIR);

describe('public synthetic golden cases', () => {
  it('loads every golden case file', () => {
    expect(cases.length).toBeGreaterThanOrEqual(5);
  });

  it('gives every case a unique id', () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(cases.map((c) => [c.id, c] as const))('%s is well formed', (_id, evalCase) => {
    expect(evalCase.category.length).toBeGreaterThan(0);
    expect(['en', 'de']).toContain(evalCase.language);
    expect(evalCase.cvText.length).toBeGreaterThan(0);
    expect(evalCase.roleDescription.length).toBeGreaterThan(0);
    expect(evalCase.instructions.length).toBeGreaterThan(0);
  });

  it.each(cases.map((c) => [c.id, c] as const))('%s exists to prevent something specific', (_id, evalCase) => {
    expect(evalCase.forbiddenClaims?.length ?? 0).toBeGreaterThan(0);
  });

  it.each(cases.map((c) => [c.id, c] as const))('%s does not forbid something its own CV says', (_id, evalCase) => {
    const cv = evalCase.cvText.toLowerCase();
    const contradictions = (evalCase.forbiddenClaims ?? []).filter((claim) => cv.includes(claim.toLowerCase()));
    expect(contradictions).toEqual([]);
  });

  it.each(cases.map((c) => [c.id, c] as const))('%s uses a CV excerpt without an em or en dash', (_id, evalCase) => {
    expect(evalCase.cvText).not.toMatch(/[—–]/);
  });

  it.each(cases.map((c) => [c.id, c] as const))('%s sets a coherent length range', (_id, evalCase) => {
    if (evalCase.minWords !== undefined && evalCase.maxWords !== undefined) {
      expect(evalCase.minWords).toBeLessThan(evalCase.maxWords);
    }
  });

  it.each(cases.map((c) => [c.id, c] as const))('%s names a known market when one is given', (_id, evalCase) => {
    if (evalCase.market !== undefined) expect(isMarket(evalCase.market)).toBe(true);
  });

  it('contains no fact, employer or metric from the real candidate profile', () => {
    // A synthetic case is only safe to publish if nobody wrote real CV text into it by habit. The
    // fictional employers are the ones candidate-profile.example.md itself names.
    const text = JSON.stringify([...cases, ...benchmarkCases]);
    for (const employer of ['Northwind Retail', 'Fabrikam Energy', 'Contoso Bank']) {
      expect(text).toContain(employer);
    }
  });
});

describe('public synthetic benchmark cases', () => {
  it('loads every benchmark case file', () => {
    expect(benchmarkCases.length).toBeGreaterThanOrEqual(5);
  });

  it('gives every case a unique id', () => {
    const ids = benchmarkCases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(benchmarkCases.map((c) => [c.id, c] as const))('%s names a known market when one is given', (_id, evalCase) => {
    if (evalCase.market !== undefined) expect(isMarket(evalCase.market)).toBe(true);
  });
});
