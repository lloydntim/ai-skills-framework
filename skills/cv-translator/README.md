# CV Translator — Skill + Evaluation Framework

## What this is

Two things live in this repo:

1. **The production skill** (`SKILL.md` + `src/runtime/`) — a small pipeline that translates/localises/rewrites CV text: generate a draft with the skill's instructions as the system prompt, validate it against hard and soft guardrails, and (if needed) run up to `maxRevisionAttempts` (default 5) targeted revisions before returning a final answer.
2. **The offline evaluation framework** (`evals/`) — a separate tool that answers "is this skill actually better than the base model, and did a recent change break anything?" by running fixed benchmark/golden cases through multiple configurations and scoring them with a blind LLM judge plus mechanical checks.

**These are not the same thing.** Runtime validation decides "is this one output good enough to return to a user, right now." Offline evaluation decides "is this skill, as a whole, actually an improvement, and is it safe to ship." The runtime validator is never used as the sole judge of whether the skill works — that's what `evals/` is for.

## Configurations (variants)

| Variant | What it is |
|---|---|
| A | Base model, no skill (baseline system prompt only) |
| B | CV skill, single shot, no runtime self-review |
| C | CV skill + runtime self-review (the actual production pipeline: generate → validate → revise) |
| D | Reserved for skill + self-review + an external translation provider (DeepL/Google/etc.) — not implemented; `evals/providers/variants.ts` throws a clear error if you select it until a real provider exists |

`pnpm eval` compares A vs B by default. Pass `--variants=A,B,C` to include self-review once you want to measure whether it's worth the extra tokens.

## Model configuration (roles)

Every point in the system that makes its own model call is a named **role**, not "the model":
`generator`, `validator`, `reviser`, `evaluator`, `pairwiseJudge`. Each resolves independently to
its own provider + model via `config/models.json`:

```json
{
  "generator": { "provider": "anthropic", "model": "claude-sonnet-5", "reasoning": "high", "maxOutputTokens": 16000 },
  "validator": { "provider": "anthropic", "model": "claude-sonnet-5", "reasoning": "medium", "maxOutputTokens": 8000 },
  "reviser": { "provider": "anthropic", "model": "claude-sonnet-5", "reasoning": "high", "maxOutputTokens": 16000 },
  "evaluator": { "provider": "anthropic", "model": "claude-sonnet-5", "reasoning": "medium", "maxOutputTokens": 8000 },
  "pairwiseJudge": { "provider": "anthropic", "model": "claude-sonnet-5", "reasoning": "medium", "maxOutputTokens": 8000 }
}
```

This is validated at load time (`framework/provider/registry.ts`) and fails clearly on a missing role, an
unknown provider, or a malformed entry — nothing is silently defaulted. `framework/provider/model-roles.ts`
and `registry.ts` are the only places a concrete provider class is named; production code
(`src/runtime/`) and the eval framework (`evals/`) only ever see the `ModelProvider` interface plus
a role's resolved model string.

**Runtime configuration** is split by what a setting is a property of. `src/runtime/runtime-config.json`
holds what is about this skill's pipeline: `temperature`, `maxRevisionAttempts`, and the `thresholds`
each validation score must clear. `config/models.json` holds what is about a role and its model: the
provider, the model, how hard that role reasons (`reasoning`) and the output budget it reasons and
answers within (`maxOutputTokens`) — the two are chosen together, since the model spends one budget
on both. No file in this skill names a provider's own thinking parameters; the ladder is
provider-neutral and `framework/provider/anthropic-provider.ts` translates it. See
`docs/ARCHITECTURE.md`, "Runtime configuration".

**Running an experiment matrix without touching source**: pass `--models-config=<path>` to
`pnpm eval`, `pnpm eval:regression`, or `pnpm translate` to point at a different file
following the same shape — e.g. `config/models.haiku.json` runs generation/validation/revision on
Haiku while keeping the judge on Sonnet (cheap generation, trustworthy scoring). Combine with
`--variants=` for the with/without-skill dimension:

