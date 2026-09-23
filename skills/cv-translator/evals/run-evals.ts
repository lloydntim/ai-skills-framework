import path from 'node:path';
import '@skills/framework/load-env-on-import';
import { parseArgs } from '@skills/framework/cli-args';
import { loadModelRoles, loadRawModelRolesConfig } from '../src/model-config';
import { instrumentRoles, RequestLog } from '@skills/framework/provider/instrumentation';
import { toModelRolesConfig } from '@skills/framework/provider/model-roles';
import type { RuntimeConfig } from '../src/runtime/types';
import { formatTerminalReport, saveRunResult } from './reporter';
import { loadCases } from './cases-loader';
import { runBenchmark } from './run-benchmark';
import { buildRunMetadata } from '@skills/framework/evals/run-metadata';
import { SKILL_DIR } from '../src/skill-dir';
import { aggregateForVariant } from './aggregate';
import { buildTokenUsageReport, formatTokenUsageReport } from '@skills/framework/evals/token-usage-report';
import { RESULT_SCHEMA_VERSION, type EvalRunResult, type Variant } from './types';
import evalConfig from './config/eval-config.json';
import runtimeConfigJson from '../src/runtime/runtime-config.json';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const variants = (args.variants ?? evalConfig.defaultVariants.join(',')).split(',') as Variant[];
  const skillVersion = args['skill-version'];

  // Run the exact same matrix (baseline vs skill vs skill+self-review) against a different
  // provider/model per role by pointing this at another file — e.g. config/models.haiku.json —
  // rather than editing any source. See config/models.json for the shape.
  const rawModelsConfig = loadRawModelRolesConfig(args['models-config']);
  const baseRoles = loadModelRoles(args['models-config']);
  const runtimeConfig: RuntimeConfig = runtimeConfigJson;

  // Instrumentation is always attached — it changes nothing about the calls made (see
  // src/provider/instrumentation.ts) — but the report itself is opt-in via --token-report=true so
  // default output is unchanged for anyone not asking for it.
  const requestLog = new RequestLog();
  const roles = instrumentRoles(baseRoles, requestLog);

  const cases = loadCases(path.join(__dirname, 'cases', 'benchmark'));

  const { caseResults, pairwiseResults } = await runBenchmark({
    cases,
    variants,
    roles,
    runtimeConfig,
    checks: {
      maxLengthRatio: evalConfig.maxLengthRatio,
      forbiddenCharacters: evalConfig.forbiddenCharacters,
      evaluatorTemperature: evalConfig.evaluatorTemperature,
    },
    requestLog,
  });

  const aggregates = variants.map((variant) => aggregateForVariant(variant, caseResults));

  const metadata = buildRunMetadata({
    skillDir: SKILL_DIR,
    dataset: 'benchmark',
    schemaVersion: RESULT_SCHEMA_VERSION,
    cases,
    config: { evalConfig, runtimeConfig, modelsConfig: rawModelsConfig },
    provider: roles.generator.providerName,
  });

  const run: EvalRunResult = {
    ...metadata,
    model: roles.generator.model,
    evaluatorModel: roles.evaluator.model,
    modelRoles: toModelRolesConfig(roles),
    variants,
    caseResults,
    pairwiseResults,
    aggregates,
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
