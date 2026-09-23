/**
 * Runs the benchmark suite (reference/evals/benchmark) across the requested variants and persists the
 * result. No API key is required to import this file; running it for real does call the
 * configured provider(s), so it is never run by the test suite.
 *
 *   npx tsx evals/run-evals.ts                         # default variants (A, B, C)
 *   npx tsx evals/run-evals.ts --variants=A,C           # only the requested variants
 *   npx tsx evals/run-evals.ts --models-config=config/models.haiku.json
 *   npx tsx evals/run-evals.ts --pairwise=B,C           # also run a blind pairwise comparison
 *   npx tsx evals/run-evals.ts --skill-context=by-task  # send only the SKILL.md sections each letter needs
 *   npx tsx evals/run-evals.ts --token-report=true      # also print tokens and prompt-part sizes per request type
 */
import '@skills/framework/load-env-on-import';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadModelRoles, loadRawModelRolesConfig } from '../src/model-config';
import { toModelRolesConfig } from '@skills/framework/provider/model-roles';
import { instrumentRoles, RequestLog } from '@skills/framework/provider/instrumentation';
import { buildTokenUsageReport, formatTokenUsageReport } from '@skills/framework/evals/token-usage-report';
import { sha256 } from '@skills/framework/hash';
import type { RuntimeConfig } from '../src/runtime/types';
import { aggregateForVariant, computeRunTotals } from './aggregate';
import { aggregatePairwiseWins } from './pairwise-aggregate';
import { BENCHMARK_DIR, loadCases } from './cases-loader';
import { buildRunMetadata } from '@skills/framework/evals/run-metadata';
import { SKILL_DIR } from '../src/skill-dir';
import { runBenchmark, type PairwiseOptions } from './run-benchmark';
import { formatTerminalReport, saveRunResult } from './reporter';
import { RESULT_SCHEMA_VERSION, type EvalRunResult, type Variant } from './types';
import evalConfig from './config/eval-config.json';
import runtimeConfigJson from '../src/runtime/runtime-config.json';
import { skillContextOption } from '../src/skill-sections';


function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  const runId = process.env.MODEL_RUN_ID ?? randomUUID();
  process.env.MODEL_RUN_ID = runId;
  console.log(`Run ID: ${runId} (usage: npm run usage:summary -- --run-id=${runId})`);

  const args = parseArgs(process.argv.slice(2));
  const variants = (args.variants ?? evalConfig.defaultVariants.join(',')).split(',') as Variant[];

  // Run the exact same benchmark against a different provider/model per role by pointing this at
  // another file — e.g. config/models.haiku.json — rather than editing any source.
  const rawModelsConfig = loadRawModelRolesConfig(args['models-config']);
  // Recording every request changes no call; the report itself is opt-in via --token-report=true.
  const requestLog = new RequestLog();
  const roles = instrumentRoles(loadModelRoles(args['models-config']), requestLog);
  const runtimeConfig: RuntimeConfig = { ...runtimeConfigJson, ...skillContextOption(args['skill-context']) };

  const cases = loadCases(BENCHMARK_DIR);

  const pairwiseArg = args.pairwise;
  let pairwise: PairwiseOptions | undefined;
  if (pairwiseArg) {
    const [variantA, variantB] = pairwiseArg.split(',') as [Variant, Variant];
    if (!variantA || !variantB) {
      throw new Error(`--pairwise expects exactly two variants, e.g. --pairwise=B,C (got "${pairwiseArg}")`);
    }
    pairwise = { variants: [variantA, variantB], temperature: evalConfig.evaluatorTemperature };
  }

  const { caseResults, pairwiseResults } = await runBenchmark({
    cases,
    variants,
    roles,
    runtimeConfig,
    evaluatorConfig: { temperature: evalConfig.evaluatorTemperature },
    requestLog,
    pairwise,
  });

  const aggregates = variants.map((variant) => aggregateForVariant(variant, caseResults));
  const pairwiseAggregates = aggregatePairwiseWins(pairwiseResults);
  const modelRoles = toModelRolesConfig(roles);

  const metadata = buildRunMetadata({
    skillDir: SKILL_DIR,
    dataset: 'benchmark',
    schemaVersion: RESULT_SCHEMA_VERSION,
    cases,
    config: { evalConfig, runtimeConfig, modelsConfig: rawModelsConfig },
    provider: roles.generator.providerName,
    runId,
  });

  const run: EvalRunResult = {
    ...metadata,
    modelRoles,
    variants,
    caseResults,
    pairwiseResults,
    aggregates,
    pairwiseAggregates,
    totals: computeRunTotals(caseResults),
  };

  const resultsDir = path.join(__dirname, 'results');
  const filePath = saveRunResult(run, resultsDir);

  console.log(formatTerminalReport(run));
  console.log(`\nSaved: ${filePath}`);

  if (args['token-report'] === 'true') {
    console.log('');
    console.log(formatTokenUsageReport(buildTokenUsageReport(requestLog.entries)));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
