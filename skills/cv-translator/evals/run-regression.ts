import fs from 'node:fs';
import path from 'node:path';
import '@skills/framework/load-env-on-import';
import { parseArgs } from '@skills/framework/cli-args';
import { runDeterministicChecks } from '../src/deterministic-checks';
import { loadModelRoles, loadRawModelRolesConfig } from '../src/model-config';
import { instrumentRoles, RequestLog } from '@skills/framework/provider/instrumentation';
import { toModelRolesConfig } from '@skills/framework/provider/model-roles';
import type { RuntimeConfig } from '../src/runtime/types';
import { evaluateQuality } from './evaluator';
import { runVariant } from './providers/variants';
import { hashCase } from '@skills/framework/evals/case-hash';
import { loadCases } from './cases-loader';
import { compareRuns, findLatestApproved, loadRun, type RegressionStatus } from './regression';
import { formatRegressionReport } from './regression-reporter';
import { saveRunResult } from './reporter';
import { buildRunMetadata } from '@skills/framework/evals/run-metadata';
import { appendRunSummary, RUN_HISTORY_FILE, summarizeRun } from '@skills/framework/evals/run-summary';
import { SKILL_DIR } from '../src/skill-dir';
import { aggregateForVariant } from './aggregate';
import { buildTokenUsageReport, formatTokenUsageReport } from '@skills/framework/evals/token-usage-report';
import { RESULT_SCHEMA_VERSION, type CaseResult, type EvalRunResult, type Variant } from './types';
import evalConfig from './config/eval-config.json';
import runtimeConfigJson from '../src/runtime/runtime-config.json';

// B = raw skill generation, no self-review. C = the actual production pipeline (generate ->
// validate -> revise -> revalidate, see src/runtime). Both are checked so a regression introduced
// anywhere in the production pipeline — not just in the underlying skill prompt — fails the suite.
// Hardcoded rather than a CLI flag, to keep this change minimal; add a variant here (e.g. once D
// exists) when it should also gate regressions.
const REGRESSION_VARIANTS: Variant[] = ['B', 'C'];

function worstStatus(statuses: RegressionStatus[]): RegressionStatus {
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('INCOMPATIBLE')) return 'INCOMPATIBLE';
  if (statuses.includes('REVIEW')) return 'REVIEW';
  return 'PASS';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawModelsConfig = loadRawModelRolesConfig(args['models-config']);
  const baseRoles = loadModelRoles(args['models-config']);
  const runtimeConfig: RuntimeConfig = runtimeConfigJson;
  const resultsDir = path.join(__dirname, 'results');
  // The approved run is a full record of real, translated CV text, so it lives in the private
  // reference/ folder the export never includes (see regression.ts's findLatestApproved), not in
  // the tracked evals/results/ that raw runs live in.
  const baselineDir = path.join(SKILL_DIR, 'reference', 'evals', 'results');

  // Always attached, never changes a call made (see src/provider/instrumentation.ts); the report
  // itself stays opt-in via --token-report=true.
  const requestLog = new RequestLog();
  const roles = instrumentRoles(baseRoles, requestLog);

  const cases = loadCases(path.join(__dirname, 'cases', 'golden'));
  const caseResults: CaseResult[] = [];

  for (const kase of cases) {
    requestLog.setCurrentCase(kase.id);
    for (const variant of REGRESSION_VARIANTS) {
      const output = await runVariant(variant, kase, roles, runtimeConfig);
      const deterministic = runDeterministicChecks({
        output: output.text,
        requiredExactStrings: kase.requiredExactStrings,
        requiredTerms: kase.requiredTerms,
        forbiddenClaims: kase.forbiddenClaims,
        sourceText: kase.input,
        maxLengthRatio: kase.maxLengthRatio ?? evalConfig.maxLengthRatio,
        forbiddenCharacters: evalConfig.forbiddenCharacters,
      });
      const quality = await evaluateQuality(kase, output.text, roles.evaluator.provider, {
        model: roles.evaluator.model,
        temperature: evalConfig.evaluatorTemperature,
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
    }
  }
  requestLog.setCurrentCase(undefined);

  const aggregates = REGRESSION_VARIANTS.map((variant) => aggregateForVariant(variant, caseResults));

  const metadata = buildRunMetadata({
    skillDir: SKILL_DIR,
    dataset: 'golden',
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
    variants: REGRESSION_VARIANTS,
    caseResults,
    pairwiseResults: [],
    aggregates,
  };

  const currentFile = saveRunResult(run, resultsDir);

  if (args['token-report'] === 'true') {
    console.log(formatTokenUsageReport(buildTokenUsageReport(requestLog.entries)));
    console.log('');
  }

  if (args.approve === 'true') {
    fs.mkdirSync(baselineDir, { recursive: true });
    fs.copyFileSync(currentFile, path.join(baselineDir, 'approved-baseline.json'));
    console.log(`Approved ${currentFile} as the new regression baseline.`);
    // The tracked, text-free record of this approval (see framework/evals/run-summary.ts).
    const historyFile = path.join(__dirname, RUN_HISTORY_FILE);
    appendRunSummary(historyFile, summarizeRun({ run: { ...metadata, modelRoles: toModelRolesConfig(roles), aggregates }, config: { evalConfig, runtimeConfig, modelsConfig: rawModelsConfig }, requests: requestLog.entries }));
    console.log(`Summary appended to ${historyFile}.`);
    return;
  }

  const previousFile = args.compare
    ? path.isAbsolute(args.compare)
      ? args.compare
      : path.join(resultsDir, args.compare)
    : findLatestApproved(resultsDir, baselineDir);

  const previous = loadRun(previousFile);

  // Each variant is compared independently and the worst status wins, so a regression anywhere in
  // the production pipeline fails the suite, not just one in the skill prompt. There is still no
  // cross-variant rule (nothing asserts that C should never score worse than B for the same case);
  // that would need compareRuns to see every variant at once.
  //
  // A baseline saved before variant C existed holds no C results. That is now reported as an
  // explicit VARIANT_MISSING_FROM_BASELINE warning with every case marked "not compared", rather
  // than appearing as an empty PASS.
  const allowIncompatible = args['allow-incompatible'] === 'true';
  const reports = REGRESSION_VARIANTS.map((variant) => ({
    variant,
    report: compareRuns(previous, run, { compareVariant: variant, allowIncompatible }),
  }));

  for (const { variant, report } of reports) {
    console.log(formatRegressionReport(variant, report, previousFile, currentFile));
    console.log('');
  }

  const overall = worstStatus(reports.map((r) => r.report.status));
  console.log(`OVERALL RESULT: ${overall}`);

  if (overall === 'INCOMPATIBLE') {
    console.log('');
    console.log(
      'No quality verdict is available: the baseline and this run are not measuring the same thing. ' +
        'Fix the difference, approve a new baseline, or re-run with --allow-incompatible=true to ' +
        'compare anyway.'
    );
  }

  // INCOMPATIBLE exits non-zero too: a comparison that could not be made must not read as a pass
  // to anything gating on this command.
  if (overall === 'FAIL' || overall === 'INCOMPATIBLE') {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
