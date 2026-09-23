# Cover Letter Writer

Writes a tailored cover letter for one role, grounded entirely in the candidate's CV.

The instructions are in **`SKILL.md`**, which is the single source of truth. Nothing else in
this project holds a copy of them. Edit that file and rerun the tests without touching anything
else.

## Skill and candidate are kept apart

`SKILL.md` holds the rules and nothing about the person it writes for. Everything about them (name,
contact details, right-to-work status, the phrase bank and the examples drawn from their CV, their
voice and preferences) is a `{{PLACEHOLDER}}` in `SKILL.md`, filled at load time from a **candidate
profile**: a Markdown file with one `## KEY` section per placeholder (`src/candidate-profile.ts`,
`src/skill-loader.ts`). The contact blocks and right-to-work checks in `src/markets.ts` read the
same profile, so what the model is shown is what the checks enforce.

| What | Where | Exported |
|---|---|---|
| Rules, checks, runtime, evals code | `SKILL.md`, `src/`, `evals/`, `prompts/` | yes |
| The candidate's profile | `reference/candidate-profile.md`, or the file `COVER_LETTER_PROFILE` names | no |
| A fictional candidate that documents every key | `candidate-profile.example.md` | yes |
| The real letterhead `.docx` | `reference/templates/cover-letter-template.docx`, or the file `COVER_LETTER_TEMPLATE` names | no |
| A fictional letterhead, structurally identical | `templates/cover-letter-template.docx` | yes |
| Reference CVs, eval cases built from them | `reference/cv*.md`, `reference/evals/` | no |

The tests run against the fictional profile (`vitest.config.ts`), so they behave the same in an
exported copy. Tests that check the real profile, CV and cases load `reference/` explicitly and
are skipped where it is absent. To use the skill for someone else, copy
`candidate-profile.example.md` to `reference/candidate-profile.md` and replace every section.

## What is built

This follows the skill-builder blueprint, all 8 steps.

| Step | Status |
|---|---|
| 1. Instructions in one file | `SKILL.md`, read by `src/skill-loader.ts` |
| 2. Hard rules separated from soft | Hard rules section first in SKILL.md; two tiers in the check result |
| 3. Deterministic checks with unit tests | `src/deterministic-checks.ts` + `.test.ts` |
| 4. Golden cases | `reference/evals/golden/`, 12 cases (private: built from the real CV) |
| 5. Judge | `src/runtime/validate.ts` (production semantic validator) and `evals/evaluator.ts` (offline single-output evaluator) — two different jobs, two different rubrics |
| 6. Runner | `src/runtime/index.ts` (`runProductionSkill`, the live generate→validate→revise pipeline) and `evals/run-evals.ts` (the offline benchmark CLI) |
| 7. Variants | `evals/providers/variants.ts` — A (plain model), B (SKILL.md, single pass), C (the real production pipeline, called directly, never reimplemented) |
| 8. Runtime loop | `src/runtime/index.ts` — generate → deterministic + semantic validation → bounded, targeted revision → revalidation |
| + Phrase bank | Table in SKILL.md, rows from the candidate profile, parsed by `src/phrase-bank.ts` |
| + Preference bank | Table in SKILL.md, rows from the candidate profile, parsed by `src/preference-bank.ts` |
| + Letter templates | EN and DE fenced blocks in SKILL.md, parsed by `src/templates.ts` |
| + Reference material | `reference/` (private), the candidate profile, source PDFs, and a CV transcription used only to validate the phrase bank |
| + Benchmark cases | `reference/evals/benchmark/` (private), 10 cases across strong-match, partial-match, technology-gap, employer-preference-conflict and tempting-unsupported-claim, in English and German |

A checkout without `reference/` mounted (any public checkout) runs the same commands against the
synthetic cases in `evals/cases/golden/` and `evals/cases/benchmark/` instead — `skill.json`
declares both paths per dataset, and `resolveDatasetDir` (`framework/manifest/dataset-resolver.ts`)
picks whichever exists. Every saved run's `versions.datasets.<name>.source` says which one actually
ran (`"declared"` for the private cases, `"fallback"` for the public ones), so a public run's
result is never mistaken for a private regression run of the same nominal dataset (see
`docs/ARCHITECTURE.md`, "Datasets in a checkout without private material").

