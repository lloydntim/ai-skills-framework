# The shared runtime

A skill says **what** to do. The runtime decides **how** it is run. The runtime is one piece of shared
code in `framework/runtime/`; there is not one per skill.

| Word | Meaning here |
|---|---|
| Skill | What to do: the instructions, the prompts, the domain rules. Supplies its steps to the runtime. |
| Runtime | How it runs: the loop, the limits, the bookkeeping. `framework/runtime/`. |
| Provider | Who does model inference. `framework/provider/`, unchanged. |
| Tool | An external capability a skill may need, named like `jira.read`. |
| Validator | Whether an output satisfies the requirements. The skill's checks plus, if it has one, its model judge. |
| Trace | What happened in one run. A record with no text in it. |
| Policy | What a run is allowed to do: its limits, and which tools it may use. |

## What a run looks like

```
runtime.execute({ skill: "cv-translator", input, options })

INITIALISING   find the skill; settings = defaults -> skill.json -> options
PREPARING      load the model roles; check required tools against policy; skill.prepare()
EXECUTING      skill.generate()
VALIDATING     skill.validate() -> pass | revise | fail
REVISING       skill.revise(), only if revisions and budget remain; then VALIDATING again
COMPLETED | FAILED      the trace is finished and handed to the trace sink
```

`framework/runtime/state.ts` holds the states and the only moves between them. A move that is not on
the list throws, and `COMPLETED` and `FAILED` have no way out, so a run cannot be resumed or restarted
by mistake. Anything can subscribe to changes with `onStateChange`.

## What the skill supplies, and what it does not

`RuntimeSkill` (`framework/runtime/skill.ts`) is the whole contract: `name`, optional `settings` and
`tools`, an optional `prepare`, and the three steps `generate`, `validate`, `revise`. Each step is
handed a `Step` with the input, the role handles, the attempt number and the tool broker.

A skill does **not** write a loop, count attempts, add up tokens or cost, catch provider errors,
choose a fallback model, or build a trace. Its steps call `step.roles.generator.provider.generate(...)`
exactly as they always called a provider, and the runtime sits underneath that call (`gateway.ts`).

The runtime imports no skill. A skill exports its `RuntimeSkill`; the caller passes it to
`createRuntime`. Skills depend on the framework and never the other way round, which
`checkSkillPackage` already enforces for imports.

## Settings

Defaults live once, in `framework/runtime/config.ts`:

```ts
execution:  { maxRevisions: 3 }
budget:     {}                       // no limit unless a skill or a run sets one
validation: { enabled: true }
tracing:    { enabled: true }
```

A skill states only what it changes, in `skill.json`:

```json
{ "runtime": { "execution": { "maxRevisions": 5 }, "budget": { "maxCostUsd": 0.5 } } }
```

and one run can change more: `runtime.execute({ ..., options: { settings: { budget: { maxCostUsd: 0.1 } } } })`.

Precedence, lowest to highest: **runtime defaults, then the skill, then the run**, merged field by
field. Unknown keys, negative counts and non-numbers are a `CONFIGURATION_ERROR` naming the layer.

Three choices worth knowing:

- **`maxRevisions`, not `maxIterations`.** It counts revisions after the first draft, which is what
  `maxRevisionAttempts` already meant in both skills. It is the one limit that is always on, and it is
  what stops a retry loop.
- **Two limits on revisions, and they are different things.** `execution.maxRevisions` is what a skill
  or a run *chooses*, a property of the task, in `skill.json` or per run. `ABSOLUTE_MAX_REVISIONS`
  (10, `framework/runtime/config.ts`) is what the runtime *allows*: a safety policy so a mistyped or
  copied number cannot turn a bounded loop into an expensive one. The manifest schema only says a count
  is a non-negative integer; the ceiling is applied when settings are resolved, so a value above it in
  `skill.json` or in a run's options is a `CONFIGURATION_ERROR` naming the layer, before any model call.
  It is refused, not clamped, so nobody thinks they are getting the number they wrote.
  `checkSkillPackage` runs a skill's `runtime` block through the same resolution, so `skills:validate`
  finds it before a run does. There is no setting for "unlimited".
- **Budgets are off by default.** A default that ends runs which work today (a full CV at high
  reasoning is not small) would be a behaviour change, so a limit is something a skill or a run opts
  into.
- **`validation.enabled: false`** is the single-shot run: one draft, no validation. It is what the
  evals call variant B.