```bash
pnpm eval -- --models-config=config/models.haiku.json --variants=B
pnpm eval -- --models-config=config/models.haiku.json --variants=A
pnpm eval -- --variants=B                                          # default config/models.json (Sonnet)
pnpm eval -- --variants=A
```

Every persisted result records the effective provider/model for every role (`modelRoles` in the
saved JSON), alongside the existing `model`/`evaluatorModel` fields kept for backward-compat display.

**Migrating from before this existed**: `src/runtime/runtime-config.json` and
`evals/config/eval-config.json` used to carry a top-level `model` (and `evaluatorModel`) field —
those are gone. If you have a local copy with those keys, delete them; model selection now lives
only in `config/models.json` (or whatever `--models-config=` points at).

## How the skill is loaded

`src/skill-loader.ts` reads `SKILL.md` directly at generation time. The evaluation framework imports the exact same loader (`evals/providers/variants.ts` → `src/runtime/generate.ts` → `src/skill-loader.ts`). **The skill text is never duplicated inside `evals/`** — edit `SKILL.md` and the next eval run automatically picks it up.

## Token and cost tracking

Every `ModelProvider.generate()` call returns real usage from the Anthropic API response (`response.usage`), never an LLM's self-estimate. `evals/token-tracker.ts` aggregates this per variant/category/case, and `src/runtime/index.ts` sums usage across all revision passes so you can see exactly how many extra tokens self-review costs.

Prices live in `framework/config/pricing.json` (US dollars per million input/output tokens), shared across skills, so adding a model or correcting a price needs no code change. `framework/provider/pricing.ts` is the only place that reads them: the provider uses it to cost one call, and the matrix summary uses it to cost a whole run, so the two cannot disagree. A model with no entry reports no cost rather than a cost of zero.

### Where the tokens actually go

The totals above tell you *how many* tokens a run used. `--token-report=true` (on `pnpm eval` and
`pnpm eval:regression`) tells you *what kind of call* they came from — before touching any
prompt wording, this is what identifies whether cost is coming from the initial translation, a
validation pass, a revision, or the judge.

Every request the runtime and eval code make is tagged with what it's for: `initial-generation`,
`semantic-validation`, `revision`, `revalidation`, `evaluator`, `pairwise-judge`, or
`unclassified` for any future call site that forgets to tag itself — it appears in the report rather
than silently vanishing from the totals. `framework/provider/instrumentation.ts` wraps a provider to record
this; the wrapping changes nothing about the request sent or the result returned; it only observes.

```bash
pnpm eval -- --token-report=true
pnpm eval:regression -- --token-report=true
```

```
Request type         Calls  Total tokens  % of total  Avg/call
-------------------  -----  ------------  ----------  --------
initial-generation      5         7,000       33.4%     1,400
revision                 3         4,900       23.4%     1,633
evaluator                5         3,650       17.4%       730
...

Highest-cost case(s) (top 5):
  golden-terminology-001: 9,030 tokens over 8 call(s) — revision: 3,400, initial-generation: 3,200, ...
```

It also records, per request, which major reusable prompt component was involved — `skill`,
`baseline-prompt`, `validation-rubric`, `evaluator-rubric`, `pairwise-rubric`, `task-instructions`,
`case-input`, `previous-output`, `candidate-outputs` — as a **character count**, not a token count.
No local tokenizer is available in this project and the provider only reports usage for a request as
a whole, never per section, so a token count per component would be invented rather than measured.
Character counts are a real, exact measurement, useful as a rough guide to relative size — never
read them as tokens.

This instrumentation is purely observational: nothing about a request or a response changes because
of it, and it makes no additional API calls.

## Guardrails

