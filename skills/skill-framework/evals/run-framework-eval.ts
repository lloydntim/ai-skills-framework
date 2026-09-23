import fs from 'node:fs';
import path from 'node:path';
import '@skills/framework/load-env-on-import';
import { parseArgs } from '@skills/framework/cli-args';
import type { ModelProvider } from '@skills/framework/provider/types';
import { AnthropicProvider } from '@skills/framework/provider/anthropic-provider';
import { CHECKS, doesNotApproveUnreadBaseline } from './checks';
import { FRAMEWORK_CASES, type FrameworkCase } from './cases';
import { buildSystemPrompt, type FrameworkVariant } from './variants';
import {
  approveFrameworkBaseline,
  buildFrameworkRunResult,
  saveFrameworkRunResult,
  type FrameworkCaseResult,
  type FrameworkRunResult,
} from './reporter';

export type FrameworkEvalMode = 'smoke' | 'full' | 'compare' | 'approve';

const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_MODELS_CONFIG_PATH = path.join(__dirname, 'config', 'models.json');
const RESULTS_DIR = path.join(__dirname, 'results');

// An advisory answer is long, and a model that thinks first spends part of the budget before any
// text. The provider's default (2,000) ran out on thinking alone with claude-sonnet-5.
export const MAX_OUTPUT_TOKENS = 8000;

// Kept short and cheap on purpose: smoke exists to confirm the skill still produces a sane
// response at all, not to re-run the whole suite.
const SMOKE_CASE_IDS = ['new-low-risk-skill', 'mature-high-risk-text-skill'];

export interface RunFrameworkEvalOptions {
  mode: FrameworkEvalMode;
  provider: ModelProvider;
  providerName: string;
  model: string;
  cases?: FrameworkCase[];
  /** Which variants to run. Defaults: smoke -> B only; full/compare/approve -> A and B. */
  variants?: FrameworkVariant[];
}

function runOneCase(kase: FrameworkCase, variant: FrameworkVariant, provider: ModelProvider, model: string) {
  return (async (): Promise<FrameworkCaseResult> => {
    const fixture = kase.setup();
    try {
      const systemPrompt = buildSystemPrompt(variant);
      const result = await provider.generate({
        systemPrompt,
        userPrompt: fixture.requestText,
        model,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        metadata: { requestType: 'unclassified' },
      });
      const transcript = result.text;

      const outcomes = kase.expectedChecks.map((check) => {
        const outcome = CHECKS[check.name](transcript, check.arg);
        return { name: check.name, ok: outcome.ok, detail: outcome.detail };
      });

      // A standing invariant, not scenario-specific: whatever the case, the transcript must never
      // approve a baseline it has not shown it read.
      const alwaysOutcome = doesNotApproveUnreadBaseline(transcript);
      outcomes.push({ name: 'doesNotApproveUnreadBaseline', ok: alwaysOutcome.ok, detail: alwaysOutcome.detail });

      return {
        caseId: kase.id,
        variant,
        transcript,
        checks: outcomes,
        passed: outcomes.every((o) => o.ok),
      };
    } finally {
      fixture.cleanup();
    }
  })();
}

export async function runFrameworkEval(options: RunFrameworkEvalOptions): Promise<FrameworkRunResult> {
  const allCases = options.cases ?? FRAMEWORK_CASES;
  const cases = options.mode === 'smoke' ? allCases.filter((c) => SMOKE_CASE_IDS.includes(c.id)) : allCases;
  const variants: FrameworkVariant[] = options.variants ?? (options.mode === 'smoke' ? ['B'] : ['A', 'B']);

  const results: FrameworkCaseResult[] = [];
  for (const kase of cases) {
    for (const variant of variants) {
      results.push(await runOneCase(kase, variant, options.provider, options.model));
    }
  }

  const skillContent = buildSystemPrompt('B');
  const casesSnapshot = allCases.map((c) => ({ id: c.id, description: c.description, expectedChecks: c.expectedChecks }));

  return buildFrameworkRunResult({
    mode: options.mode,
    provider: options.providerName,
    model: options.model,
    results,
    skillContent,
    casesSnapshot,
    modelsConfig: { model: options.model, provider: options.providerName },
  });
}

function printReport(run: FrameworkRunResult, printTranscripts: boolean) {
  console.log(`\nSkill Framework eval (${run.mode}), ${run.timestamp}`);
  console.log(`Model: ${run.provider}/${run.model}  Git: ${run.gitCommit ?? 'unknown'}${run.gitDirty ? ' (dirty)' : ''}`);
  console.log(
    `Overall: ${run.summary.passed}/${run.summary.total} passed  ` +
      `(A: ${run.summary.byVariant.A.passed}/${run.summary.byVariant.A.total}, ` +
      `B: ${run.summary.byVariant.B.passed}/${run.summary.byVariant.B.total})\n`
  );
  for (const r of run.results) {
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.caseId} (variant ${r.variant})`);
    for (const check of r.checks) {
      if (!check.ok) console.log(`    - ${check.name}: ${check.detail}`);
    }
    if (printTranscripts) {
      console.log(`    transcript: ${r.transcript.slice(0, 500)}${r.transcript.length > 500 ? '...' : ''}`);
    }
  }
}

interface AdvisorRoleConfig {
  advisor: { provider: string; model: string };
}

function loadAdvisorConfig(configPath: string): AdvisorRoleConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Framework eval model config not found at ${configPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  if (!raw?.advisor?.provider || !raw?.advisor?.model) {
    throw new Error(`Framework eval model config at ${configPath} must define an "advisor" role with provider and model.`);
  }
  return raw;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = (args.mode ?? 'smoke') as FrameworkEvalMode;
  const modelsConfigPath = args['models-config'] ?? DEFAULT_MODELS_CONFIG_PATH;
  const modelsConfig = loadAdvisorConfig(modelsConfigPath);
  const model = args.model ?? modelsConfig.advisor.model ?? DEFAULT_MODEL;

  if (modelsConfig.advisor.provider !== 'anthropic') {
    throw new Error(`Unknown provider "${modelsConfig.advisor.provider}" for the framework eval advisor role.`);
  }

  // Filter cases by --cases=id1,id2 if supplied.
  let cases: FrameworkCase[] | undefined;
  if (args.cases) {
    const selectedIds = (args.cases as string).split(',').map((s) => s.trim());
    cases = FRAMEWORK_CASES.filter((c) => selectedIds.includes(c.id));
    if (cases.length === 0) {
      throw new Error(`No cases matched --cases=${args.cases}. Available: ${FRAMEWORK_CASES.map((c) => c.id).join(', ')}`);
    }
  }

  // A real Anthropic call, one per case per variant: this is the paid step. Never invoked by
  // `npm test`; only by an explicit `npm run framework:eval:*`.
  const provider = new AnthropicProvider();

  const run = await runFrameworkEval({ mode, provider, providerName: 'anthropic', model, cases });

  printReport(run, mode === 'approve');

  if (mode === 'approve') {
    const confirmedRead = args['confirm-read'] === 'true';
    const filePath = approveFrameworkBaseline(run, RESULTS_DIR, confirmedRead);
    console.log(`\nApproved baseline written to ${filePath}`);
  } else {
    const filePath = saveFrameworkRunResult(run, RESULTS_DIR);
    console.log(`\nRun saved to ${filePath}`);
  }

  if (run.summary.byVariant.B.passed < run.summary.byVariant.B.total) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
