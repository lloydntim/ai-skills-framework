# Skill Framework Blueprint

How the `cv-translator` project is built, written so the same structure can be applied to any
other skill. Nothing here is about CVs specifically — the CV skill is only used as the worked
example.

---

## 1. The problem this solves

A skill is a set of written instructions handed to a model. The trouble with written instructions
is that you cannot see them working. You change a line, run it once, read the output, and think
"that looks better" — but you have no way to know whether it is actually better, whether it is
better on average, or whether fixing one thing quietly broke another.

This framework answers three separate questions, and the whole design comes from keeping them
separate:

| Question | Answered by | When it runs |
|---|---|---|
| Is this one output good enough to hand back right now? | Runtime validation | Every single call, in production |
| Is the skill better than not having a skill at all? | Benchmark suite + variants | When you want to justify the skill |
| Did the change I just made break something that used to work? | Golden suite + approved baseline | Before you ship a change |

**These are not the same question and must not share a mechanism.** The most common mistake is
letting the production validator double as the proof that the skill works. It cannot be: it is
part of the thing being tested, it only ever sees one output at a time, and it never compares
against anything.

---

## 2. When this is worth building

Build it when **all** of these are true:

- The skill's output is text judged on quality, not a value that is simply right or wrong.
- You intend to keep editing the instructions over time.
- A wrong output has a real cost (a false fact on a CV, a wrong legal summary, a bad code review).

Skip it, or build only part of it, when the skill is a one-off, when output correctness is
mechanically checkable end to end, or when you will write the instructions once and never touch
them again.

You can adopt it in pieces. Section 8 gives the order, and the first two steps are useful on their
own. Before committing to anything past step 4, read section 3: it turns "this will cost real
tokens" into an actual number you can decide against.

---

## 3. What one run costs

Before writing an eval runner, or running one that already exists, work out the call count. Every
one of these dimensions multiplies the cost of the next: cases times variants times trials, plus
one evaluator call per case, plus one pairwise-judge call per case when exactly two variants are
compared, plus one extra generate call and one extra validate call per revision attempt a case
actually needs (variant C only).

Concretely, for this project's own benchmark suite: N benchmark cases, the default 2 variants (A,
B), 1 trial, no revision loop on A or B, comes to roughly `2N` generate calls plus `N` evaluator
calls plus `N` pairwise calls. Adding variant C roughly doubles the generate-side cost and adds up
to `maxRevisionAttempts` extra generate-plus-validate pairs per case that fails first-pass
validation. Running the model/skill matrix (`npm run eval:matrix`) multiplies the whole thing again
by the number of configured generator configurations.

State which commands are free and which spend money every time you write or hand over a new one:

| Command | Cost |
|---|---|
| `npm test` (unit tests) | Free. No API key, no network call. |
| `npm run eval` | Real tokens: cases times variants generate calls, plus evaluator and pairwise calls. |
| `npm run eval:regression` | Real tokens, over the deliberately small golden set. |
| `npm run eval:matrix` | Real tokens, multiplied again by the number of configured model configurations. |

Do not require the full paid framework (steps 5-8 of section 8) for every skill. A skill with no
measurable output-quality dimension, or one you will edit once and never touch again, should stop
at step 4 and never run a priced command at all. Recommend the smallest level that answers the
question actually being asked, and say so out loud before building anything past it.

---

## 4. The parts

```
skill/
  SKILL.md                     The instructions. The single source of truth. Frontmatter limited
                                to open Agent Skills fields (name, description); see section 5.
  claude-skill-template.md     Platform adapter: wraps SKILL.md for a Claude Code chat install.

src/
  skill-loader.ts               Reads SKILL.md. Also holds the plain baseline prompt.
  deterministic-checks.ts       Mechanical rules over the skill's own output. No model involved.
  deterministic-checks.test.ts  Unit tests for those rules.
  llm-json-response.ts          Extracts and schema-validates the JSON block in a judge's reply.
  provider/
    types.ts                    The ModelProvider contract (section 6).
    model-roles.ts              Role names (generator, validator, reviser, evaluator,
                                 pairwiseJudge) and the config shape each resolves to.
    registry.ts                 Turns raw {provider, model} config into ready-to-call providers.
    <name>-provider.ts          One file per concrete provider (e.g. anthropic-provider.ts). The
                                 only place that provider's SDK is imported.
    request-metadata.ts         What a request was for: request type plus prompt-component sizes.
    instrumentation.ts          Wraps a provider to record every call into a shared request log.
    pricing.ts                  Cost-per-million-token table, plus estimateCost/hasPricing.
  runtime/
    index.ts                    generate -> validate -> revise loop.
    generate.ts                 First draft (baseline or skill system prompt).
    validator.ts                Deterministic checks plus a judge model. Decides pass/fail.
    validator-schema.ts         Schema the judge's own JSON reply must satisfy (section 7.4).
    revise.ts                   Targeted fix of only the failing points.
    runtime-config.json         Temperature, max tokens, revision limit, per-dimension thresholds.

evals/
  cases/benchmark/               Many cases. Measures "is the skill good?"
  cases/golden/                  Few cases. Measures "did anything break?"
  cases/experimental/            Cases you are not sure about yet. Not loaded by anything.
  cases-loader.ts, case-hash.ts  Loads a case directory; fingerprints one case's content (excluding
                                  its id) so a rename can be told apart from an edit.
  prompts/evaluator.md           The judge's instructions (single output).
  prompts/pairwise-evaluator.md  The judge's instructions (two outputs, blind).
  evaluator-schema.ts, pairwise-schema.ts   Schemas the two judges' JSON replies must satisfy.
  providers/variants.ts          Defines what A, B, C, D each mean; the A/B isolation boundary
                                  lives here.
  evaluator.ts, pairwise-evaluator.ts   Score one output; pick a blind winner between two.
  position-bias.ts               Counts how often the judge favours display slot A over slot B.
  aggregate.ts                   Per-variant score/token/latency averages.
  token-tracker.ts, token-usage-report.ts   Per-variant and per-request-type token/cost breakdowns.
  run-metadata.ts                Builds the reproducibility record attached to every saved run
                                  (section 7.10).
  regression.ts                  Compares a run against the approved baseline, case by case.
  regression-compatibility.ts    Decides whether two runs may be compared at all, before any score
                                  is.
  reporter.ts                    Terminal report plus saves the run to disk.
  results/                       Every run, ever. Never overwritten. See section 7.12 for where
                                  this should live long-term as it grows.
  config/eval-config.json        Judge model settings, regression thresholds, default variants.

config/
  models.json                    Provider and model for every role (section 6).
  pricing.json                   Cost-per-million-token table, keyed by model id.
  matrix.json                    Optional: the model x skill comparison grid (section 8).

scripts/
  build-claude-skill.ts          Builds SKILL.md into an installed chat skill plus slash command.
```