Steps 5 to 8 cost API tokens on every run, for as long as the project lives — `pnpm eval`,
`pnpm eval:regression` and `pnpm generate` all make real, paid model calls (see "Commands"
below for the full free/paid split). Nothing here has been measured against a model yet, and no
baseline has been approved (`evals/results/` starts empty; `pnpm eval` populates it, but
approving one as the baseline to compare future runs against is a separate, deliberate step this
project does not take automatically).

## Commands

Every command that can make a real model call is listed under **Paid** below and nowhere else.
Everything under **Free** touches no network and needs no API key.

**Free**

```
pnpm install
pnpm typecheck                              # type-check the whole project
pnpm test                                        # 441 tests, FakeModelProvider only — see below
pnpm test:watch
pnpm build:skill                            # install as a Claude skill + /cover-letter-writer command
pnpm build:cv -- --pdf "reference/cv/<file>.pdf" --out reference/cv.md --label "English CV"
pnpm context:sizes                          # how much of SKILL.md each letter is sent (sizes only)

# check an already-drafted letter against the CV, the spec and both banks
pnpm check -- --letter draft.txt --spec spec.txt --lang en

# turn a drafted .txt into the final .docx/.pdf (no model call — just formatting/conversion)
pnpm build:letter draft.txt "<Name> - Company - DD MM YY"

# usage and cost report from data/usage/*.jsonl — reads local files only, no network call
pnpm usage:summary -- --from=2026-09-01 --to=2026-09-30
pnpm usage:summary -- --group-by=tool
```

**Paid — makes real Anthropic API calls; needs `ANTHROPIC_API_KEY`**

```
# generate one real letter through the full production pipeline (generate -> validate -> revise)
pnpm generate -- --spec spec.txt --lang en
pnpm generate -- --spec spec.txt --lang en --cv cv.txt --market uk --out draft.txt

# benchmark suite: variants A, B and C against reference/evals/benchmark/
pnpm eval                     # default variants (A, B, C)
pnpm eval:ab                  # only A and B (skip the self-reviewing pipeline)
pnpm eval -- --variants=A,C
pnpm eval -- --models-config=config/models.haiku.json
pnpm eval -- --pairwise=B,C   # also run a blind pairwise comparison between two variants
pnpm eval -- --skill-context=by-task   # send only the SKILL.md sections each letter needs
pnpm eval -- --token-report=true       # also print tokens and prompt-part sizes per request type

# regression: run the golden cases through B and C, then compare or approve
# (eval:regression and eval:compare are the same command, run-regression.ts — kept
#  as two names for parity with cv-translator's script naming)
pnpm eval:regression                          # compare against the approved baseline
pnpm eval:compare -- --compare=<file.json>    # compare against a specific saved run
pnpm eval:compare -- --allow-incompatible=true
pnpm eval:approve                             # lock this run in as the new baseline
```

`pnpm test` never instantiates `AnthropicProvider` (`framework/provider/anthropic-provider.ts`) — every
unit test that needs a `ModelProvider` constructs `FakeModelProvider`
(`src/test-support/fake-model-provider.ts`) instead, a scripted in-memory stand-in with no network
access. `AnthropicProvider` is the **only** file in this project that imports the Anthropic SDK or
makes an HTTP request; every paid command above reaches it only through `framework/provider/registry.ts`
(`resolveModelRoles`), never directly. See "Model roles, provider selection and where API calls
happen" below for the full path.

## Usage and cost reporting

Every call the writing pipeline's `AnthropicProvider` makes is recorded to
`data/usage/YYYY-MM-DD.jsonl` (override the directory with `MODEL_USAGE_DIR`), one JSON line per
attempt, successes and failures alike. `src/usage/types.ts` documents the row; `src/usage/store.ts`
writes it, and never throws — a disk error drops the record rather than breaking the model call it
was describing. `data/` is not tracked.

```
pnpm usage:summary -- --from=2026-09-01 --to=2026-09-30
pnpm usage:summary -- --group-by=tool
pnpm usage:summary -- --group-by=model
pnpm usage:summary -- --run-id=<run-id>
```

