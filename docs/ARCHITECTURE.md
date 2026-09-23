# How skills are built here

This repository holds several skills. Every skill is laid out the same way, so if you know one, you
can find things in any other. One of them, `skill-framework`, is the skill used to create and change
the others (see "Add a skill"). This page explains the layout, the flow of a request, how quality is
measured, how versions are tracked, and how to add or export a skill.

## What a skill package is

A skill is a set of written instructions for a language model (`SKILL.md`) plus everything needed to
use it well and to know whether it works: prompts, rules that check the output, test cases, and a
way to compare one version against another.

A skill package is one folder under `skills/`. It contains all of that. It does not import from
any other skill. It may only import from `framework/`, the shared code.

## Folder layout

```
framework/                       shared code, one copy for every skill
skills/
  <skill-name>/
    SKILL.md                     the instructions (the single source of truth)
    skill.json                   name, version, and the version of every prompt and dataset
    README.md                    what it does, its commands, which ones cost money
    prompts/
      baseline.md                the plain system prompt for the "no skill" comparison
      validator.md               judges meaning and faithfulness of one output
      reviser.md                 asks for a targeted fix after a failed validation
      evaluator.md               offline scoring rubric for one output
      pairwise-evaluator.md      offline blind comparison of two outputs
    src/
      checks.ts (or similar)     deterministic rules; no model involved
      prompts.ts                 loads the files in prompts/
      model-config.ts            where this skill's config/models.json lives
      skill-dir.ts               the skill folder's path
      runtime/                   the production pipeline: generate, validate, revise
    config/
      models.json                which provider and model plays each role
      models.*.json              optional alternatives (for example, a cheaper set)
    evals/
      cases/benchmark/           many cases: "is the skill good?"
      cases/golden/              few cases: "did a change break something?"
      cases/experimental/        drafts, not loaded by anything
      config/eval-config.json    thresholds and default variants
      results/                   saved runs (ignored by git except approved-baseline.json)
      history.jsonl              one text-free summary per approved run (tracked)
    adapters/claude/             wraps SKILL.md so Claude Code can install it
docs/ARCHITECTURE.md             this page
docs/CONTEXT-ENGINEERING.md      what each model call is shown, and how that was measured
scripts/export-skill.ts          the export command
scripts/privacy-scan.ts          what "private" means, for the export and the tracked tree
```

Only some parts are required. Every skill needs `SKILL.md`, `skill.json`, `README.md` and tests.
The pipeline, prompts, datasets and evals are needed only if the skill has that behaviour.
`config/models.json` is required once `skill.json` declares a prompt.

## What is shared and what belongs to the skill

| Shared, in `framework/` | Belongs to the skill |
|---|---|
| The model-provider contract and the model roles | The rules that check the output (`checks`) |
| Provider adapters (Anthropic) and the price table | The prompt text and `SKILL.md` |
| Hashing, prompt files, `skill.json` and versions | The test cases |
| Run metadata (git commit, versions, hashes) | The scoring dimensions and their thresholds |
| The check that decides if two runs can be compared | The evaluator schema and the score types |
| Loading cases, hashing a case | What "faithful" or "job-relevant" means |
| Fake providers for tests | Any tooling specific to the task (for example, DOCX output) |

A rule such as "never turn *helped* into *led*" is domain knowledge. It lives in the skill, in both its
instructions and its checks. The framework never sees it. The framework only knows that a check
produces a pass or fail, and that an evaluator produces scores.

## Words used in the code

- **Checks**: rules that run without a model. Fast, free and repeatable.
- **Validator**: a model that judges meaning, such as whether a fact was invented.
- **Validation**: checks first, then the validator.
- **Reviser**: a model asked to fix only the problems that validation found.
- **Evaluator**: an offline model that scores one output against a rubric.
- **Pairwise judge**: an offline model that picks the better of two outputs, without knowing which is which.
- **Role**: a place where the system calls a model. The five roles are `generator`, `validator`,
  `reviser`, `evaluator` and `pairwiseJudge`. Each is set to a provider and model in `config/models.json`.
  Checks call no model, so they are not a role.