## Failures

`framework/runtime/failure.ts` has eight kinds and a `retryable` flag. The runtime acts on the kind,
never on message text.

| Kind | Raised when | What the runtime does |
|---|---|---|
| `CONFIGURATION_ERROR` | unknown skill, bad settings, models config unloadable, a role's settings its model rejects | fails at once, before any model call |
| `CONTEXT_ERROR` | `prepare()` threw (for example `SKILL.md` missing) | fails at once, before any model call |
| `MODEL_ERROR` | a provider call failed or returned nothing usable | tries the role's fallback once if the failure is `retryable` (429, 408, 409, 5xx, connection); otherwise fails |
| `TOOL_ERROR` | a required tool is denied or unconfirmed, or a tool call failed | fails; `retryable` is recorded for the caller |
| `VALIDATION_ERROR` | validation says `fail`, or revisions ran out | fails, keeping the last draft |
| `BUDGET_EXCEEDED` | a token, cost or time limit is reached | stops, never retries, keeps the last draft |
| `BUDGET_MEASUREMENT_UNAVAILABLE` | a token or cost limit is set but a call reported no such figure | stops, never retries, keeps the last draft |
| `EXECUTION_ERROR` | anything else thrown by skill code | fails |

A failed run still returns its last draft in `output`, so the caller decides whether a draft that
failed validation is usable. `cause` (the original error) is in the result in memory only.

## Validation

The skill's `validate` step returns two things: a `decision` the runtime acts on, and its own richer
`detail` that the runtime hands back to `revise` without reading it.

```ts
type ValidationDecision =
  | { status: 'pass' }
  | { status: 'revise'; issues: ValidationIssue[] }   // another draft, if a revision is left
  | { status: 'fail'; issues: ValidationIssue[] };    // stop: another draft would not help
```

Each issue has a `source` (`schema`, `deterministic`, `semantic`), a fixed `code` and a `message`. The
code goes in the trace; the message, which can quote the text being checked, does not.

The skill's checks and its model judge stay inside its `validate` step. Today both skills run their
checks and then always call the judge, as before; running the checks first and skipping the judge when
they already fail would change what the reviser is told, so it is a decision for a paid comparison, not
a refactor.

## Models

Skills already name a **role** (`generator`, `validator`, `reviser`, ...) and `config/models.json` maps
each role to a provider and model. That mapping is the capability-to-model step, so no separate
`capability: reasoning-medium` layer was added.

A role can name a **fallback**, resolved and validated like the role itself and inheriting its
reasoning and output budget unless it states its own:

```json
{ "generator": { "provider": "anthropic", "model": "claude-sonnet-5",
                 "fallback": { "provider": "anthropic", "model": "claude-haiku-4-5" } } }
```

The fallback is asked once, only after a failure another model might not share, and the trace says
which model answered (`usedFallback`). A configuration without `fallback` behaves, and is recorded,
exactly as before.

## Tools

A skill lists what it needs (`skill.json` `"tools": { "required": ["jira.read"] }`). The **policy**
decides:

```ts
createRuntime({ ..., toolPolicy: { allow: ["jira.read", "jira.search"], confirm: ["jira.write"], deny: ["jira.delete"] } })
```

Deny beats confirm beats allow, and a capability no rule mentions is denied. `confirm` asks
`confirmTool(capability)` once per run and fails closed if there is nobody to ask. Required tools are
checked in PREPARING, before any model call. Inside a step, `step.tools.call("jira.read", fn)` checks
the policy, runs `fn` and records the call. The runtime knows names and policy only; what a capability
does is the skill's or a tool package's business. No skill declares a tool yet.

## Budget

`BudgetTracker` (`framework/runtime/budget.ts`) is asked before every model call and before every
revision. A limit counts as reached when spend is **at** it, since the next call's size is unknown. A
call cannot be interrupted, so the last call can overshoot; a limit bounds the calls made, not the bill
to the cent. If a token or cost limit is set and a call reports no usage or cost (a model with no price,
say), the run stops rather than pretend the limit is enforced. That is a different fact from a limit
being reached, so it has its own kind: `BUDGET_EXCEEDED` says the run spent too much,
`BUDGET_MEASUREMENT_UNAVAILABLE` says it cannot be told whether it did. Both are non-retryable; the
verdict carries a `cause` and one function (`budgetFailure`) turns it into the failure, so the gateway
and the controller cannot disagree.