To port this to another skill, the names change but the roles do not. Replace "translate CV text"
with your task, and replace the scoring dimensions (section 10).

---

## 5. Portable skill vs platform adapters

Reusable skill logic, the instructions a model follows, should be written once, against the open
Agent Skills specification, and stay usable by any agent host that can read a Markdown file with
YAML frontmatter. Nothing about *what the skill does* should depend on which chat client, CLI or
IDE loads it.

Three things must stay separated, and none of them may leak into either of the others:

| Layer | What it holds | Example in this repo |
|---|---|---|
| Canonical skill instructions | The workflow itself: what to do, in what order, with what hard rules. Frontmatter limited to open-spec fields (`name`, `description`, and similarly generic keys). | `SKILL.md` |
| Platform adapter | Packaging that turns the canonical instructions into something one specific host can install: a wrapper template, an output-format substitution, a build script. Carries no workflow rules of its own. | `scripts/build-claude-skill.ts`, `adapters/claude/skill-template.md` |
| Platform invocation settings | Settings that only make sense inside one host: manual versus automatic invocation, model routing, subagent wiring, tool or permission grants. | `disable-model-invocation: true` (Claude Code only), a host's own permission list |

**The canonical skill remains authoritative.** An adapter reads it and repackages it; it never
forks a second copy of the rules to edit separately. `scripts/build-framework-skill.ts` enforces
this literally for skill-framework's own packaging: it fails loudly if the platform template stops
pointing at `reference/blueprint.md`, and it injects `disable-model-invocation: true` at build
time rather than storing it in the portable source, so the portable artifact's frontmatter never
carries a field the open specification does not define.

**Build at least two explicit targets, not one default with flags bolted on:**

- a **portable** target: the canonical instructions plus their reference material, frontmatter
  limited to standard fields, installable by any Agent-Skills-compatible host.
- a **platform** target (e.g. Claude Code): the same instructions, plus that host's own invocation
  settings layered on at build time.

**Adapters must not duplicate the workflow.** If a platform wrapper needs to say something the
canonical file already says, point at the canonical file instead of re-explaining it: the same
rule as 7.1 below, one level up: two copies of a rule are two places for them to disagree, and one
of them will eventually be edited without the other. A platform-specific slash command that exists
only to point at the skill (not to add rules) is fine for hosts that need one; treat it as legacy
scaffolding once the host can invoke skills directly, and generate it only on request rather than
by default.

---

## 6. Provider and model-role architecture

**Every model call goes through one generic contract**, never through a provider SDK's own types
directly:

```
GenerationRequest  { systemPrompt?, userPrompt, model, temperature?, maxOutputTokens?, reasoning?, metadata? }
GenerationResult   { text, usage?, latencyMs?, cost? }
TokenUsage         { inputTokens?, outputTokens?, totalTokens?, cachedInputTokens?, reasoningTokens? }
ModelProvider       generate(request): Promise<GenerationResult>
```

`reasoning` is a provider-neutral ladder (`none` | `low` | `medium` | `high` | `xhigh` | `max`) set
per role, not per call site, and `maxOutputTokens` is the ceiling reasoning *and* the answer share.
A skill never writes a provider's own thinking parameters: the adapter translates the ladder into
whatever the model accepts, and refuses a pairing it cannot express rather than guessing.

Every field past `text` is optional, because not every provider reports every one of them, and a
field the provider did not report must stay absent rather than being invented (section 7.11).

**Every point in the system that makes its own model call is a named role, not "the model":**

- **generator**: produces the first draft.
- **semantic validator**: the runtime judge that decides pass or fail for one output.
- **reviser**: produces a targeted fix after a validation failure.
- **evaluator**: the offline judge that scores one output on its own.
- **pairwise judge**: the offline judge that picks a blind winner between two outputs.

Each role resolves independently to its own provider and model (`config/models.json`), so a cheap
model can validate while an expensive one judges, or generation can run on one provider while
evaluation runs on another. Production code and the offline eval framework never see a concrete
provider class, only a role's resolved `ModelProvider` plus a model string. `src/provider/registry.ts`
is the only place a concrete provider is named, so adding a second provider is one more entry
there and nothing else changes.

**Keep SDK-specific code inside provider adapters, and nowhere else.** `src/provider/anthropic-provider.ts`
is the only file in this project that imports `@anthropic-ai/sdk`. It is also the only place that
translates a provider's own response shape (Anthropic's `response.usage`, its cache and thinking
token fields) into the generic `TokenUsage` shape everything else reads. A second provider adapter
does the same translation for its own SDK; nothing above the adapter layer needs to know either
SDK exists.

---

## 7. The design rules

These are the decisions worth copying. Each one exists because the obvious alternative fails.

### 7.1 The skill text lives in exactly one file

`SKILL.md` is read at runtime by the loader, and the eval framework imports that same loader.
The instructions are never copied into the eval code, and never copied into a platform adapter
either (section 5).