- **Variant**: what is being tested. `A` is the plain model, `B` is the skill in one pass, `C` is the
  full production pipeline.

## How a request runs (production)

```
input -> generator -> checks + validator -> pass?  -> return the text
                                             |
                                             no -> reviser -> checks + validator -> repeat,
                                                   up to maxRevisionAttempts, then return the last text
```

`runProductionSkill` in each skill's `src/runtime/index.ts` does this. It records every request, its
tokens, its time and its cost, by role. The evals call this same function for variant C, so the tests
of the pipeline are tests of the real thing.

Models are only ever reached through the `ModelProvider` interface in `framework/provider/types.ts`.
Only `framework/provider/anthropic-provider.ts` imports a vendor SDK. Adding another provider means one
new adapter and one line in `framework/provider/registry.ts`.

## How quality is measured (evals)

Three questions, three tools, kept apart on purpose:

| Question | Tool | Runs on |
|---|---|---|
| Is this one output good enough to return? | Validation | every call |
| Is the skill better than the plain model? | Benchmark: variants A, B, C over many cases, plus pairwise judging | on demand |
| Did my change break something that worked? | Golden cases against the approved baseline | before shipping |

Commands that call a model cost money and say so in each skill's README. `pnpm test` never calls one.

A saved run records what produced it (see "Versions and hashes"). `approve` copies a run to
`evals/results/approved-baseline.json`, which travels with the skill. `compare` runs the golden cases
again and compares them with that baseline.

`approve` also appends one line to `evals/history.jsonl`, which git keeps: the run's versions and
hashes, model roles, configuration, per-variant scores and totals, tokens per request type and the
size of each prompt part (`framework/evals/run-summary.ts`). It never holds output, case or CV text:
the summary keeps only numbers and the variant label from the scores, whatever the run contains. It
is how approved runs are compared over time, since the raw runs are not in git and each approval
replaces the baseline.

### When two runs cannot be compared

Before any score is compared, `framework/evals/regression-compatibility.ts` checks that the two runs
measure the same thing. It reports each difference with a level and a stable code:

| Level | Meaning | Examples |
|---|---|---|
| INCOMPATIBLE | Not the same measurement. No quality verdict is given. | evaluator prompt, model or provider changed; a case removed or edited; a different dataset |
| WARNING | Compare with care | generator, validator or reviser model changed; a case added; config changed; pairwise judge or prompt changed; a version was not bumped; a run is missing recorded data |
| INFO | True and expected | the skill or a production prompt changed; the working tree had uncommitted changes |

So changing the evaluator, its prompt or the dataset never looks like a change in the skill's quality.

## Versions and hashes

`skill.json` is where a person writes versions. The framework computes hashes from the files.

- **Version**: what the author intends ("validator prompt 2").
- **Hash**: what the bytes actually are (SHA-256 of the file, or of all cases in a dataset).

Tracked: the skill (`SKILL.md`) and its version, each prompt, and the benchmark and golden datasets.
Every eval run saves all of them, so a later reader can tell exactly what ran. If a hash changes but
its version does not, the comparison warns you to bump the version.

A prompt's version is in `skill.json`, not inside the prompt file. Changing a version number then
never changes the hash of what the model reads.

Every run also records: the skill name and version, the dataset used, each role's provider and model,
the git commit, whether the skill or framework had uncommitted changes, request, token, cost and time
totals for the run, and a hash of the configuration.

### Datasets in a checkout without private material

A dataset's `dir` in `skill.json` can point at private regression material (Cover Letter Writer's
does: `reference/evals/...`), which a public checkout never has mounted. Such a dataset also
declares `publicDir`, the synthetic fallback cover-letter-writer's own eval scripts already used
(`evals/cases/...`, built on `candidate-profile.example.md`). `resolveDatasetDir`
(`framework/manifest/dataset-resolver.ts`) is the one place that chooses between them: `dir` when it
exists, `publicDir` otherwise. `snapshotVersions` and `checkSkillPackage` both call it, so a public
checkout hashes and validates the same cases an eval run actually loads, instead of failing closed
on the private path or silently reporting its hash while public cases ran. The chosen source is
recorded on the dataset's version entry (`"declared"` or `"fallback"`), so two runs of the same
named dataset can never look like the same measurement when one ran against private cases and the
other against the public fallback; `regression-compatibility.ts` treats a source mismatch as
`INCOMPATIBLE`. A dataset with no `publicDir` (cv-translator's, skill-framework's) is unaffected:
its `dir` is the only copy, and a missing one is still a real, reported problem.

