/**
 * Runs the golden cases through variants B and C, saves the result, then either approves it as the
 * new regression baseline or compares it against the currently approved one. No API key is
 * required to import this file; running it for real does call the configured provider(s), so it is
 * never run by the test suite.
 *
 *   npx tsx evals/run-regression.ts                          # compare against the approved baseline
 *   npx tsx evals/run-regression.ts --approve=true            # approve this run as the new baseline
 *   npx tsx evals/run-regression.ts --compare=<file.json>     # compare against a specific file
 *   npx tsx evals/run-regression.ts --allow-incompatible=true # compare even if runs are flagged incompatible
 *   npx tsx evals/run-regression.ts --skill-context=by-task   # send only the SKILL.md sections each letter needs
 *   npx tsx evals/run-regression.ts --token-report=true       # also print tokens and prompt-part sizes per request type
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
import { GOLDEN_DIR, loadCases } from './cases-loader';
import { buildRunMetadata } from '@skills/framework/evals/run-metadata';
import { appendRunSummary, RUN_HISTORY_FILE, summarizeRun } from '@skills/framework/evals/run-summary';
import { SKILL_DIR } from '../src/skill-dir';
import { runBenchmark } from './run-benchmark';
import { saveRunResult } from './reporter';
import { compareRuns, findLatestApproved, IncompatibleRunsError, loadRun, type RegressionReport } from './regression';
import { formatRegressionReport } from './regression-reporter';
import { RESULT_SCHEMA_VERSION, type EvalRunResult, type Variant } from './types';
import evalConfig from './config/eval-config.json';
import runtimeConfigJson from '../src/runtime/runtime-config.json';
import { skillContextOption } from '../src/skill-sections';

// B = SKILL.md, single pass. C = the real production pipeline (generate -> validate -> revise ->
// revalidate, see src/runtime). Both are checked so a regression introduced anywhere in the
// production pipeline — not just in the underlying skill prompt — fails the suite.
const REGRESSION_VARIANTS: Variant[] = ['B', 'C'];

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

type VariantOutcome = { variant: Variant; report: RegressionReport } | { variant: Variant; error: IncompatibleRunsError };

function printIncompatible(variant: Variant, error: IncompatibleRunsError): void {
  console.log(`COVER LETTER WRITER REGRESSION REPORT — variant ${variant}`);
  console.log('===============================================');
  console.log('');
  console.log(error.message);
  console.log('');
  for (const finding of error.compatibility.findings) {
    console.log(`  [${finding.level}] ${finding.code}: ${finding.message}`);
  }
  console.log('');
}

async function main() {
  const runId = process.env.MODEL_RUN_ID ?? randomUUID();
  process.env.MODEL_RUN_ID = runId;
  console.log(`Run ID: ${runId} (usage: npm run usage:summary -- --run-id=${runId})`);

  const args = parseArgs(process.argv.slice(2));
  const rawModelsConfig = loadRawModelRolesConfig(args['models-config']);
  // Recording every request changes no call; the report itself is opt-in via --token-report=true.
  const requestLog = new RequestLog();
  const roles = instrumentRoles(loadModelRoles(args['models-config']), requestLog);
  const runtimeConfig: RuntimeConfig = { ...runtimeConfigJson, ...skillContextOption(args['skill-context']) };
  const resultsDir = path.join(__dirname, 'results');
  // The approved run is a full record of one candidate's actual letters, so it lives in the
  // private reference/ folder the export never includes (see regression.ts's findLatestApproved),
  // not in evals/results/, which is exported and tracked for its non-baseline files.
  const baselineDir = path.join(SKILL_DIR, 'reference', 'evals', 'results');

  const cases = loadCases(GOLDEN_DIR);

  const { caseResults } = await runBenchmark({
    cases,
    variants: REGRESSION_VARIANTS,
    roles,
    runtimeConfig,
    evaluatorConfig: { temperature: evalConfig.evaluatorTemperature },
    requestLog,
  });

  const aggregates = REGRESSION_VARIANTS.map((variant) => aggregateForVariant(variant, caseResults));
  const modelRoles = toModelRolesConfig(roles);

  const metadata = buildRunMetadata({
    skillDir: SKILL_DIR,
    dataset: 'golden',
    schemaVersion: RESULT_SCHEMA_VERSION,
    cases,
    config: { evalConfig, runtimeConfig, modelsConfig: rawModelsConfig },
    provider: roles.generator.providerName,
    runId,
  });

  const run: EvalRunResult = {
    ...metadata,
    modelRoles,
    variants: REGRESSION_VARIANTS,
    caseResults,
    pairwiseResults: [],
    aggregates,
    pairwiseAggregates: [],
    totals: computeRunTotals(caseResults),
  };

  const currentFile = saveRunResult(run, resultsDir);
  console.log(`Saved: ${currentFile}`);

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
    appendRunSummary(historyFile, summarizeRun({ run: { ...metadata, modelRoles, aggregates, totals: run.totals }, config: { evalConfig, runtimeConfig, modelsConfig: rawModelsConfig }, requests: requestLog.entries }));
    console.log(`Summary appended to ${historyFile}.`);
    return;
  }

  const previousFile = args.compare
    ? path.isAbsolute(args.compare)
      ? args.compare
      : path.join(resultsDir, args.compare)
    : findLatestApproved(resultsDir, baselineDir);

  const previous = loadRun(previousFile);
  const allowIncompatible = args['allow-incompatible'] === 'true';

  // Each variant is compared independently and the worst status wins, so a regression anywhere in
  // the production pipeline fails the suite, not just one in the skill prompt.
  const outcomes: VariantOutcome[] = REGRESSION_VARIANTS.map((variant) => {
    try {
      return { variant, report: compareRuns(previous, run, { compareVariant: variant, allowIncompatible }) };
    } catch (err) {
      if (err instanceof IncompatibleRunsError) return { variant, error: err };
      throw err;
    }
  });

  for (const outcome of outcomes) {
    if ('error' in outcome) {
      printIncompatible(outcome.variant, outcome.error);
    } else {
      console.log(formatRegressionReport(outcome.variant, outcome.report, previousFile, currentFile));
      console.log('');
    }
  }

  const anyIncompatible = outcomes.some((o) => 'error' in o);
  const anyFail = outcomes.some((o) => 'report' in o && o.report.status === 'FAIL');
  const anyReview = outcomes.some((o) => 'report' in o && o.report.status === 'REVIEW');

  const overall = anyIncompatible ? 'INCOMPATIBLE (refused)' : anyFail ? 'FAIL' : anyReview ? 'REVIEW' : 'PASS';
  console.log(`OVERALL RESULT: ${overall}`);

  if (anyIncompatible) {
    console.log('');
    console.log(
      'No quality verdict is available for at least one variant: the baseline and this run are not ' +
        'measuring the same thing. Fix the difference, approve a new baseline, or re-run with ' +
        '--allow-incompatible=true to compare anyway.'
    );
  }

  // A refused (incompatible) comparison exits non-zero too: it must not read as a pass to anything
  // gating on this command.
  if (anyFail || anyIncompatible) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