## Running it

The skill is instructions for a model, not a program, but there is more than one way to get a
letter out of it.

**1. Installed, in any Claude Code session (free).** `pnpm build:skill` writes
`~/.claude/skills/cover-letter-writer/SKILL.md` and a `/cover-letter-writer` slash command. Then
paste a job advert and the CV, or type `/cover-letter-writer` with them. The skill also fires on its
own when a session sees a job advert plus a request for a cover letter. **Re-run `build:skill` after
every edit to `SKILL.md`**, or the installed copy goes stale. Drafting happens in whatever
Claude Code session you are already in, so it costs nothing beyond that session — no separate
Anthropic API key or billing.

**2. In a conversation in this repo (free).** Give a spec and a CV and ask for a letter. The same
`SKILL.md` applies, same as above.

**3. From the command line, for real (paid).** `pnpm generate -- --spec spec.txt --lang en` runs
the actual production pipeline (`src/runtime`, `runProductionSkill`) end to end against a real spec —
generate, deterministic + semantic validation, bounded revision — the same code path `pnpm eval`
exercises against benchmark cases. This is a real, billed Anthropic API call plus any revisions it
triggers; see "Model roles, provider selection and where API calls happen" below.

**4. Verify a draft (free).** `pnpm check -- --letter draft.txt --spec spec.txt --lang en` runs
every mechanical check and prints a hard/soft report, with no model call at all — the check is pure
string/regex analysis against `src/deterministic-checks.ts`.

Options 1 and 2 are how letters actually get written day to day; 3 exists for producing a letter (or
smoke-testing the pipeline) outside a chat session, and 4 is how any of the three outputs above gets
verified before it's sent.

### What the installed skill adds

The built skill is `SKILL.md` plus a chat wrapper from `adapters/claude/skill-template.md`. The
wrapper contributes frontmatter, input handling, and a twelve-point self-check, because
`pnpm check` does not run inside a chat session: the model has to verify its own draft there.
The build strips the source's `## Output format` section so the wrapper's `## Output` cannot
contradict it, and `scripts/build-claude-skill.test.ts` asserts exactly one survives.

## What each call sees

Each model call gets only what its job needs. The deterministic checks call no model.

| Call | System prompt | User prompt |
|---|---|---|
| Generate (generator) | `SKILL.md`, filled from the candidate profile | language, market, the market's contact block, instructions, advert, CV |
| Validate (validator) | `prompts/validator.md` only, never `SKILL.md`, so it is not primed by the rules it checks | CV, advert, instructions, language, draft |
| Revise (reviser) | The same text as Generate, so the revision is held to the same rules | the Generate prompt, the previous draft, and only the failures found (`describeFailures`) |
| Checks (no model) | - | the phrase and preference banks parsed from `SKILL.md`, and the market rules from the profile |
| Evaluator, pairwise judge (evals only) | their own rubrics, never `SKILL.md`; the pairwise judge is blind | CV, advert, instructions, the output(s) |

The candidate's details never live in `SKILL.md`; they are filled in at load time (see above).
Every call records the size of each prompt part (`--token-report=true` prints them).

**Selecting `SKILL.md` by task (opt-in).** Almost all of `SKILL.md` applies to every letter. Four
sections do not: the English and German letter templates and the German Anschreiben conventions
depend on the letter's language, and "Applying in the UK and Ireland" is of no use to a DACH letter,
whose contact block is already in the user prompt. With `skillContext: 'by-task'` (or
`--skill-context=by-task` on `eval`, `eval:regression` and `generate`), `src/skill-sections.ts`
leaves those out, keyed on the input's own `language` and `market`. With the real profile that saves
1.3% (German letter) to 12.9% (English letter for a DACH role) of the skill text; `pnpm
context:sizes` prints the figures. Eval cases carry a `market`, so the evals select on both fields,
exactly as production would.

