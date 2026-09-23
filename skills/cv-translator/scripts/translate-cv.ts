import fs from 'node:fs';
import '@skills/framework/load-env-on-import';
import { parseArgs } from '@skills/framework/cli-args';
import { loadModelRoles } from '../src/model-config';
import { runProductionSkill } from '../src/runtime';
import type { CvTaskInput, RuntimeConfig } from '../src/runtime/types';
import runtimeConfigJson from '../src/runtime/runtime-config.json';

function usageAndExit(): never {
  console.error(`Usage:
  npm run translate -- --input=<file> --source=<lang> --target=<lang> --instructions="..." [--target-market=<market>] [--out=<file>] [--model=<model-id>] [--models-config=<path>]

Example:
  npm run translate -- --input=cv-section.txt --source=de --target=en-GB \\
    --instructions="Translate and localise this for a senior software engineer CV." \\
    --out=cv-section.en.txt

--model overrides the generator/validator/reviser models from config/models.json (or whatever
--models-config points to) all at once, for a quick one-off run. To use genuinely different models
per role (e.g. Haiku to generate, Sonnet to validate), point --models-config at your own JSON file
following the same { generator, validator, reviser, evaluator, pairwiseJudge } shape instead.
`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.input || !args.source || !args.target || !args.instructions) {
    usageAndExit();
  }

  const sourceText = fs.readFileSync(args.input, 'utf-8');

  const input: CvTaskInput = {
    sourceLanguage: args.source,
    targetLanguage: args.target,
    input: sourceText,
    instructions: args.instructions,
    targetMarket: args['target-market'],
    maxLengthRatio: args['max-length-ratio'] ? Number(args['max-length-ratio']) : undefined,
  };

  const runtimeConfig: RuntimeConfig = runtimeConfigJson as RuntimeConfig;
  const roles = loadModelRoles(args['models-config']);

  if (args.model) {
    // A single flag covering all three production roles at once, for a quick override — matches
    // this script's previous single-`--model=` behavior. For per-role model differences, use
    // --models-config with your own file instead.
    roles.generator = { ...roles.generator, model: args.model };
    roles.validator = { ...roles.validator, model: args.model };
    roles.reviser = { ...roles.reviser, model: args.model };
  }

  const result = await runProductionSkill(input, roles, runtimeConfig);

  if (args.out) {
    fs.writeFileSync(args.out, result.finalText);
    console.error(`Saved: ${args.out}`);
  } else {
    console.log(result.finalText);
  }

  console.error('');
  console.error(`Validation: ${result.validation.pass ? 'PASS' : 'FAILED (after max revisions)'}`);
  console.error(`Revision attempts used: ${result.revisionAttempts}`);
  console.error(
    `Scores — faithfulness: ${result.validation.scores.faithfulness}, naturalness: ${result.validation.scores.naturalness}, ` +
      `cvQuality: ${result.validation.scores.cvQuality}, terminology: ${result.validation.scores.terminology}`
  );
  if (result.validation.hardGuardrailFailures.length > 0) {
    console.error(`Hard guardrail issues: ${result.validation.hardGuardrailFailures.join('; ')}`);
  }
  console.error(
    `Models — generator: ${roles.generator.model}, validator: ${roles.validator.model}, reviser: ${roles.reviser.model} (provider: ${roles.generator.providerName})`
  );
  console.error(`Model requests: ${result.requestCount}`);
  console.error(
    `Tokens used: ${result.totalUsage.totalTokens ?? 'unknown'} (input: ${result.totalUsage.inputTokens ?? 'unknown'}, output: ${result.totalUsage.outputTokens ?? 'unknown'})`
  );
  console.error(`Total latency: ${result.totalLatencyMs !== undefined ? `${result.totalLatencyMs}ms` : 'unknown'}`);
  console.error(`Total cost: ${result.totalCost !== undefined ? `$${result.totalCost.toFixed(4)}` : 'unknown'}`);
  for (const role of ['generator', 'validator', 'reviser'] as const) {
    const usage = result.usageByRole[role];
    console.error(
      `  ${role}: ${usage.requestCount} request(s), ${usage.usage.totalTokens ?? 'unknown'} tokens, ` +
        `cost ${usage.cost !== undefined ? `$${usage.cost.toFixed(4)}` : 'unknown'}`
    );
  }
  console.error(
    `Length: ${sourceText.length} -> ${result.finalText.length} chars (ratio ${(result.finalText.length / sourceText.length).toFixed(2)})`
  );

  if (!result.validation.pass) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
