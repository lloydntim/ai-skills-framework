/**
 * Runs the real production pipeline (generate -> validate -> revise, see src/runtime) against a
 * real spec, outside of chat and outside the eval harness. This makes real, paid model calls —
 * unlike `npm run check`, which only verifies an already-drafted letter for free.
 *
 *   npx tsx scripts/generate-letter.ts --spec spec.txt --lang en [--cv cv.txt] [--market uk]
 *     [--instructions "..."] [--out draft.txt] [--models-config config/models.haiku.json]
 */
import '@skills/framework/load-env-on-import';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { loadModelRoles } from '../src/model-config';
import { runProductionSkill } from '../src/runtime';
import type { CoverLetterTaskInput, RuntimeConfig } from '../src/runtime/types';
import { loadAllReferenceCvs } from '../src/reference-cv';
import { isMarket } from '../src/markets';
import type { LetterLanguage } from '../src/templates';
import runtimeConfigJson from '../src/runtime/runtime-config.json';
import { skillContextOption } from '../src/skill-sections';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    if (eq !== -1) {
      args[token.slice(2, eq)] = token.slice(eq + 1);
    } else {
      args[token.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function usageAndExit(): never {
  console.error(`Usage:
  npx tsx scripts/generate-letter.ts --spec <file> [--cv <file>] [--lang en|de] [--market uk|ie|dach]
    [--instructions "..."] [--out <file>] [--models-config <path>] [--skill-context full|by-task]

Calls the real production pipeline (src/runtime) against a real job spec — one paid model round
trip, plus any bounded revisions the semantic validator triggers. Needs ANTHROPIC_API_KEY.

Without --cv, uses the reference CVs under reference/ (see src/reference-cv.ts) — the same ones
the phrase bank is validated against, not necessarily what you'd actually send.
`);
  process.exit(1);
}

async function main() {
  const runId = randomUUID();
  process.env.MODEL_RUN_ID = runId;
  console.error(`Run ID: ${runId} (usage: npm run usage:summary -- --run-id=${runId})`);

  const args = parseArgs(process.argv.slice(2));

  if (!args.spec) usageAndExit();

  const market = args.market;
  if (market && !isMarket(market)) {
    console.error(`unknown --market "${market}". Use one of: uk, ie, dach`);
    process.exit(2);
  }

  const input: CoverLetterTaskInput = {
    cvText: args.cv ? fs.readFileSync(args.cv, 'utf-8') : loadAllReferenceCvs(),
    roleDescription: fs.readFileSync(args.spec, 'utf-8'),
    instructions: args.instructions ?? 'Write a cover letter for this role.',
    language: (args.lang ?? 'en') as LetterLanguage,
    templateLanguage: (args.lang ?? 'en') as LetterLanguage,
    market: market && isMarket(market) ? market : undefined,
  };

  const runtimeConfig: RuntimeConfig = { ...runtimeConfigJson, ...skillContextOption(args['skill-context']) };
  const roles = loadModelRoles(args['models-config']);

  const result = await runProductionSkill(input, roles, runtimeConfig);

  if (args.out) {
    fs.writeFileSync(args.out, result.finalText);
    console.error(`Saved: ${args.out}`);
  } else {
    console.log(result.finalText);
  }

  console.error('');
  console.error(`Validation: ${result.finalValidation.pass ? 'PASS' : 'FAILED (after max revisions)'}`);
  console.error(`Revision attempts used: ${result.revisionAttempts}`);
  console.error(
    `Scores — factualGrounding: ${result.finalValidation.scores.factualGrounding}, jobRelevance: ${result.finalValidation.scores.jobRelevance}, ` +
      `professionalTone: ${result.finalValidation.scores.professionalTone}, specificity: ${result.finalValidation.scores.specificity}, ` +
      `naturalness: ${result.finalValidation.scores.naturalness}, overall: ${result.finalValidation.scores.overall}`
  );
  if (result.finalValidation.hardGuardrailFailures.length > 0) {
    console.error(`Hard guardrail issues: ${result.finalValidation.hardGuardrailFailures.join('; ')}`);
  }
  console.error(`Model requests: ${result.requestCount}`);
  console.error(
    `Tokens used: ${result.totalUsage.totalTokens ?? 'unknown'} (input: ${result.totalUsage.inputTokens ?? 'unknown'}, output: ${result.totalUsage.outputTokens ?? 'unknown'})`
  );
  if (result.totalCost !== undefined) {
    console.error(`Estimated cost: $${result.totalCost.toFixed(4)}`);
  }

  if (!result.finalValidation.pass) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
