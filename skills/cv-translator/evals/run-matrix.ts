import fs from 'node:fs';
import path from 'node:path';
import '@skills/framework/load-env-on-import';
import { parseArgs } from '@skills/framework/cli-args';
import { loadModelRoles, loadRawModelRolesConfig } from '../src/model-config';
import { toModelRolesConfig, type ModelRolesConfig } from '@skills/framework/provider/model-roles';
import type { RuntimeConfig } from '../src/runtime/types';
import { aggregateForVariant } from './aggregate';
import { loadCases } from './cases-loader';
import { buildMatrix, findEvaluatorMismatches, parseMatrixConfig, type MatrixConfig } from './matrix';
import { formatMatrixReport, summarizeMatrix, type ConfigurationRun, type MatrixSummary } from './matrix-summary';
import { saveRunResult } from './reporter';
import { runBenchmark } from './run-benchmark';
import { buildRunMetadata, type RunMetadata } from '@skills/framework/evals/run-metadata';
import { SKILL_DIR } from '../src/skill-dir';
import { RESULT_SCHEMA_VERSION, type EvalRunResult, type Variant } from './types';
import evalConfig from './config/eval-config.json';
import runtimeConfigJson from '../src/runtime/runtime-config.json';

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_MATRIX_CONFIG = path.join(REPO_ROOT, 'config', 'matrix.json');

/** What a matrix run persists alongside the per-configuration result files. */
export interface MatrixRunResult extends RunMetadata {
  caseCount: number;
  matrix: MatrixConfig;
  configurations: {
    label: string;
    modelsConfig: string;
    roles: ModelRolesConfig;
    resultFile: string;
  }[];
  summary: MatrixSummary;
}

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'config';
}

function resolveFromRepo(configPath: string): string {
  return path.isAbsolute(configPath) ? configPath : path.join(REPO_ROOT, configPath);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const matrixConfigPath = args['matrix-config'] ? resolveFromRepo(args['matrix-config']) : DEFAULT_MATRIX_CONFIG;

  if (!fs.existsSync(matrixConfigPath)) {
    throw new Error(`Matrix configuration file not found at ${matrixConfigPath}`);
  }

  const rawMatrixConfig = JSON.parse(fs.readFileSync(matrixConfigPath, 'utf-8'));
  const matrixConfig = parseMatrixConfig(rawMatrixConfig);

  // --variants overrides the file so one configured matrix can be narrowed for a cheaper trial run
  // without editing config. The skill comparison is re-validated against the narrowed list.
  const effectiveMatrix: MatrixConfig = args.variants
    ? parseMatrixConfig({ ...rawMatrixConfig, variants: args.variants.split(',') })
    : matrixConfig;

  const entries = buildMatrix(effectiveMatrix);
  const runtimeConfig: RuntimeConfig = runtimeConfigJson;

  // Resolve every configuration's models up front: a bad path or unknown provider should fail
  // before any API call is made, not halfway through a paid run.
  const resolved = effectiveMatrix.configurations.map((configuration) => {
    const modelsConfigPath = resolveFromRepo(configuration.modelsConfig);
    return {
      label: configuration.label,
      modelsConfig: configuration.modelsConfig,
      raw: loadRawModelRolesConfig(modelsConfigPath),
      roles: loadModelRoles(modelsConfigPath),
    };
  });

  // Scores from different judges cannot be set side by side, which is the whole point of the
  // matrix, so this is an error rather than a warning.
  const mismatches = findEvaluatorMismatches(
    resolved.map((r) => ({ label: r.label, evaluator: toModelRolesConfig(r.roles).evaluator }))
  );
  if (mismatches.length > 0 && args['allow-mixed-evaluator'] !== 'true') {
    throw new Error(
      `The configurations in this matrix do not share one evaluator, so their scores are not ` +
        `comparable:\n  ${mismatches.join('\n  ')}\n` +
        `Point every configuration at the same evaluator model, or pass ` +
        `--allow-mixed-evaluator=true to run anyway and compare the numbers at your own risk.`
    );
  }

  // Loaded once and reused for every configuration: the benchmark cases must be identical across
  // the matrix, and loading them per configuration would invite them drifting apart.
  const cases = loadCases(path.join(__dirname, 'cases', 'benchmark'));

  const timestamp = new Date().toISOString();
  const resultsDir = path.join(__dirname, 'results', 'matrix', timestamp.replace(/[:.]/g, '-'));

  const runPairwise = args.pairwise === 'true';
  const configurationRuns: ConfigurationRun[] = [];
  const persisted: MatrixRunResult['configurations'] = [];

  console.log(
    `Running ${entries.length} cell(s): ${effectiveMatrix.configurations.length} configuration(s) x ` +
      `${effectiveMatrix.variants.length} variant(s) over ${cases.length} case(s).`
  );

  for (const configuration of resolved) {
    console.log(`\n[${configuration.label}] generator ${configuration.roles.generator.model} ...`);

    const { caseResults, pairwiseResults } = await runBenchmark({
      cases,
      variants: effectiveMatrix.variants,
      roles: configuration.roles,
      runtimeConfig,
      checks: {
        maxLengthRatio: evalConfig.maxLengthRatio,
        forbiddenCharacters: evalConfig.forbiddenCharacters,
        evaluatorTemperature: evalConfig.evaluatorTemperature,
      },
      pairwise: runPairwise,
    });

    const roles = toModelRolesConfig(configuration.roles);

    const metadata = buildRunMetadata({
      skillDir: SKILL_DIR,
      dataset: 'benchmark',
      schemaVersion: RESULT_SCHEMA_VERSION,
      cases,
      config: { evalConfig, runtimeConfig, modelsConfig: configuration.raw, matrix: effectiveMatrix },
      provider: configuration.roles.generator.providerName,
    });

    const run: EvalRunResult = {
      ...metadata,
      model: configuration.roles.generator.model,
      evaluatorModel: configuration.roles.evaluator.model,
      modelRoles: roles,
      variants: effectiveMatrix.variants,
      caseResults,
      pairwiseResults,
      aggregates: effectiveMatrix.variants.map((variant) => aggregateForVariant(variant, caseResults)),
    };

    const filename = `${slugify(configuration.label)}.json`;
    const filePath = saveRunResult(run, resultsDir, filename);

    configurationRuns.push({ label: configuration.label, roles, caseResults });
    persisted.push({
      label: configuration.label,
      modelsConfig: configuration.modelsConfig,
      roles,
      resultFile: filename,
    });

    console.log(`[${configuration.label}] saved ${filePath}`);
  }

  const summary = summarizeMatrix(configurationRuns, effectiveMatrix.variants, effectiveMatrix.skillComparison);

  const matrixMetadata = buildRunMetadata({
    skillDir: SKILL_DIR,
    dataset: 'benchmark',
    schemaVersion: RESULT_SCHEMA_VERSION,
    cases,
    config: {
      evalConfig,
      runtimeConfig,
      matrix: effectiveMatrix,
      modelsConfigs: Object.fromEntries(resolved.map((r) => [r.label, r.raw])),
    },
    provider: [...new Set(resolved.map((r) => r.roles.generator.providerName))].join(','),
  });

  const matrixRun: MatrixRunResult = {
    ...matrixMetadata,
    caseCount: cases.length,
    matrix: effectiveMatrix,
    configurations: persisted,
    summary,
  };

  const summaryPath = path.join(resultsDir, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(matrixRun, null, 2));

  console.log('');
  console.log(formatMatrixReport(summary));
  console.log(`\nSaved: ${summaryPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