**Measured, and not adopted.** Production still sends the whole file (`full`, the default). The
paid comparison that was to decide this has now been run: the 12 golden cases, 3 repeats, both arms
interleaved, variants B and C, `claude-sonnet-5` generating and `claude-opus-5` judging (23 September
2026; both arms summarised in `evals/history.jsonl`). It did not find the "no regression" the
default was waiting for. On variant C, the production pipeline, overall quality was unchanged
(+0.06, 95% CI [-0.50, +0.61], against a smallest detectable difference of 0.55) for a 10% cut in
generation input tokens — but the `en` / no-market cell fell from 7/9 to 3/9 on the deterministic
checks, and `golden-invented-tech-001` went from passing 3/3 under `full` to failing 3/3 under
`by-task`, exhausting its revision budget each time. The sections that case loses are the German
template and the German conventions, neither of which an English letter can use, so the removal
itself — not its content — is what moved the model. Other cases moved the other way by as much. A
selector that reshuffles which cases pass is not worth 10% of the input, so `by-task` stays opt-in,
as a diagnostic and as the thing to re-measure once the provider's thinking configuration is settled
(see [`docs/CONTEXT-ENGINEERING.md`](../../docs/CONTEXT-ENGINEERING.md) at the repository root).

## The two tiers

Hard rules fail the check outright. They are fabrications, or rules that are absolute:

- a required string or term missing
- a forbidden claim present (an upgraded ownership level, an invented employer)
- an em dash or en dash
- an unfilled template placeholder
- a technology named in the letter that the CV never mentions
- a number in the letter that is not in the CV
- a standard phrase whose CV anchor is absent, so it is not true of this CV
- a missing house-format marker, when a letter language is named
- a job preference claimed although the spec never offered it

Soft signals are reported but do not fail anything. They should prompt a rewrite of a sentence, not
block a letter, because quality signals that block get ignored:

- word count outside the target range
- cliches from the default list
- the same sentence opener used more than twice
- a standard phrase used although the spec contains none of its triggers

## The phrase bank

`SKILL.md` carries a table of reusable, pre-approved phrases, each with the spec triggers that
make it applicable and the CV anchor that makes it true. `src/phrase-bank.ts` parses that same
table, so the model is shown exactly the rows the checks enforce and the two cannot drift. Adding a
phrase is one edit, in the file that ships.

Triggers gate **eligibility**, not use: a spec about performance and CMS work makes five phrases
eligible, and SKILL.md caps actual use at two or three so the rest of the letter is written for the
role. A phrase used with none of its triggers present in the spec is reported (soft) because that is
how a letter stops answering the advert. A phrase is matched verbatim on purpose: SKILL.md tells the
model to adapt phrases to the spec, and an adapted phrase is the desired outcome, not a finding.

## The preference bank

Fourteen things the candidate wants from an employer, in a table in `SKILL.md` alongside the
phrase bank, each with the spec signals showing the employer actually offers it. This is what
paragraph 6 draws on to answer "why do you want to work here" with something specific.

**It is graded differently from the phrase bank, and the difference is the point.** A standard
phrase used without its trigger is a relevance miss: off-target, but still true of the candidate,
so it is soft. A preference used without its signal credits the employer with a benefit their
advert never offered. That is a false claim about *them*, so it fails outright.

```
Enterprise DACH role, five days on site in Munich
  wants:   learning-budget, international-team, modern-stack, flexible-hours
  BLOCKED: remote-work, small-team-flat, permanent-long-term, product-influence, ...
```

Signals match across German spelling variants: "Gründer" and "Gruender" both trigger `early-stage`,
because specs are written both ways, sometimes within one document.

## Letter templates

`SKILL.md` carries the house format as two fenced blocks, `cover-letter-en` and
`cover-letter-de`, parsed by `src/templates.ts`. The structure comes from two letters actually sent
(named in the candidate profile): a six-paragraph body of hook, headline credentials, stack
match, breadth, domain affinity, and motivation with close. Both source letters were English, so the
German template is derived from the same structure under the Anschreiben conventions rather than
transcribed from a German original.

Both templates expose the same 18 slots, so one CV fills either. Naming a `templateLanguage` opts
in to a structural check for that language's fixed markers ("Application for" / "Dear" / "Kind
regards", or "Bewerbung als" / "Sehr geehrte" / "Mit freundlichen Grüßen"). It is opt-in so that a
deliberate one-off format is not reported as broken.