**Why:** the moment the eval has its own copy, you are measuring a version of the skill that is not
the one you ship. Every edit would need to be made twice, and one day it won't be.

**Test of whether you got this right:** you can edit the instructions and rerun the evals without
touching any other file.

### 7.2 Two tiers of failure, never one

- **Hard guardrails** — things that must never happen. A fact changed, a number altered, a claim
  invented, a required name missing. These are absolute. They are never softened into a warning.
- **Soft criteria** — things that should be good. Naturalness, tone, concision, no repetition.
  Scored 1-5 against a threshold. A failure here means "try again", not "this is broken".

Both trigger a revision at runtime. Only hard guardrails can fail a regression run.

**Why:** if everything is fatal, you cannot ship, because quality scores wobble. If nothing is
fatal, you ship a CV with an invented job title on it.

Concretely, in this project: `hardGuardrailFailures` blocks; `failingCriteria` prompts a rewrite.
`lengthExceeded` and `repeatedEntryOpeners` are deliberately soft and deliberately excluded from
the mechanical `pass` flag.

### 7.3 Check mechanically first, ask a model second

`deterministic-checks.ts` runs before the judge and uses no model at all. It checks only things
that can be settled by looking at the text: is this exact string present, is this phrase absent,
is the bold formatting count the same, is the number of entries the same.

This rule is about the skill's own output. A judge's own structured reply needs a different check,
covered next.

**Why:** a judge model can be talked round by fluent writing. It will read a confident paragraph
that dropped a date and score it 5/5. A substring check cannot be talked round, costs nothing, and
runs in a millisecond.

**The rule for deciding which is which:**

> If you can write it as a check over the text alone, it is mechanical. If it needs an opinion, it
> needs a judge.

| Mechanical | Needs a judge |
|---|---|
| Required exact strings (dates, names, numbers) | Does it read naturally? |
| Forbidden phrases and characters | Is the tone right for this audience? |
| Output length against the source | Is the terminology handled correctly? |
| Structure preserved (list count, markup count) | Has a claim been overstated? |
| Repeated openings across list entries | Is this genuinely better than the last version? |

### 7.4 Schema-validate every structured model response

Every point where a model is asked to return structured data (the semantic validator, the
single-output evaluator, the pairwise judge) gets a schema (`validator-schema.ts`,
`evaluator-schema.ts`, `pairwise-schema.ts` in this project, one Zod object each) that the reply is
checked against before anything reads a field off it.

**Successful JSON parsing is not enough.** `JSON.parse` only proves the text was syntactically
valid JSON; it says nothing about whether the fields are the ones the caller is about to read, or
whether a score sits inside the range the rubric promised. `src/llm-json-response.ts` performs both
steps for every judge call in this project: it extracts the first `{...}` block, parses it, then
runs it through the caller's schema, and throws a distinct, typed error
(`LlmResponseValidationError`, carrying the schema issues) when the shape is wrong.

**Reject explicitly, never coerce:**

| Problem | Handling |
|---|---|
| A required field is missing | Fails validation. Never defaulted to null, 0 or empty. |
| A field is the wrong type | Fails validation. A `"4"` where a `4` was required is not coerced. |
| A score is out of range | Fails validation. `faithfulness: z.number().int().min(1).max(5)` rejects 0, 6 or 3.5. |
| A winner is not one of the allowed values | Fails validation. `z.enum(['A', 'B', 'tie'])` rejects anything else, including a made-up fourth option. |

A schema failure here is a broken eval run, not a low score. Treat it as a bug to fix, in the
prompt, the model or the schema, never as a data point to average in.

### 7.5 Every mechanical check gets unit tests

`deterministic-checks.ts` has `deterministic-checks.test.ts` beside it, run with `npm test`. No API
key, no tokens, under a second.

**Why:** these rules are fiddly and they interact. Loosening one rule to fix a complaint is exactly
how you silently break another. Unit tests are the only part of this whole framework that is free
and instant, so there is no reason not to have them.

**And:** tests written after the code pass on the first run, which proves nothing. Break the source
on purpose and confirm the right test fails. In this project that found a redundant `+` in a regular
expression that no test could distinguish, because the behaviour was already handled elsewhere.

### 7.6 Revision is bounded and targeted

On failure, the model is sent the previous draft plus the specific list of what failed, and asked to
fix only that. Capped at `maxRevisionAttempts` (default 5).

**Why:** "try again" produces a different draft with different problems. "Fix these three things"
produces the same draft with three fewer problems. And an uncapped loop is an uncapped bill.

### 7.7 Variants prove the skill is worth having, and A versus B must be a controlled experiment

| Variant | What it is |
|---|---|
| A | The exact same model, without the skill loaded. The baseline. |
| B | The exact same model, with the skill loaded, single pass. |
| C | Skill plus the full generate -> validate -> revise loop. |
| D | Reserved for a further step (here: an external translation provider). Throws a clear error until implemented. |

Runs compare A against B by default.

**Why A matters most:** without it you can only say "the skill produces good output." You cannot
say "the skill produces *better* output than not bothering." Only the second claim justifies the
work. B against C tells you whether self-review earns the extra tokens it costs.

**A versus B is only a valid experiment if exactly one thing differs between the two calls.** Hold
these constant:

- provider and exact model id (not "a similar model", the same string)
- effort or reasoning setting, if the provider exposes one
- the task input, and any fixture state it depends on
- available tools
- permissions
- limits and timeouts

The only intended difference is whether the skill's instructions are in the system prompt. In this
project that discipline is structural rather than a convention to remember: `generateDraft`'s
`mode` parameter (`'baseline' | 'skill'`) switches only the system prompt string
(`BASELINE_SYSTEM_PROMPT` versus `loadSkillPrompt()`, both in `src/skill-loader.ts`); everything
else, provider, model, temperature, max tokens, the user prompt, is the same call site
(`src/runtime/generate.ts`).

