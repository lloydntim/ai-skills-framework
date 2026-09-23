import { runDeterministicChecks } from '../src/deterministic-checks';
import { toDeterministicCheckInput } from '../src/runtime/validate';
import { hashCase } from '@skills/framework/evals/case-hash';
import { evaluatePairwise } from './pairwise-evaluator';
import type { RequestLog } from '@skills/framework/provider/instrumentation';
import type { ResolvedModelRoles } from '@skills/framework/provider/model-roles';
import type { RuntimeConfig } from '../src/runtime/types';
import { evaluateQuality, type EvaluatorConfig } from './evaluator';
import { runVariant, toCoverLetterTaskInput } from './providers/variants';
import type { CaseResult, EvalCase, PairwiseResult, Variant, VariantOutput } from './types';

export interface PairwiseOptions {
  /** The two canonical variants to compare, blind, for every case in this run. Order only affects which is called "first" internally — evaluatePairwise still randomises which display slot each lands in. */
  variants: [Variant, Variant];
  temperature: number;
  /** Injectable so callers (and their tests) can force a deterministic presentation order. Defaults to Math.random. */
  random?: () => number;
}

export interface RunBenchmarkOptions {
  cases: EvalCase[];
  variants: Variant[];
  roles: ResolvedModelRoles;
  runtimeConfig: RuntimeConfig;
  evaluatorConfig: Pick<EvaluatorConfig, 'temperature'>;
  /** When given, also runs a blind pairwise comparison between two variants for every case. Both must be included in `variants`. */
  pairwise?: PairwiseOptions;
  /**
   * When given, every case's requests are attributed to that case in the log for the duration of
   * that case's iteration (see RequestLog.setCurrentCase). The roles must be instrumented with the
   * same log (instrumentRoles) for anything to be recorded.
   */
  requestLog?: RequestLog;
}

export interface BenchmarkOutcome {
  caseResults: CaseResult[];
  pairwiseResults: PairwiseResult[];
}

/**
 * Runs every variant over every case, scoring each output with the same deterministic checks
 * production uses (via toDeterministicCheckInput — never a second, drifting copy of that mapping)
 * and with the offline single-output evaluator. Optionally also runs a blind pairwise comparison
 * between two of the run's variants for every case.
 */
export async function runBenchmark(options: RunBenchmarkOptions): Promise<BenchmarkOutcome> {
  const { cases, variants, roles, runtimeConfig, evaluatorConfig, pairwise, requestLog } = options;

  if (pairwise) {
    const missing = pairwise.variants.filter((v) => !variants.includes(v));
    if (missing.length > 0) {
      throw new Error(
        `Pairwise comparison requested for variant(s) ${missing.join(', ')}, which are not in this run's variants (${variants.join(', ')}).`
      );
    }
  }

  const caseResults: CaseResult[] = [];
  const pairwiseResults: PairwiseResult[] = [];

  for (const kase of cases) {
    requestLog?.setCurrentCase(kase.id);
    const outputsByVariant = new Map<Variant, VariantOutput>();

    for (const variant of variants) {
      const output = await runVariant(variant, kase, roles, runtimeConfig);
      outputsByVariant.set(variant, output);

      const deterministic = runDeterministicChecks(toDeterministicCheckInput(toCoverLetterTaskInput(kase), output.text));

      const evaluation = await evaluateQuality(kase, output.text, roles.evaluator.provider, {
        model: roles.evaluator.model,
        temperature: evaluatorConfig.temperature,
      });

      caseResults.push({
        caseId: kase.id,
        category: kase.category,
        variant,
        output,
        deterministic,
        quality: evaluation.quality,
        evaluatorUsage: evaluation.usage,
        evaluatorLatencyMs: evaluation.latencyMs,
        evaluatorCost: evaluation.cost,
        caseHash: hashCase(kase),
      });
    }

    if (pairwise) {
      const [variantA, variantB] = pairwise.variants;
      const first = outputsByVariant.get(variantA)!;
      const second = outputsByVariant.get(variantB)!;

      const pairwiseResult = await evaluatePairwise(
        kase,
        [
          { variant: variantA, text: first.text },
          { variant: variantB, text: second.text },
        ],
        roles.pairwiseJudge.provider,
        { model: roles.pairwiseJudge.model, temperature: pairwise.temperature },
        pairwise.random
      );
      pairwiseResults.push(pairwiseResult);
    }
  }

  requestLog?.setCurrentCase(undefined);

  return { caseResults, pairwiseResults };
}