The German template is taken from the sent Anschreiben, not derived: they open "Hallo <company>-Team,"
or "Liebes <company>-Team," and close "Viele Grüße," or "Freundliche Grüße,". An earlier version
required the formal "Sehr geehrte" / "Mit freundlichen Grüßen" pair and rejected all five real
letters. The formal register is still accepted, for a traditional employer with a named contact.

The 230-400 word range is measured, not guessed: seven sent letters run from 231 to 351 words.

Claims live in the letter body, so the fabrication checks skip everything above the salutation, and
skip URLs, email addresses and phone numbers anywhere. Without that, a postcode and a signature
block were reported as invented metrics on every letter, and "PREIS24" was read as the number 24.

## The reference CV

`reference/cv.md` is **not** an input to letter writing. Letters are written from whatever CV is
pasted into the conversation. It exists so `src/phrase-bank.test.ts` can check that every phrase in
the bank is still true of the CV.

Without it the bank's anchors were unvalidated: drop a role from the CV and the phrase anchored to
it silently becomes a false claim, discovered only when a letter goes out. Verified by removing
roles from the CV and watching exactly the phrases anchored to them fail.

It is generated from the source PDF by `pnpm build:cv`, not written by hand, so it cannot drift
from the document that is actually sent. All 15 load-bearing facts were confirmed against the PDF on
first generation. The same test file also asserts the load-bearing metrics and the exact
ownership wordings hard rule 2 depends on, listed in `reference/evals/cv-facts.json`. Source PDFs and the sent letters the templates came from are
in `reference/`; see `reference/README.md` for what is verified and what is not.

## Choosing what to cite

Which employers, achievements and technologies appear in a letter is selected per spec, not fixed.
SKILL.md ranks the CV's evidence against the spec's priorities rather than chronology, so a design
systems role leads with the component-library work even though it is not the most recent. The
current role is neither automatically first nor automatically included, and the same role carries
several accurate framings (architecture ownership, full-stack delivery, AI-assisted engineering,
client-facing discovery) depending on which one the spec asked about.

## Golden cases

12 cases across 7 files in `reference/evals/golden/` (some files hold more than one case for the same
hard rule, e.g. one English and one German variant), covering every hard rule, each built from a
real CV excerpt and a fictional advert, which is why they are private. They are validated by
`evals/cases.test.ts`, against the candidate's own profile, which checks
that no case forbids something its own CV says, that each case forbids something specific, and that
the CV excerpts do not force a faithful letter to break the dash rule.

## Benchmark cases

Ten cases in `reference/evals/benchmark/`, split across five categories in both English and German:
strong-match, partial-match, technology-gap, employer-preference-conflict and
tempting-unsupported-claim — the last two named for what they test, not what they demonstrate: a
tempting-unsupported-claim case pairs a CV fact with an advert that invites exaggerating it (a
specific percentage, formal people-management), so a passing letter has to decline the invitation.
Loaded by `evals/cases-loader.ts` the same way golden cases are, and run by `pnpm eval` against
variants A/B/C (see "Evaluating the skill" below). `reference/evals/experimental/` stays empty — a
holding area that nothing loads, so a half-formed case cannot quietly move the numbers.

## Evaluating the skill

`pnpm eval` runs the benchmark suite through three variants and persists one timestamped result
per run under `evals/results/` — it never overwrites a previous one. This costs real API tokens; it
is never run by `pnpm test`.

- **Variant A** — the plain model, no SKILL.md at all (`BASELINE_SYSTEM_PROMPT` in
  `src/skill-loader.ts`). Measures what the model does with no instructions, as a floor.
- **Variant B** — SKILL.md as the system prompt, one generation pass, no self-review. Measures what
  the instructions alone are worth.
- **Variant C** — the real production pipeline (`src/runtime`, `runProductionSkill`): generate,
  deterministic + semantic validation, bounded targeted revision, revalidation. `evals/providers/variants.ts`
  calls this function directly; the eval framework never reimplements the loop.