**Isolate variant A from the skill under test, not just from its own prompt.** If A runs as a raw
API call, as it does in this project, the skill cannot leak in through anything other than the
prompt you wrote. If A instead runs through an agent host, a chat client, an IDE assistant,
anything that can auto-load an installed skill or a project or plugin config, that host must not
have the tested skill installed, enabled, or otherwise discoverable in that run. A skill sitting in
an installed-skills directory can make itself available to variant A regardless of what the system
prompt says, and a passing A/B comparison run that way is not measuring what it claims to.

Keep the unimplemented variant in the list and make it throw a helpful error. It documents the plan
and stops someone half-wiring it.

### 7.8 Two case sets with two different jobs

- **Benchmark** (`cases/benchmark/`, aim for 20-50+): broad coverage. Answers "is it good?".
  Grow this as you find real failures.
- **Golden** (`cases/golden/`, deliberately few): the things that must never regress. Answers "did I
  break it?". Each one exists because of a specific failure you care about.
- **Experimental** (`cases/experimental/`): not loaded by anything. A holding area, so a half-formed
  case cannot quietly move your numbers.

A trial (section 7.14) multiplies runs within one case; it does not change which set a case belongs
to.

**Why split them:** a regression run over 50 cases is slow and noisy. A quality measurement over 6
cases is meaningless. Different jobs, different sizes.

**The rule that keeps it honest:** once a case is in the benchmark, do not edit it to make the
current skill look better. At that point you are tuning the exam, not the student.

### 7.9 Compare against an approved baseline, per case, and check the comparison is valid first

One run is locked in as the approved baseline (`eval:approve`). Later runs are compared against it,
**case by case**, not only on averages.

**Why per case:** a version can improve the average while destroying one specific case. Averages
hide exactly the failure that golden cases exist to catch.

Four outcomes, not two or three:

- **FAIL** — a hard guardrail broke. Exits non-zero, safe to block a merge on.
- **REVIEW** — no guardrail broke, but a quality score dropped past a threshold, or token usage
  rose past its own threshold. Exits zero. A human should look. It does not block.
- **PASS** — neither.
- **INCOMPATIBLE**: no quality verdict is available, because the two runs are not measuring the
  same thing. Exits non-zero, so a comparison that could not be made never reads as a pass.

**Why INCOMPATIBLE exists, and why it is a fourth thing rather than a FAIL:** a FAIL means the skill
got worse. INCOMPATIBLE means the question was not answerable at all: a different evaluator model
scored the two runs, the rubric changed, a golden case's content was edited under the same id, or
the case the comparison needs is missing from one side. Collapsing that into FAIL would train a
reader to distrust the check; collapsing it into PASS would be worse, a silently unanswered
question dressed as a clean result.

**Check comparability before reading a single score.** Decide whether two runs can be compared at
all before setting any numbers against each other: same evaluator model and provider, same rubric
fingerprint, and the same golden case by content hash, not by id alone, since a case can be renamed
without changing content, or edited without changing its id. Report every difference found at one
of three levels: INFO (expected, e.g. the skill hash changed, which is the reason to run a
regression at all), WARNING (compare, but know what moved, e.g. a case was added, or the eval
config changed), or INCOMPATIBLE (the two runs are not the same measurement, full stop). Support a
deliberate override for a run that must proceed anyway, and record in the report that it was
overridden, never silently.

**Case-set differences are four situations, not one.** Derive them from a per-case content
fingerprint that hashes everything about a case except its id:

- same id, different hash -> **edited**. Its score is not compared; it measures a different input now.
- different id, same hash -> **renamed**. Its baseline score carries across.
- present in the baseline only -> **removed**. Reported, never silently dropped, with its own line
  reading "not run".
- present in this run only -> **added**. Checked on its own merits, no score comparison.

Rename and edit detection needs the fingerprint on both sides. Against an older result saved before
it existed, say detection is unavailable rather than guessing; a rename then shows as one removal
plus one addition, and the report says so.

### 7.10 Every persisted run carries its own reproducibility fingerprint

A saved result is worthless for later comparison unless it also records exactly what produced it.
Every run this framework saves should carry:

- a result schema version (bump only when a field's meaning changes, not when a new optional field
  is added)
- the full git commit, when the code ran inside a git checkout
- whether the tree was dirty at the time
- a hash of the skill text itself
- a hash of the case set actually loaded
- a hash of the effective configuration (eval config, runtime config and the model-role config all
  folded in)
- a hash of the evaluator and rubric prompt(s) used to score it
- the provider and model actually resolved for every role, not only the generator
- the runtime or agent-client version, when that is knowable and meaningful for the host the run
  happened on
- a timestamp
- the trial count (section 7.14)
- whatever seed information was available

Concretely, this project's `RunReproMetadata` (`evals/run-metadata.ts`) already carries the first
eight of these; trial count and seed information are not yet populated, because trials themselves
are not yet implemented (7.14).

**Support older result formats explicitly. Do not silently reinterpret a missing historical
field.** Every one of these fields is optional on the persisted type, specifically so a result
saved before a field existed still loads. The rule that keeps this safe is what a reader does with
the absence: never assume a missing schema version means version 1, never assume a missing case
hash means the case is unchanged, never assume a missing display-slot field means no position bias.
Report the absence as "cannot be verified" and let 7.9's compatibility check decide what that
implies, usually a WARNING, sometimes an INCOMPATIBLE, never a silent pass.

### 7.11 Account for every observable request, and say what you don't know

Every point where the system makes its own call to a model is a candidate row in a usage ledger:
the first generation, semantic validation, a revision, a revalidation, single-output evaluation,
pairwise evaluation. In this project these are exactly the tagged request types
(`src/provider/request-metadata.ts`), plus `unclassified` for any call site that forgot to tag
itself, so an untagged call shows up as a visible row instead of vanishing from the totals.

**Record, for each attempt:**

- a logical request id (what logical step this is, e.g. "case X's initial translation")
- an attempt id (this call may be the 1st, 2nd or 3rd attempt at that same logical step, after a
  retry)