A model fallback is not a new run. Every attempt, the failed one and the fallback, is a call on the same
trace, is charged to the same budget, and does not count as a revision. The budget is asked again
before the fallback is called, since the preferred model may have spent the time limit failing.
`framework/runtime/fallback-accounting.test.ts` prices each attempt ($0.18 then $0.20 is one run of
$0.38) with deterministic fakes.

## Context

The runtime does not assemble prompts. It gives the skill one place to do it once per run
(`prepare`), and it records the size of each prompt part that every call reports (`components`, in
characters) on the trace, so what each call saw can be measured from a run without keeping the text.
What a call sees remains the skill's decision, recorded in its README (blueprint 7.15). Budgeting and
prioritising context across parts is not built. What would be needed, and the smallest next step:

**What exists.** Both skills build each prompt from named parts (`skill`, `task-instructions`,
`case-input`, `previous-output`, a rubric) and report each part's size beside the request. `prepare`
runs once and can hold what the calls share. Cover Letter Writer already *selects* (`skillContext:
'by-task'`). What is missing is that the runtime never sees a part before the prompt is a string, and
the reported sizes are written by hand next to the prompt they describe, so they can drift from it.

**Why not a context manager now.** The two skills call for nothing beyond selection, which they do
themselves; a limit would need each model's input size, which is not in the role configuration; and
`chars` are not tokens (see `PromptComponentSize`), so a limit in them is a guard, not a fit.

**Next step, when a skill hits a real limit, in this order** (each is useful without the next):

1. *Measure.* Record on each `ModelCallRecord` the exact characters sent (system plus user prompt,
   which the gateway already has) and how many of them no reported part accounts for. A number, no
   text, so the privacy test only needs its pinned field list updated. It shows which call sites do not
   report their parts and which call is the largest, before anything is trimmed.