Every output, from every variant, is scored two ways: the same deterministic checks production
uses (`src/deterministic-checks.ts`, reused via `src/runtime/validate.ts`'s
`toDeterministicCheckInput`, not copied), and `evals/evaluator.ts`, a single-output judge scoring
factual grounding, job relevance, professional tone, specificity, naturalness, conciseness and
overall quality, blind to which variant produced the text. The judge's JSON reply is validated
against a zod schema (`evals/evaluator-schema.ts`) before any score is trusted — malformed output
is an error, never a defaulted score.

Generator and evaluator are configured independently, along with every other framework role
(semantic validator, reviser), via `config/models.json` — see `framework/provider/model-roles.ts`. Point
`--models-config` at a different file (e.g. `config/models.haiku.json`) to run the identical
benchmark against a different provider/model per role. See "Model roles, provider selection and
where API calls happen" below for the full picture.

### Model roles, provider selection and where API calls happen

Every point in the system that makes its own model call is a named **role**, not "the model":
`generator`, `validator`, `reviser`, `evaluator`, `pairwiseJudge` (`framework/provider/model-roles.ts`).
`validator` is named that, not just `validator`, because this project also has a
deterministic, non-model checker (`src/deterministic-checks.ts`) and the two must never be confused.
Each role resolves independently to its own provider + model via `config/models.json`:

```json
{
  "generator": { "provider": "anthropic", "model": "claude-sonnet-5", "reasoning": "high", "maxOutputTokens": 16000 },
  "validator": { "provider": "anthropic", "model": "claude-sonnet-5", "reasoning": "medium", "maxOutputTokens": 8000 },
  "reviser": { "provider": "anthropic", "model": "claude-sonnet-5", "reasoning": "high", "maxOutputTokens": 16000 },
  "evaluator": { "provider": "anthropic", "model": "claude-opus-5", "reasoning": "medium", "maxOutputTokens": 8000 },
  "pairwiseJudge": { "provider": "anthropic", "model": "claude-opus-5", "reasoning": "medium", "maxOutputTokens": 8000 }
}
```

`framework/provider/registry.ts`'s `resolveModelRoles` validates this at load time and fails clearly on a
missing role, an unknown provider, or a malformed entry — nothing is silently defaulted. Providers
are instantiated at most once per distinct provider name and shared across every role that names it.
`config/models.haiku.json` swaps `generator`/`validator`/`reviser` to Haiku while keeping
`evaluator`/`pairwiseJudge` on a stronger model, so a cheap-drafting run is still trustworthily
scored. Point any paid command at it with `--models-config=config/models.haiku.json`, or pass your
own file following the same shape.

**Where the actual network call happens:** `framework/provider/anthropic-provider.ts` is the only file in
this project that imports the Anthropic SDK (`@anthropic-ai/sdk`) or makes an HTTP request. Every
other file — the runtime (`src/runtime/`), the eval framework (`evals/`), and every script —
depends only on the `ModelProvider` interface (`framework/provider/types.ts`) plus a role's resolved model
string, never on a concrete provider class. `framework/provider/registry.ts` is the only place
`AnthropicProvider` is named. Concretely, a real call happens only when one of the **Paid** commands
above runs `loadModelRoles()` → `resolveModelRoles()` → `new AnthropicProvider()` → `.generate()`.

**Runtime configuration** is split by what a setting is a property of. `src/runtime/runtime-config.json`
holds what is about this skill's pipeline: `temperature`, `maxRevisionAttempts` (the hard cap on
bounded, targeted revision passes), and the `thresholds` each semantic-validation score must clear.
`config/models.json` holds what is about a role and its model: the provider, the model, how hard
that role reasons and the output budget it reasons and answers within — the two have to be chosen
together, since the model spends one budget on both. No file in this skill names a provider's own
thinking parameters; the ladder is provider-neutral and `framework/provider/anthropic-provider.ts`
translates it. See `docs/ARCHITECTURE.md`, "Runtime configuration".

**Result metadata** — every persisted `EvalRunResult` under `evals/results/` records `modelRoles`
(the effective provider, model, reasoning level and output budget actually used for every role that run), independent of the top-level
`gitCommit`/`skillHash`/`caseInputHash`/`configHash` provenance fields described below. `npm run
generate`'s stderr output prints the same role/model/token/cost information for a single ad hoc run.

