import { runDeterministicChecks } from '../src/deterministic-checks';
import { hashCase } from '@skills/framework/evals/case-hash';
import type { ResolvedModelRoles } from '@skills/framework/provider/model-roles';
import type { RequestLog } from '@skills/framework/provider/instrumentation';
import type { RuntimeConfig } from '../src/runtime/types';
import { evaluateQuality } from './evaluator';
import { evaluatePairwise } from './pairwise-evaluator';
import { runVariant } from './providers/variants';
import type { CaseResult, EvalCase, PairwiseResult, Variant } from './types';

/** The eval-side settings the per-case loop needs that are not part of RuntimeConfig. */
export interface BenchmarkCheckConfig {
  maxLengthRatio: number;
  forbiddenCharacters: string[];
  evaluatorTemperature: number;
}

export interface RunBenchmarkOptions {
  cases: EvalCase[];
  variants: Variant[];
  roles: ResolvedModelRoles;
  runtimeConfig: RuntimeConfig;
  checks: BenchmarkCheckConfig;
  /**
   * Run the blind pairwise judge when exactly two variants are compared. Defaults to true, which is
   * what a single-configuration run has always done. The matrix runner turns it off by default
   * because it would otherwise add one judge call per case *per configuration*, and the matrix's
   * question (does the skill close the gap between models?) is answered by the scored aggregates,
   * not by a within-configuration preference.
   */
  pairwise?: boolean;
  /**
   * When given, every case's requests are attributed to that case in the log for the duration of
   * that case's iteration (see RequestLog.setCurrentCase). Passing the same instrumented roles here
   * without a log still works — the roles just won't be attributed to a case.
   */
  requestLog?: RequestLog;
}

export interface BenchmarkOutcome {
  caseResults: CaseResult[];
  pairwiseResults: PairwiseResult[];
}

/**
 * Runs every variant over every case, scoring each output mechanically and with the judge.
 *
 * Extracted from run-evals.ts so the single-configuration runner and the model matrix runner share
 * one implementation: a case must be scored identically no matter which entry point asked for it,
 * or cross-configuration numbers cannot be compared at all.
 */
export async function runBenchmark(options: RunBenchmarkOptions): Promise<BenchmarkOutcome> {
  const { cases, variants, roles, runtimeConfig, checks, requestLog } = options;
  const runPairwise = options.pairwise ?? true;

  const caseResults: CaseResult[] = [];
  const pairwiseResults: PairwiseResult[] = [];

  for (const kase of cases) {
    requestLog?.setCurrentCase(kase.id);
    const outputsForPairwise: { variant: Variant; text: string }[] = [];

    for (const variant of variants) {
      const output = await runVariant(variant, kase, roles, runtimeConfig);
      const deterministic = runDeterministicChecks({
        output: output.text,
        requiredExactStrings: kase.requiredExactStrings,
        requiredTerms: kase.requiredTerms,
        forbiddenClaims: kase.forbiddenClaims,
        sourceText: kase.input,
        maxLengthRatio: kase.maxLengthRatio ?? checks.maxLengthRatio,
        forbiddenCharacters: checks.forbiddenCharacters,
      });
      const quality = await evaluateQuality(kase, output.text, roles.evaluator.provider, {
        model: roles.evaluator.model,
        temperature: checks.evaluatorTemperature,
      });
      caseResults.push({
        caseId: kase.id,
        category: kase.category,
        variant,
        output,
        deterministic,
        quality,
        caseHash: hashCase(kase),
      });
      outputsForPairwise.push({ variant, text: output.text });
    }

    if (runPairwise && outputsForPairwise.length === 2) {
      const pairwise = await evaluatePairwise(
        kase,
        [outputsForPairwise[0], outputsForPairwise[1]],
        roles.pairwiseJudge.provider,
        { model: roles.pairwiseJudge.model, temperature: checks.evaluatorTemperature }
      );
      pairwiseResults.push(pairwise);
    }
  }

  requestLog?.setCurrentCase(undefined);
  return { caseResults, pairwiseResults };
}