## What each model call sees

Each call is sent only what its job needs. A skill's **context requirements** say what that is: what
every call must have, what is fetched only for some tasks and from where, what stays outside the
skill, what outlasts a run, and which judgement gets a context of its own. They are written in the
skill's README under "What each call sees" (Cover Letter Writer has the worked example), with only
the answers that apply to that skill, each next to the test that checks it. They are not in
`skill.json` or `SKILL.md`: nothing reads them at run time, and the model does not need them. The
code that builds each prompt is their working form. The questions, the rules and the checks are in
the blueprint, section 7.15 (`skills/skill-framework/docs/skill-framework-blueprint.md`); the
`skill-framework` skill works through them whenever it creates or changes a skill.

Reading a reference file on demand, subagents, prompt caching and a host's memory are ways a host or
provider can meet a requirement. They belong in an adapter or a provider adapter, never in the
portable skill, which must still work where none of them exists.

What this repository already provides:

| Need | Where it is done here |
|---|---|
| Keep the skill's instructions in one file, filled from private data at load time | `SKILL.md` with `{{PLACEHOLDERS}}`, `renderTemplate` (`framework/prompts/prompt-file.ts`); the private values in the skill's `reference/` |
| Keep judges apart from the rules they judge | `prompts/validator.md`, `evaluator.md`, `pairwise-evaluator.md`; none of them receives `SKILL.md` |
| Revise with less than the whole validation | each skill's `describeFailures` in `src/runtime/revise.ts` |
| Measure each prompt part | `components` on the request metadata (`framework/provider/request-metadata.ts`), recorded by `RequestLog`; `--token-report=true` prints it |
| Select parts of `SKILL.md` by task | only Cover Letter Writer so far: `src/skill-sections.ts`, off by default. Move it to `framework/` when a second skill needs it |
| Keep a record that outlives one run | `skill.json` versions and run hashes; `evals/history.jsonl` |
| Check that each call gets only its parts | a pipeline test with a fake provider asserting `components` per request type (`src/runtime/index.test.ts` in Cover Letter Writer, `instrumentation-integration.test.ts` in CV Translator) |
| Check that private data never leaves | `scripts/export-skill.test.ts` for an export (which always leaves out `reference/` and `data/`), and `scripts/tracked-tree-privacy.test.ts` for the repository itself; both share the detectors in `scripts/privacy-scan.ts` |
| Check that leaving parts out costs no quality | the golden regression with selection on and off, repeated (paid) |

Prompt caching is not used. It would belong in the provider adapter, not in a skill, and turning it
on means also changing how cost and input tokens are counted (see `anthropic-provider.ts`).

## Testing

`pnpm test` runs all tests. No test calls a model. Each skill covers:

| What | Where |
|---|---|
| Deterministic rules | `src/*checks*.test.ts` |
| Production pipeline behaviour | `src/runtime/index.test.ts` with fake providers |
| Validation and revision behaviour | `src/runtime/*.test.ts` |
| Reading a model's structured reply | `framework/llm-json-response.test.ts` and the schema tests |
| Eval and comparison code | `evals/*.test.ts`, `framework/evals/*.test.ts` |
| Versions and hashes | `framework/manifest/*.test.ts`, `framework/evals/run-metadata.test.ts` |
| Following this layout | `src/skill-package.test.ts` (calls `checkSkillPackage`) |
| Prompt files | `src/prompts.test.ts` |

Fake providers are in `framework/testing/`.

## Add a skill

Use the `skill-framework` skill (`skills/skill-framework/`) for this. It holds the blueprint the
steps below come from, and it asks the questions a new skill should answer before it is built. Build
it into Claude Code with `pnpm --filter skill-framework build`.