- a parent run id (which evaluation run, or which production invocation, this attempt belongs to)
- the role or tool that made the call (generator, validator, reviser, evaluator, pairwiseJudge, or
  a production caller)
- provider and model, both requested and actual (a request can ask for one model and be served by a
  different one, e.g. after a provider-side fallback)
- input and output tokens
- cache and reasoning token detail, when the provider reports it (`cachedInputTokens`,
  `reasoningTokens` in this project's `TokenUsage`)
- latency
- success or failure, and which retry attempt this was
- provider-reported charge, when the API returns one
- an estimated cost and the pricing-table version it was estimated under, when a provider charge is
  not available

**Keep an unknown value unknown. Never convert it to zero.** `estimateCost()` in this project
returns `undefined`, not `0`, when a model has no pricing-table entry or the provider reported no
token counts; a run whose cost cannot be known is not a free run, and a report that shows 0 for it
is actively misleading, not just imprecise. The same discipline applies to latency, reasoning
tokens and every other optional field: absence means "not measured", and every summary that adds
these numbers together must propagate that absence rather than silently treating it as 0
(`addOptionalNumber` in `src/runtime/index.ts` is the concrete pattern: it returns `undefined` only
when both sides are `undefined`, so one real measurement is never erased by one missing one).

**Distinguish a provider-reported charge from a calculated estimate.** They are not the same kind
of number, one came from the bill, one came from a local price table that can be stale or wrong,
and a report that mixes them without saying which is which is reporting a number nobody can trust.

**Hidden SDK retries cannot be reported as individually observed attempts.** An HTTP client that
retries a request internally, on a timeout, a rate limit, a transient server error, may make two or
three real calls to the provider for what the application code sees as one `generate()` call.
Nothing at the `ModelProvider` layer can see those, so the usage ledger will under-count in that
case. Say so plainly wherever the ledger's guarantees are documented, rather than implying every
provider call is captured: it is every call the application code issued that is captured.

### 7.12 Two ledgers, never merged: results and usage

Every evaluation run is saved as its own immutable, timestamped file
(`evals/results/<timestamp>-<version>.json` in this project). Nothing is ever replaced.

**Why:** the question "when did this get worse?" is unanswerable without history, and it is always
asked after the fact.

**Keep usage records and evaluation results as two separate things**, because they answer different
questions and are consumed differently:

- an **evaluation result** is one run's full scored outcome: per-case scores, deterministic-check
  findings, aggregates, pairwise results. Read occasionally, compared against a baseline, kept as
  project history.
- a **usage record** is a ledger of every individual model request the system made (section 7.11).
  Read for cost and spend questions, potentially large, append-only, and not something you want
  diffed in a pull request.

**Recommend append-only usage records, one line per observable attempt, in a format that tolerates
a crash mid-write.** JSONL is the obvious starting point: one JSON object per line, so a truncated
last line is the only damage a crash can do, and nothing needs to be parsed as a whole file to
append to it. Store this outside the project's own git history, in configurable application-data
storage: an XDG-style data directory, a directory the user points the tool at, or an external store.
A spend log is operational data, not source, and it grows without bound in a way a repository
should not have to carry.

**Establish exactly one authoritative usage record per observable attempt.** An evaluation result
summary (a role usage summary, a token-report row) may reference the usage ledger's rows, by the
same request and attempt ids, but a spending report must never add a total computed from
result-summary fields to a total computed from the usage ledger. Doing that double-counts every
request that appears in both, and the report will not look wrong; it will just be roughly double.

**Do not log prompts, responses, credentials or raw provider errors by default.** A usage record is
about how much and what kind, not what was said. A record that carries the actual CV text or the
actual API key is a data-handling liability that a spend log has no reason to be.

### 7.13 Judge blind, and never rewrite an explanation to relabel it

The pairwise judge sees "Output A" and "Output B" with no idea which system made either, and which
one is shown first is randomised on every call.

**Why randomise:** judges have a positional preference. If the skill's output is always second, some
of your measured improvement is just that.

**Persist both alphabets, and never confuse them.** A pairwise call produces two different "A/B"
framings that must both survive to the saved result: the displayed framing (`displayedWinner`,
`displayedAsA`, `displayedAsB` in this project) is literally what slot the judge picked and which
canonical variant sat in it for that one call; the canonical framing (`winner`, and the
per-dimension fields) is that same answer translated back to "variant A won" or "variant B won"
after unblinding. The judge's own `justification` text is written in terms of the displayed
framing, e.g. "Output A does X". Keep it exactly as returned, and use the recorded slot mapping to
attribute it correctly after the fact, rather than editing the text itself to swap the letters.
**Never rewrite an explanation through free-text A/B replacement**: a string-substitution "fix"
that swaps "A" and "B" inside prose will also swap any other occurrence of those letters and cannot
be trusted to be correct.

**Aggregate wins, losses and ties from the canonical variant, never from the display slot.** A
count of "how often did slot A win" measures the judge's position bias (`position-bias.ts`), which
is a different question from "how often did variant B beat variant A" (`countPairwiseWins` in
`reporter.ts`, which reads the already-unblinded `winner`, `variantA` and `variantB` fields). Keep
both numbers, and never let one stand in for the other.

### 7.14 Repeat trials, because one model call is not a measurement

A single generation is one sample from a distribution, not a stable answer. Run each case more than
once when the result will inform a decision, and say plainly when it was not.

- **One trial** is enough for a smoke check: did the wiring work, does the skill produce roughly
  sane output.
- **At least three trials** for anything a real conclusion will rest on: an A/B comparison, a
  regression judgment, a decision recorded in section 13.

Make the trial count configurable, not hard-coded, and record it on the saved run (section 7.10
carries it explicitly for exactly this reason). Record whatever seed information the provider or
the harness makes available, even if it cannot force determinism; it at least lets a specific run's
conditions be described precisely later, which matters more once trials are in play than when
everything ran once.

This project does not implement trials yet. Every case currently runs exactly once per variant per
invocation. Treat this as the next thing to add before trusting a close A/B call, not as already
covered by running `npm run eval` twice by hand.

### 7.15 Decide what each call sees

Every model call is assembled from parts: the instructions, the task input, reference material, an
earlier output, a list of failures. Which parts go into which call, and which stay out, decides what
a run costs and often how well the model follows the rules. Decide it on purpose, for each call the
skill makes, and write the decision down in the skill's README, where the next person changing the
skill will look. Do not add a heading for every idea below to `SKILL.md`: the model does not need to
read about its own context.

Four moves cover it. Most skills already use some of them without the name.

| Move | What it means | Examples |
|---|---|---|
| Write | Keep what must outlive one call or one run outside the prompt, in files | versions and hashes (7.10), saved runs and a summary of each approved one, the usage ledger (7.12) |
| Select | Bring in only what applies to this task | a phrase bank whose rows fire on the input's own words; a section of the instructions used only for one language or market |
| Compress | Send less for the same information | the reviser gets the list of failures, not the whole validation (7.6); an adapter points at a reference file instead of copying it (section 5) |
| Isolate | Keep judgements apart from the rules they judge | a validator and evaluator with their own prompts, never the skill text; a blind pairwise judge (7.13); variant A with no skill at all (7.7) |

**Questions to answer when creating or changing a skill.** Answer the ones that apply. A small
skill that is only instructions may need two of them; a skill with a pipeline needs most.

- **Required.** What must every call have? Usually the hard rules, the output format and the task
  input.
- **Optional.** What helps only some tasks: one language, one market, one kind of input? Name the
  condition that selects it, in a field the code can see rather than in the model's reading of the
  input, so the selection can be tested.
- **Sources.** Where does each part come from: the skill file, the user, a private profile, a
  reference file, an earlier call?
- **External.** What must never be inside the reusable skill? Anything about one real person (name,
  contact details, CV text, preferences) lives in private runtime data, filled in when the skill is
  loaded. The skill says what it needs; the data supplies it. The same holds for its test cases and
  saved outputs.
- **Just in time.** What is large and rarely needed? In a chat host, put it in a reference file the
  instructions point at, so it is read only when relevant (this skill does that with its blueprint).
  In a pipeline, select it in code.
- **Persist.** What has to survive the conversation or the run? Store a summary rather than raw
  output when the output contains someone's private text.
- **Compress.** What is passed again and again that could be passed as less? A later call should get
  the result of an earlier one (a failure list, a score), not its whole input a second time, unless
  it needs it.
- **Isolate.** Which judgement must not be primed by the instructions it is judging? Give that call
  its own prompt. Use a separate agent or subagent only when a subtask needs a clean context, a
  different set of tools, or runs in parallel. Each one starts with no context and has to rebuild
  it, so it is not free.

**Rules that hold whatever the answers:**

- **Measure before cutting.** Record the size of each prompt part on every request (`components` on
  the request metadata in this project; characters, not tokens, see 7.11). Cut what is large *and*
  unused by that call, not whatever is largest.
- **Selecting is a change to the production prompt.** Treat it like any edit to `SKILL.md`: the
  golden cases must show no regression, and where scores are close it needs repeated trials (7.14).
  Fewer tokens is not an improvement if the rules are followed less well. Ship it switched off, and
  switch it on after the comparison.
- **Select whole sections from the one source file.** Never keep a second, shorter copy of the
  instructions by hand (7.1). Selection by code reads `SKILL.md` and leaves sections out; it fails
  loudly if a section it selects on is renamed.
- **A call must see every rule its output is checked against.** If a check enforces a rule, the
  call being checked, and any call that revises its output, must have been shown that rule or the
  facts needed to meet it.
- **Caching belongs to the provider, not the skill.** Get the composition right first. A prompt that
  puts the parts that never change before the parts that do is also the one a provider can cache.
  Whether to turn caching on, and how to account for its cost, is decided in the provider adapter
  and never becomes part of the skill.

**Record the answers as the skill's context requirements.** They go in the skill's README, under
"What each call sees". Write only the answers that apply, in the shape that fits the skill:

- *A skill that is only instructions*, read by a chat or agent host: a few lines. What the
  instructions must always carry, which reference files they point at and when each should be read,
  what the user supplies, what stays outside the skill, and what (if anything) is written to a file
  so it outlives the conversation.
- *A skill with a pipeline*: one row per model call (generate, validate, revise, the judges), saying
  what goes in its system prompt and its user prompt, then a note on anything selected by task and
  anything stored after the run. Cover Letter Writer's README is the worked example.

Next to each decision, name what checks it (see "Checking the decisions" below). Nothing reads these
requirements at run time, so they do not belong in `skill.json` or in the model's instructions. The
code that assembles each prompt is the working form of them, and a test keeps the code and the README
in step.

**The skill says what, the host decides how.** Reading a reference file only when needed, running a
subtask in a subagent, caching a prompt, keeping notes in a host's memory: each host does these
differently, or not at all. The requirements name the need ("the German conventions only for a German
letter"; "the checker never sees the rules it checks"). An adapter (section 5) or a provider adapter
(section 6) decides how one host meets it. Subagent wiring is a platform invocation setting; caching
is the provider's. The portable skill must still work, at a higher cost, in a host that loads every
file at once and has no subagents.

**Checking the decisions.** Use the checks the skill already has. Do not build a separate harness for
context.

| Decision | How it is checked | Cost |
|---|---|---|
| Each call gets exactly the parts its row names; a judge never gets the skill text | A pipeline test with a fake provider that asserts the prompt parts (`components`) recorded for each request type | Free |
| A selector never drops a section a check enforces, and fails if a section is renamed | Unit tests on the selector | Free |
| Nothing about one real person is in a reusable or exported file | The export test, which fails if profile lines appear in the archive | Free |
| A reference file the instructions point at is in the built skill | The build or its validation fails if the pointer or the file is missing | Free |
| Which part of the prompt is large | The request log's part sizes (token report) | Free with fakes, paid with a model |
| Leaving parts out does not lower quality | The golden cases with selection on and off, repeated (7.14) | Paid |
| A chat skill reads a reference file when the task needs it, and not otherwise | A workflow case (section 9) whose transcript check looks for it | Paid |

A small instructions-only skill usually needs only the export test and the reference-file check.

**Why:** the easy default is to send everything to every call. It costs the most, it gives a judge
the rules it should be checking independently, and it leaves no record of which part of the prompt
a change affected.

**Test of whether you got this right:** for each call the skill makes, you can say which parts of the
prompt it receives and why, the request log shows their sizes, and a free test fails if a call starts
receiving a part its row does not name.

---

## 8. Porting an existing skill, in order

Each step is useful on its own. Stop wherever the value runs out for your case. Whenever a step adds
a model call, decide what that call sees (7.15).

**1. Move the instructions into one file.** `SKILL.md`, loaded by one loader function. Nothing
else may contain a copy. If the skill is currently pasted into two places, this step alone is worth
doing.

**2. Write down the hard rules explicitly.** Go through the instructions and mark each rule as
either "must never happen" or "should be good". Most existing skills mix these together in one list,
which is why the model treats them as equally negotiable. Put the hard rules in their own section,
first.

**3. Build the deterministic checks.** Take every hard rule from step 2 and ask: can this be checked
by looking at the text? Implement the ones that can. Give each one a field in the result object,
and decide explicitly whether it affects the overall pass flag. Write the unit tests as you go, and
break the code on purpose to confirm the tests catch it.

**4. Write 5-10 golden cases.** One per hard rule, each capturing a specific failure you have
actually seen or genuinely fear. Small input, clear expectation. Fields: `input`, `instructions`,
`expectedFacts`, `forbiddenClaims`, `requiredExactStrings`, `requiredTerms`.

**5. Write the judge prompt.** Pick 4-6 scoring dimensions for your task (section 10). Demand JSON
only, state the exact shape, and tell it to keep list items to short phrases so long outputs do not
blow up the response. Give it a schema (7.4) before the first real run, not after the first
malformed reply.

**6. Build the runner and lock a baseline.** Run the suite, read the outputs yourself, and only
approve a baseline once you actually trust that run. An approved baseline you do not believe is
worse than none.

**7. Add the A/B variants.** Wire up "no skill" as variant A. Run the benchmark. This is the point
where you find out whether the skill was earning its keep. Confirm the isolation rule in 7.7 holds
before trusting the result.

**8. Add the runtime loop** — validate, then targeted revision, capped. Only worth it once you know
from step 7 that quality is the bottleneck rather than the instructions themselves.

**A ninth, optional step:** once the skill is stable, split its packaging into a portable target and
a platform target (section 5). Do this last, not first. Restructuring the instructions and
restructuring how they are shipped are two different changes, and mixing them makes it hard to tell
which one caused a given SKILL.md diff.

---

## 9. Testing a workflow skill

Everything above assumes a skill whose output is text judged on quality: translation, rewriting,
summarising. A different class of skill exists, a **workflow skill**: planning, implementation,
debugging, code review, where the interesting question is not "is the prose good" but "did the
agent do, and only do, the right thing."

**Measure observable invariants, not prose quality, wherever the task allows it:**

- a read-only skill (review, diagnosis) does not modify any file
- an implementation skill stays within the scope it was given: it touches the files the task named
  and no others
- a request explicitly scoped to diagnosis only stays read-only even when a fix would be easy
- a debugging skill identifies the actual, seeded root cause, not just a plausible-sounding one
- a review skill detects a seeded defect
- a review skill does not flag correct code as a defect (a false positive is as real a failure as a
  miss)
- an action the skill was told never to take (deleting a branch, force-pushing, running a
  destructive command) does not occur

**Use isolated fixture repositories, and restore identical starting state before every variant.** A
workflow skill's own actions change the world it operates in; a file it edits stays edited.
Comparing variant A against variant B on the same checkout means B inherits whatever A already did
to it. Reset the fixture, a fresh git worktree, a clean checkout, a container snapshot, before each
run, so every variant starts from the same state and its effect on the fixture is the only thing
that differs.

**Use deterministic checks first, exactly as 7.3 establishes for content skills.** "Did the diff
touch only files under the expected path" and "did the working tree show any change at all" are
substring and exit-code checks, not opinions; write them as deterministic checks, not judge
prompts. Reserve the model judge for what genuinely needs one: whether a review comment is useful,
whether a plan's reasoning is sound, qualities no mechanical check can settle. This is the same
mechanical-first ordering as 7.3, applied to a different observable: a file tree and a command's
exit code, rather than a string of prose.

---

## 10. Choosing your scoring dimensions

The CV skill scores faithfulness, naturalness, cvQuality, terminology, conciseness, overall. Only
two of those transfer to every task.

**Always include:**

- **faithfulness** — did it stay true to the input? Under whatever name fits: accuracy,
  groundedness, factual preservation.
- **overall** — a holistic score. Useful precisely because it catches what your other dimensions
  missed.

**Then pick 2-4 that match what "good" means for your task:**

| Task | Dimensions worth scoring |
|---|---|
| Translation / rewriting | naturalness, terminology, conciseness |
| Summarising | coverage, conciseness, no invented detail |
| Code review | correctness of the finding, usefulness, false-positive rate |
| Explaining | clarity for the stated audience, correctness, completeness |
| Extraction / structuring | completeness, schema correctness, no invention |

Keep it to six at most. Every dimension is another number that moves for no reason, another
threshold to tune, and another thing the judge has to hold in mind at once.

---

## 11. Writing the SKILL.md itself

The instructions file is the actual product. Patterns that earned their place here:

**Hard rules first, in their own section, with "never" in them.** Not mixed into the general advice.

**Give the counter-example, not just the rule.** "Never upgrade ownership level" is ignorable.
`"contributed" -> "led"` is not. Almost every rule in the CV skill carries a concrete wrong-and-right
pair, and that is why they hold.

**State the priority order explicitly** when rules can conflict. The CV skill says: facts first,
naturalness second, length third — so when the model cannot satisfy all three, it already knows what
to give up. Without this, it picks, and it picks differently every time.

**Scope each rule, including where it does *not* apply.** A rule enforced too widely causes its own
damage. The variety rule here says do not open different entries the same way, then explicitly adds
that echoing a word from an entry's own label is fine — because without that line the model reached
for worse words to avoid a non-problem. This was a real fix, in commit `9f6a169`.

**Keep the output format rule separate from the content rules.** Different places the skill runs
want different things (a CLI piping to a file wants no commentary at all; a chat wants a note when
the input is ambiguous). Here the build script strips the CLI's output section and the chat
template supplies its own, so the two cannot contradict each other.

**Write rules a mechanical check can enforce, where you have the choice.** "Never use an em dash" is
enforceable by a substring check. "Use appropriate punctuation" is not. Prefer the first form.

---

## 12. Config to expose from the start

Split configuration by audience and by what it governs, not into one file that grows a new
top-level key for everything:

- **Runtime** (`runtime-config.json`): temperature, max output tokens, max revision attempts,
  per-dimension thresholds. What production actually runs with.
- **Eval** (`eval-config.json`): judge temperature (use 0), default variants, regression hard-fail
  tolerances and review thresholds. What the offline framework runs with.
- **Model roles** (`models.json`): provider and model for every role (generator, validator,
  reviser, evaluator, pairwiseJudge), independently. Point `--models-config=` at a different file
  with the same shape to run an entire experiment on a different model mix, e.g. a cheap model
  everywhere but the judge, with no source change.
- **Pricing** (`pricing.json`): dollars per million input/output tokens, by model id. The single
  table both a live call's cost estimate and a whole run's cost summary read, so the two can never
  disagree with each other.
- **Matrix** (`matrix.json`, optional): which model configurations and which variants to run as a
  grid, and which pair of variants counts as "with the skill" versus "without it" for that grid's
  own comparison.

Put the numbers in config from the beginning, even when you are sure of them. The first time you ask
"what happens if the naturalness threshold is 3 instead of 4", you want that to be a one-line edit
and a rerun, not a code change.

---

## 13. Decision and reporting

A regression run's PASS/REVIEW/FAIL/INCOMPATIBLE (7.9) answers "did this specific change break
something." A separate, coarser question sits above it: should this skill, as it stands, be
adopted, kept under review, revised, or retired? Keep the two questions visibly separate; a single
REVIEW-level regression on one case is not, by itself, a reason to retire a skill that has passed
forty benchmark cases.

**A comparison report meant to inform that second question should include:**

- success rate (hard-rule pass rate across the case set)
- hard-rule failures, listed, not just counted
- quality scores, per dimension and overall
- pairwise wins, losses and ties, from the canonical variant (7.13)
- false positives and false negatives, wherever they are measurable (workflow skills, section 9,
  are where this matters most)
- duration
- request count
- tokens
- cost
- quality gained per additional 1,000 tokens (`qualityPerThousandTokens` in this project), a local
  decision heuristic, not a benchmark to publish; label it as such wherever it is shown

**Support a small, fixed vocabulary of conclusions**, each with its own configurable threshold
rather than a judgment call made fresh each time:

- **ADOPT**: clearly better than the baseline, no unresolved hard failures, cost increase within
  an accepted range.
- **REVIEW**: promising, but something needs a human look before shipping: a borderline quality
  delta, a cost increase past the comfortable range, an insufficient trial count.
- **REVISE**: the skill's instructions need work; the gap is identifiable and closeable.
- **RETIRE**: no measurable benefit over the baseline, or a cost the benefit does not justify.

Keep the thresholds behind each label in config (section 12), not hard-coded in the reporting code,
for the same reason every other threshold in this framework lives in config: the first time someone
asks "what if REVISE needed a 10% gap instead of 5%", that should be a one-line edit.

---

## 14. Known limits, carried over

- **Judge scores are noisy.** ±0.2-0.3 run to run even at temperature 0. Design around it: review
  thresholds, not exact comparisons.
- **A judge can be fooled by fluent writing.** This is the entire reason the mechanical checks
  exist. Do not let a good score talk you out of a failed substring check.
- **A small benchmark means you are tuning to the test.** Twelve cases is a start, not a benchmark.
  Grow it whenever real use throws up a failure.
- **Quality-per-token is a local heuristic.** `qualityPerThousandTokens` is a sanity check for
  deciding whether a change earns its cost. It is not a standard metric and should not be reported
  as one.
- **The runtime validator costs a second model call per attempt**, and a failed validation costs
  another generate plus another validate. Variant C exists to measure exactly that, so you can
  decide whether it is worth it rather than assuming.
- **Trials are not implemented in this project yet.** Every case runs exactly once per variant per
  invocation; section 7.14's "at least three trials" guidance is a recommendation to build toward,
  not a description of current behaviour. Treat a close A/B call from a single run as provisional.
- **The usage ledger described in 7.11-7.12 is not built yet either.** This project currently
  aggregates request-level detail (the request log, the token-usage report) in memory for the
  lifetime of one run and reports it or discards it; nothing is persisted as an append-only,
  cross-run ledger outside git. The per-run result file (`evals/results/`) is itself still tracked
  in git in this project, which is workable at its current scale but is exactly the pattern 7.12
  recommends moving away from as usage data grows.
- **Workflow-skill testing (section 9) is new guidance, not yet exercised against a real workflow
  skill in this repository.** Every worked example in this document is a content-transformation
  skill. Treat section 9 as a starting point to adapt, not a pattern already proven here.