`pnpm test` never touches any of this machinery for real. Most unit tests construct
`FakeModelProvider` (`src/test-support/fake-model-provider.ts`) directly — often via
`src/test-support/uniform-roles.ts`'s `makeUniformRoles`, which builds a full `ResolvedModelRoles`
map pointing every role at the same fake instance — and pass it straight to `runProductionSkill` or
another runtime function, never touching `resolveModelRoles` at all. The registry's own tests
(`framework/provider/registry.test.ts`) instead pass `resolveModelRoles` a `{ fake: () => new
FakeProvider() }` factory map, to test the resolution/validation logic itself. Either way,
`AnthropicProvider` is never constructed and `ANTHROPIC_API_KEY` is never read. `FakeModelProvider`
is a scripted in-memory stand-in: `queueResponse()`/`queueError()` load a FIFO queue of results, and
each call to `.generate()` pops the next one (or throws, for testing failure paths) — with no
network access at all.

### Reproducing a stored result

Every file in `evals/results/` carries what produced it: `gitCommit` and `gitDirty` (the exact
source state), `skillHash` (SHA-256 of `SKILL.md` as loaded for that run), `caseInputHash`
(SHA-256 of the benchmark cases as loaded), `configHash` (SHA-256 of the runtime + eval config in
effect), and `modelRoles` (the provider/model actually used for every role). To reproduce a run:
check out `gitCommit` (and note if `gitDirty` was true — the working tree had uncommitted changes
`git` alone cannot restore), confirm `skillHash`/`caseInputHash` match what's on disk now, and pass
the same models config. A hash mismatch means something changed since that run and its numbers are
not comparable to a fresh one.

No baseline is approved by this project yet: `pnpm eval` writes results, but nothing here treats
any one of them as the number future runs are measured against.

### Pairwise comparison

`--pairwise=X,Y` (any two of A/B/C) adds a blind head-to-head judge call per case: the two outputs
are shown as "Output A" / "Output B" with the presentation order randomised (`evals/pairwise-evaluator.ts`,
injectable `random` for deterministic tests), and the judge is never told which canonical variant
is which. The judge's raw justification text is persisted exactly as written — it is never rewritten
to swap "Output A" for a variant name, since that would be brittle string replacement over free
text. Instead `displayedAsA`/`displayedAsB`/`displayedWinner` record the exact display mapping used
for that call, which is enough to attribute the text correctly afterwards without touching it.
Aggregate wins/losses/ties (`evals/pairwise-aggregate.ts`) are always computed from the canonical,
already-unblinded `variantA`/`variantB`/`winner` fields — never from the display-slot metadata. A
pairwise result missing that display-slot metadata (position-bias tooling only) is excluded from
the position-bias summary rather than reconstructed from the canonical winner, which would silently
conflate the two different A/B alphabets.

### Regression comparison

`pnpm eval:regression` (alias: `pnpm eval:compare` — same script, two names, kept for naming
parity with the sibling `cv-translator` project) runs the **golden** cases (not benchmark) through
variants B and C and compares the result against the approved baseline
(`evals/results/approved-baseline.json`, written by `pnpm eval:approve`). Every case is compared
individually, never only as an aggregate average:

- **FAIL** — the current output breaks a deterministic hard rule (`deterministic.pass` is false).
  This is checked on the current result alone; it needs no baseline.
- **REVIEW** — no hard-rule failure, but a quality score (or total tokens) dropped beyond the
  thresholds in `config/eval-config.json`'s `regression.reviewThresholds`.
- **PASS** — otherwise, including a brand-new case with no baseline score to compare against.

Before any of that, `evals/regression-compatibility.ts` checks whether the two runs are measuring
the same thing at all: a changed evaluator model/provider/rubric, a removed or edited golden case,
or a missing variant. When that check finds the runs **INCOMPATIBLE**, `compareRuns` refuses
outright (throws `IncompatibleRunsError`) rather than silently producing numbers that look
meaningful — pass `--allow-incompatible=true` to compare anyway, which the report then marks
`overridden: true`. A merely **WARNING**-level difference (a changed generator model, an added
case) does not block the comparison but is always listed in the report.