1. Copy an existing skill folder to `skills/<new-name>/` and clear out what is specific to the old one.
2. Write `SKILL.md` and `README.md`. Anything about one real person goes in the skill's `reference/`
   folder and is filled in at load time, never written into `SKILL.md`.
3. Decide the skill's context requirements (blueprint section 7.15) and record them in the README
   under "What each call sees", each with the test that checks it. Answer only the questions that
   apply to this skill.
4. Edit `skill.json`: the name must equal the folder name. List only the prompts and datasets you have.
5. Put prompts in `prompts/` as `## System` and `## Task` sections with `{{PLACEHOLDERS}}`.
6. Put the domain rules in `src/`. Keep them in this skill.
7. Write `config/models.json` with all five roles.
8. Add cases under `evals/cases/`.
9. Run `pnpm test`. `src/skill-package.test.ts` tells you what is missing from the layout.

A skill that is only instructions can stop after step 4. It needs no pipeline or evals.

## Export a skill

```
pnpm export-skill cv-translator                # writes exports/cv-translator-1.1.0.zip
pnpm export-skill cv-translator --to=../demo   # writes a folder, for a separate repository
```

The archive has the same layout as this repository, with only that skill:

```
framework/  skills/<name>/  docs/ARCHITECTURE.md  package.json  pnpm-workspace.yaml  tsconfig.base.json
.env.example  EXPORT.md  export-manifest.json
```

The recipient runs `pnpm install && pnpm test`. Nothing else is needed.

Never included: `.env` and other env files (except `.env.example`), `node_modules`, `.git`, build folders,
logs, raw eval runs, other skills, and anything in the skill's `export.exclude` list in `skill.json`.
Private material is also never included, from any skill and whatever `export.exclude` says: the
skill's `reference/` and `data/` folders (apart from a `README.md` in them), and any PDF or office
document. Keep the candidate's own CVs, letters and records in those folders.
Before writing, the export stops if a key-shaped string is found, if the skill fails the layout check,
or if any import points at a file that is not in the archive.

`--to` only replaces files a previous export wrote (it reads `export-manifest.json`). It refuses a folder
that has other files in it, apart from `.git`.

Keeping private material in those folders is what makes the exclusion enough, so a skill that
writes for one person keeps that person out of its reusable files. Cover Letter Writer does this:
`SKILL.md` names each candidate detail as a `{{PLACEHOLDER}}`, filled at load time from
`reference/candidate-profile.md`; the eval cases built from the real CV live in `reference/evals/`;
and a fictional `candidate-profile.example.md` documents the profile and backs the tests.
`scripts/export-skill.test.ts` exports the real skills and fails if any of the candidate's contact
details, or any line of their profile, CVs or CV-based cases, appears in the archive.

The approved regression baseline is the same kind of material: it is a full run over the golden
cases, so it holds every drafted letter. Cover Letter Writer therefore keeps its
`approved-baseline.json` in `reference/evals/results/`, not in `evals/results/` (see "Folder
layout" above) — `evals/regression.ts`'s `findLatestApproved` and `evals/run-regression.ts`'s
`--approve=true` step both read and write it there. `evals/history.jsonl` still records every
approval, but only the text-free summary described below.

cv-translator's eval cases are synthetic CV text and need no such split. Its approved regression
baseline is a full run over those cases, so it follows the same `reference/evals/results/` pattern
as Cover Letter Writer's, kept there because an earlier approved run was made before two contaminated
cases were replaced with synthetic ones.

## Known gaps

- Score types, aggregation, regression scoring and reporters are still one copy per skill, because
  they depend on the skill's own score dimensions. They follow the same names and shape.
- The per-variant token tracker (`token-tracker.ts`) exists only in cv-translator. The per-request
  report (`framework/evals/token-usage-report.ts`) is shared: both skills print it with `--token-report=true`.
- Cover Letter Writer's usage ledger (`src/usage`) is its own; it wraps the framework provider.
- Approved baselines made before this layout do not record prompt or dataset versions. Comparing
  against one shows "unverifiable" warnings until a new baseline is approved, which needs a paid run.