2. *Say what a part is.* A pure helper in `framework/prompts/` that a skill can opt into:

   ```ts
   interface ContextPart { component: PromptComponent; text: string; priority: 'required' | 'preferred' | 'optional'; shrink?: (text: string, maxChars: number) => string }
   assemble(parts: ContextPart[], limit?: { maxChars: number }): { text: string; components: PromptComponentSize[]; dropped: PromptComponent[] }
   ```

   It drops `optional` parts, then shrinks `preferred` ones that can shrink, and never touches
   `required`; if that is still over the limit it says so instead of cutting a rule. It returns the text and the
   `components` together, which removes the drift. The five things a run has map on directly:
   instructions and task input are `required`; validation feedback is `required` (it is the
   revision's job); the previous attempt is `preferred` and has no `shrink`, since half a draft is
   worse than none; reference material (phrase bank, template sections) is `optional` and is what
   `by-task` already drops.
3. *Give a role a limit.* `maxInputChars` on the role's runtime configuration, next to `reasoning`
   and `maxOutputTokens`, because it is a property of the role's model. `step.roles.<role>` would
   expose it so a skill passes it to `assemble`.

Nothing forces a skill to change: one that keeps passing strings and its own `components` behaves
exactly as today, and skills move to `assemble` one call at a time.

## Traces and privacy

Every run has a `runId` and a `RunTrace` (`framework/runtime/trace.ts`): the skill, timings, the state
history, which provider and model played each role, the settings in force, the number of attempts, each
validation's status with its issue **codes**, every model call's role, request type, usage, cost, time
and prompt-part sizes, the tool calls by name, token and cost totals, and the final status with the
failure's kind.

There is deliberately no field for the input, a draft, a prompt, a validator message, an error
message, a tool argument or result, or a path. A failure's message is written by the runtime, not
copied from the error. Issue codes that are not identifier-shaped are replaced with `unspecified`.
`framework/runtime/privacy.test.ts` puts a name, an email, an API key, a CV line and a private path
into the input, the model output, validator messages, tool results and error messages, and asserts none
reaches the trace, in memory or in the file. It also pins the trace's field list, so adding a field is
a deliberate change.

The trace is always built and returned. `tracing.enabled` decides whether it is handed to a sink.
`JsonlTraceSink` appends to a file; point it under `skills/<name>/data/`, which git ignores
(`scripts/runtime-traces-privacy.test.ts` checks that). The public/private split is unchanged:
nothing here reads `reference/`, and a private skill's contents reach the runtime only as the
`RuntimeSkill` its caller passes in.

## Example: CV Translator

```
pnpm --filter cv-translator translate -- --input=cv.txt --source=de --target=en-GB \
  --instructions="Translate for a senior engineer CV." --trace=true
```

1. `scripts/translate-cv.ts` loads the roles from `config/models.json` and calls `runProductionSkill`.
2. `src/runtime/index.ts` builds a runtime around `cvTranslatorSkill(config)` (`src/runtime/skill.ts`)
   and calls `execute`, passing the skill's `maxRevisionAttempts` (5) as the per-run revision cap.
3. INITIALISING: settings resolve to defaults, then `skill.json` (nothing there), then the run (5 revisions).
4. PREPARING: the roles are wrapped; no tools are required; `prepare` checks `SKILL.md` can be read.
5. EXECUTING: `generateDraft` runs, unchanged, through the generator role's metered provider.
6. VALIDATING: `validateDraft` runs the deterministic checks and the model judge, unchanged. Its result
   becomes `pass`, or `revise` with issues such as `{ source: 'semantic', code: 'faithfulness' }`.
7. REVISING: if not passing, revisions and budget remain, `reviseDraft` runs with the skill's own
   validation result; then back to VALIDATING. This repeats at most 5 times.
8. COMPLETED, or FAILED with `VALIDATION_ERROR` and the last draft. `runProductionSkill` returns the
   result in the shape it always had, plus `trace`. The trace is appended to `data/traces/runs.jsonl`.

## Example: Cover Letter Writer

The same runtime, unchanged, runs a skill with a different domain: structured deterministic checks
instead of scores alone, six score dimensions, a phrase and preference bank, and a candidate profile the
prompt is filled from. `src/runtime/skill.ts` supplies the steps; `src/runtime/index.ts` is the thin
entry point. The differences from CV Translator stayed in the skill:

- `prepare(input)` assembles the system prompt once so a missing `SKILL.md` or an unfilled profile is a
  `CONTEXT_ERROR` before any call. It depends on the input (`by-task` selects sections by language and
  market), which `prepare` already receives.
- `toDecision` reads which layer raised each issue from the result's own structured fields, so this
  skill's domain result needed nothing added for the trace. Each deterministic rule has a fixed code
  (`missing-term`, `forbidden-claim`, ...) from the same table the reviser's instructions come from
  (`deterministicIssues` in `revise.ts`), so the two cannot disagree; a judge guardrail is
  `semantic/guardrail`; a low score is `semantic/<dimension>`.
- `usageByRole` still reports all five roles, zeroed for roles the run did not call, as this skill's
  callers expect. That is a mapping in the entry point, not something the runtime knows about.

Nothing skill-specific went into `framework/runtime/` to make this fit. What the second skill did show
was that the two entry points were repeating the same adapter code, so it moved into the framework:
`settle(result)` (`runtime/result.ts`) is the rule "running out of revisions returns the last draft and
its validation, any other failure throws the error that caused it", and both skills' totals now come from
`spendOf`.

## Moving another skill onto the runtime

1. Add `src/runtime/skill.ts` exporting a `RuntimeSkill`: `generate`, `validate`, `revise` (and
   `prepare` if there is something to load once) built from the skill's existing functions, and a
   `toDecision` that reduces its validation result to `pass` / `revise` / `fail`.
2. Replace the loop in `src/runtime/index.ts` with `createRuntime(...).execute(...)`, and map the
   result to the skill's existing result type so callers and evals do not change.
3. Delete the copied usage arithmetic; use `spendOf` (run totals with no role, one role's share with one)
   from `runtime/trace`, and `settle` from `runtime/result` to turn the run into a return value or the
   original error.
4. Move settings that are not about the domain into `skill.json` `runtime`, only if they differ from
   the defaults.
5. Run the skill's existing tests unchanged. They are the proof that behaviour did not move.

## Not built yet

- Skill discovery by scanning `skills/`. Skills are handed to `createRuntime`; a scan would need dynamic
  imports across the package boundary.
- Context budgeting and prioritising (see "Context").
- Capability-based model routing. Roles already map to models.
- Tool retries, checkpoint and resume, cancellation of a call in flight, external observability,
  concurrency, and an approval UI for `confirm`.
- Cover Letter Writer's usage ledger (`src/usage`) is still its own. It wraps the real provider under
  the runtime's metered one, so it records every attempt, fallbacks included, and is not part of a run.