- **Hard guardrails** (`src/deterministic-checks.ts` + the `hardGuardrailFailures` the validator's LLM judge reports): invented responsibilities/technologies/metrics/achievements, changed dates/companies/products, "contributed" turned into "led", "worked with" turned into "owned", etc. A hard guardrail failure always triggers a revision attempt, and is never silently downgraded to a warning.
- **Quality (soft) guardrails**: naturalness, CV professionalism, terminology, conciseness — scored 1–5, thresholds in `src/runtime/runtime-config.json`. These can also trigger a targeted revision, but are treated as improvable, not fatal.

Runtime thresholds (`src/runtime/runtime-config.json`, all configurable):
```
Faithfulness: 5/5 required
Unsupported claims: 0 required
Naturalness: >= 4/5
CV quality: >= 4/5
Terminology: >= 4/5
```

## Revision behaviour

On validation failure, `src/runtime/revise.ts` sends the model the previous draft plus the *specific* list of failing criteria and asks it to fix only those — not to rewrite from scratch. This repeats until validation passes or `maxRevisionAttempts` (default 5) is reached, whichever comes first. There is no unbounded self-reflection loop.

## Adding a benchmark case

Add an object to any file under `evals/cases/benchmark/` (or a new file — anything under that directory is picked up automatically):

```json
{
  "id": "de-en-005",
  "category": "translation",
  "sourceLanguage": "de",
  "targetLanguage": "en-GB",
  "input": "...",
  "instructions": "...",
  "expectedFacts": ["..."],
  "forbiddenClaims": ["..."],
  "requiredExactStrings": ["..."],
  "requiredTerms": ["..."]
}
```

Use `evals/cases/experimental/` first for cases you're not sure about yet — the loader used by `run-evals.ts` only reads `evals/cases/benchmark/`, so experimental cases don't affect the tracked benchmark until you move them over deliberately. Keep benchmark cases stable once added — don't tune them to make the current skill look good; that defeats the point of the eval.

## Adding a golden case

Same schema, dropped into `evals/cases/golden/`. Golden cases are meant to be small in number and high-value: things that must never regress (ownership-language distinctions, exact metrics, exact technology/company/product names, no seniority inflation). They're run by `pnpm eval:regression`, not `pnpm eval`.

## Running things

```bash
cp .env.example .env   # add your ANTHROPIC_API_KEY

pnpm install

# The skill's version comes from skill.json (bump it there when you change SKILL.md or a prompt).
# Full A/B benchmark run (baseline vs skill)
pnpm eval

# Include the self-review variant
pnpm eval -- --variants=A,B,C

# Lock in the current golden-suite result as the approved baseline (do this once, after you trust a run)
pnpm eval:approve

# Run the golden regression suite against the approved baseline
pnpm eval:regression

# Compare against a specific past result file instead of the approved baseline
pnpm eval:compare -- --compare=2026-09-06T12-00-00-000Z-v1.json

# Unit tests (no API key needed, no tokens spent)
pnpm test
ppnpm test:watch

# Model x skill matrix: every configured model, with and without the skill
pnpm eval:matrix

# Narrow it to one variant first as a cheap wiring check
pnpm eval:matrix -- --variants=A
```

`pnpm test` is the only command here that costs nothing and needs no API key. It covers the
deterministic checks (required strings and terms, forbidden claims and characters, length ratio,
bold-marker and paragraph-structure preservation, repeated entry openers), the JSON parsing and
schemas, the runtime pipeline against scripted fake providers, and the matrix construction and
summary calculations — all without a single network call. The eval suites are what measure
translation *quality*; the unit tests pin down the mechanics around them.

Each `pnpm eval` / `pnpm eval:regression` run is saved as a new timestamped file under `evals/results/` — nothing is ever overwritten, so you always have full history (raw outputs, per-case scores, token usage, pairwise results, git commit).

## Comparing models: the skill/model matrix

`pnpm eval` answers "is the skill better than no skill, on one model". `pnpm eval:matrix`
answers a different question: **does the skill let a cheaper model approach a stronger model's
quality, and what does that cost?**

It runs the same benchmark cases, the same variants and the same judge across several generator
configurations. Configurations are listed in `config/matrix.json`, and each one points at a
model-role config file — no model name appears anywhere in the runner:

```json
{
  "configurations": [
    { "label": "cheap", "modelsConfig": "config/models.haiku.json" },
    { "label": "primary", "modelsConfig": "config/models.json" }
  ],
  "variants": ["A", "B"]
}
```

That produces the four cells: cheap without skill, cheap with skill, primary without skill, primary
with skill. Add a third configuration and it runs six; the list is **ordered cheapest-first**, and
that order is the only thing that tells the summary which side of a cross-model comparison a
configuration sits on.

`skillComparison` defaults to `A` (no skill) vs `B` (skill) and can be named explicitly — e.g.
`{ "withoutSkill": "A", "withSkill": "C" }` to measure the self-reviewing pipeline instead. Naming
it pins it: an explicitly named pair that the chosen variants cannot run is an error rather than
being silently ignored, which also means `--variants` can no longer narrow past it.

**Every configuration must use the same evaluator model.** Scores from different judges are not
comparable, which defeats the whole point, so the run refuses to start otherwise. Pass
`--allow-mixed-evaluator=true` to override deliberately. Note that `config/models.haiku.json`
already keeps `evaluator` and `pairwiseJudge` on the primary model for exactly this reason.

### What it records

Per model/variant cell: provider, model, skill mode, the evaluator scores, the count and ids of
cases that failed the hard deterministic checks, input and output tokens, request count, latency
where the provider reported it, and an estimated cost from `config/pricing.json`.

Costs are estimates and the summary says so. Where a cost cannot be known honestly it reports
nothing rather than a wrong number — a model with no pricing entry, a case where the provider
reported no usage, or a variant `C` cell whose generator, validator and reviser bill at different
rates (its token usage is pooled across all three, so no single price applies).

### What it calculates

- **Effect of adding the skill**, per model: quality change, extra tokens (absolute and percent),
  extra requests, cost change, and the change in deterministic failures.
- **Cheaper model with skill vs stronger model without skill**: the quality gap, token gap, cost
  gap and cost ratio.

### What it will not do

It does not name a winner. A single aggregate judge score is not a sound basis for that: scores move
by roughly 0.2-0.3 between identical runs, and a cell with fewer hard failures can still score
lower. The report prints the measurements and the caveats, and leaves the decision to you. This is
an evaluation tool — nothing here routes traffic or picks a model at runtime.

### Where results go

`evals/results/matrix/<timestamp>/` holds one full `EvalRunResult` per configuration (named by
label) plus `summary.json` with the matrix config, the effective per-role models, the cells and all
the deltas. As with single runs, nothing is ever overwritten.

## Interpreting PASS / REVIEW / FAIL / INCOMPATIBLE

- **FAIL** — a hard guardrail broke on a golden case: a forbidden claim, an unsupported claim from
  the evaluator, a missing required exact string (date/company/product/metric), a forbidden
  character, or broken structural formatting. Each has its own allowance in
  `evals/config/eval-config.json` → `regression.hardFail`, and `regression.hardFail.goldenFailures`
  sets how many failing cases the suite tolerates before the overall result is FAIL. Exits 1.
- **REVIEW** — no hard guardrail broke, but a quality score dropped past its threshold
  (`regression.reviewThresholds`) on at least one case, or total tokens rose past
  `tokenIncreasePercent`. Exits 0: a human should look, but it shouldn't block a merge, because
  judge scores are noisy and a real improvement can come with a wobble elsewhere.
- **PASS** — nothing broke and nothing dropped past a threshold.
- **INCOMPATIBLE** — no quality verdict is available, because this run and the baseline are not
  measuring the same thing. Exits 1, so a comparison that could not be made never reads as a pass.

A version can PASS on average while FAILing one specific case — that's why the report is per-case.
Averages hide exactly the regression golden cases exist to catch, and the deltas are averaged over
the comparable cases only, never across two different case sets.

## Comparability: what blocks a comparison

Before any score is compared, `evals/regression-compatibility.ts` checks that the two runs can be
compared at all, and reports every difference it finds as INFO, WARNING or INCOMPATIBLE.

**Blocking (INCOMPATIBLE) — the runs are not the same measurement:**

| What changed | Why it blocks |
|---|---|
| Evaluator model | A different judge produced the scores |
| Evaluator provider | Same model id, different service |
| Scoring rubric (`prompts/evaluator.md`) | Scores were produced under different instructions |
| A case removed | The comparison now covers less than the baseline did |
| A case edited under the same id | Its scores measure different inputs |
| The compared variant absent from this run | That variant was not checked at all |

**Warnings — compare, but know what moved:** a case added (no baseline for it), a case renamed, the
eval/runtime config hash, the generator model, the declared benchmark version, the dataset
fingerprint moving with no case-level change (usually reordering), the compared variant being absent
from the *baseline*, and each piece of metadata a legacy result does not record.

**Information only:** the skill hash changing — that is the expected reason to run a regression.
A skill hash that is *identical* is a warning instead, because then any score movement is evaluator
noise rather than a regression.

Every run records the fingerprints this relies on: `skillHash`, `caseInputHash`, `configHash`,
`evaluatorPromptHash`, the full per-role `modelRoles`, and a per-case `caseHash`. An older result
that lacks one is never assumed to match — the report says that piece could not be verified, and
recommends approving a fresh baseline to restore the check.

### Added, removed, renamed or edited cases

Case-set differences are derived from per-case content hashes, so four situations are told apart
rather than all appearing as "the case list changed":

- same id, different hash → **edited**, and its scores are not compared
- different id, same hash → **renamed**, and its baseline score is carried across
- in the baseline only → **removed**, listed in its own section of the report and given a per-case
  line reading `not run`. A removed golden case can never quietly vanish from the comparison.
- in this run only → **added**, checked on its own merits with no score comparison

Rename and edit detection needs hashes on both sides. Against a baseline saved before they existed,
the report says detection is unavailable instead of guessing, and a rename shows as one removal plus
one addition.

### Overriding

`pnpm eval:regression -- --allow-incompatible=true` compares anyway. The findings are still
reported in full, and the report is marked as overridden.

## Pairwise judging

`evals/pairwise-evaluator.ts` shows a judge two outputs from the same case labelled only "Output A" / "Output B", with which real variant is "A" on screen randomised per call (`Math.random() < 0.5`) so the judge can't learn a positional bias. The judge is never told which variant produced which output — see `prompts/pairwise-evaluator.md`.

## Limitations of LLM-as-judge

- Scores are noisy — expect ±0.2-0.3 point run-to-run variance even with `evaluatorTemperature: 0`. That's why `reviewThresholds` exist instead of treating any drop as a failure.
- The judge can be fooled by fluent-sounding but subtly wrong text; that's why deterministic checks (`src/deterministic-checks.ts`) exist as a mechanical backstop for anything checkable by substring match (dates, names, required terms, forbidden phrases) rather than trusting the judge alone.
- Don't tune the skill only against the ~12 starter benchmark cases — grow the benchmark (target: 20-50+) as you find real-world failure modes, or you're optimising for the test, not the skill.

## Adding a future translation-provider experiment (variant D)

1. Add a provider file under `evals/providers/` (e.g. `deepl-provider.ts`) implementing whatever call shape that provider needs.
2. Wire it into `runProductionSkill`-equivalent logic (or a new `runProductionSkillWithTranslationProvider` in `src/runtime/`) once it's part of production — don't invent the integration inside `evals/` only.
3. Update `evals/providers/variants.ts`'s `D` branch to call it instead of throwing.
4. Run `pnpm eval -- --variants=A,B,C,D` to see whether the extra provider is worth its token/cost/latency cost.

## Internal heuristic: quality-per-token

`evals/token-tracker.ts` exposes `qualityPerThousandTokens(qualityGain, tokenIncrease)` — e.g. "+0.6 quality points per additional 1,000 tokens." This is **an internal heuristic for this project only**, not an established industry metric — use it to sanity-check whether a change is worth its cost, not as a formal KPI.
