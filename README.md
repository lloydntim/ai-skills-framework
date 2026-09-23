# AI Skills Framework

Skills for a language model, each in its own folder, sharing one small framework — and the
machinery to tell whether any of them actually helps.

A skill here is not a prompt. It is a package: written instructions for the model, deterministic
rules that check the output without a model, test cases, a production pipeline, and a way to compare
one version against another and refuse the comparison when the two runs did not measure the same
thing.

| Skill | What it does | Domain |
|---|---|---|
| [cv-translator](skills/cv-translator) | Translates and improves CV wording between German and English | cv |
| [cover-letter-writer](skills/cover-letter-writer) | Writes a cover letter or Anschreiben for one role, using only the candidate's CV | job-search |
| [skill-builder](skills/skill-builder) | Creates, restructures and evaluates the skills here; holds the blueprint they follow | skills |

The shared code is in [framework/](framework). **How everything fits together is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Read that first.**

## Start

```
pnpm install
pnpm test           # every test; none calls a model, so no API key is needed
pnpm typecheck
pnpm skill-builder:validate
pnpm skills:validate  # every skill against framework/; private ones too if PRIVATE_SKILLS_ROOT is set
```

Those four commands are the whole free suite, and they are what runs before any commit. Nothing in
them makes a network request. Commands that call a real model cost money and are marked as paid in
each skill's README; they need `ANTHROPIC_API_KEY` in a `.env` file (copy `.env.example` to the
repository root, or into one skill's folder to use a different key for it).

Run one skill's commands from its folder, or from here with `--filter`:

```
cd skills/cv-translator && pnpm test
pnpm --filter cover-letter-writer test
```

## What the architecture is

Every skill is laid out the same way, so knowing one means finding your way around any of them.
`framework/` holds what is genuinely shared — the model-provider contract, model roles, the price
table, hashing, `skill.json` and version snapshots, run metadata, the case loader, fake providers
for tests. A skill holds what is its own: its instructions, its prompts, its deterministic rules,
its cases, and what "faithful" means for its domain. A skill never imports from another skill.
`skills/*/src/skill-package.test.ts` enforces that layout on every skill in the workspace.

Three pieces are worth opening first, because each is a claim the repository backs with code rather
than prose:

- **[`framework/evals/regression-compatibility.ts`](framework/evals/regression-compatibility.ts)** —
  the system refuses to report a quality verdict when the two runs did not measure the same thing.
  A changed prompt version, a changed dataset, a different judge: each is classified
  INCOMPATIBLE / WARNING / INFO with a stable code, and an INCOMPATIBLE comparison throws rather
  than printing a number that looks meaningful.
- **[`framework/manifest/`](framework/manifest)** — version-and-hash discipline. `skill.json`
  records what a human *meant* the version of each prompt and dataset to be; the run records the
  hash of what was actually on disk. When the two disagree, the run says so.
- **[`scripts/export-skill.ts`](scripts/export-skill.ts) and
  [`scripts/privacy-scan.ts`](scripts/privacy-scan.ts)** — the privacy boundary as executable code,
  not as a convention. See "How private context is kept out" below.

`skill-builder` is the skill that builds the others. It holds the blueprint every skill here
follows ([`docs/skill-builder-blueprint.md`](skills/skill-builder/docs/skill-builder-blueprint.md)),
including section 7.15, the questionnaire that decides what each model call should see — and it is
evaluated by the same harness it prescribes, against its own synthetic scenarios.

## How evaluation works

Evaluation answers three separate questions, and keeps them separate:

1. **Is the skill good?** Many benchmark cases, scored by an offline evaluator against a rubric.
2. **Did a change break something?** A few golden cases, compared against an approved baseline.
3. **Does the skill help at all?** Variants run side by side: **A** the plain model with no skill,
   **B** the skill in a single generation pass, **C** the real production pipeline — generate,
   validate, revise — called directly. Two outputs are then judged blind and pairwise, with position
   bias controlled by running each pair in both orders.

Deterministic checks run first and cost nothing: a rule such as "never turn *helped* into *led*"
needs no model. A model judge is used only where meaning is at stake, and a judge never receives
`SKILL.md` — a judge that has read the rules grades against the rules instead of against the result.

`skills/*/evals/history.jsonl` keeps one text-free summary per approved run: versions, hashes, model
roles, per-variant scores, token counts by request type, prompt-part sizes. No output text, no case
text. It is the longitudinal record, and it is publishable exactly as it stands.

## How private context is kept out

This repository demonstrates a skill that writes on one person's behalf without holding anything
about that person.

Cover Letter Writer's `SKILL.md` names every candidate detail as a `{{PLACEHOLDER}}` — 24 of them —
and contains no fact about anybody. A profile file fills them at load time. The deterministic checks
read that same profile, so what the model is shown is exactly what the rules enforce. The whole test
suite runs against `candidate-profile.example.md`, a fictional candidate, and the fictional
letterhead in `templates/` is structurally identical to a real one. Point `COVER_LETTER_PROFILE` and
`COVER_LETTER_TEMPLATE` at your own files and the same skill writes for you, with no edit to any
tracked file.

Real material — a real CV, a real profile, and the regression cases built from them — belongs in a
skill's `reference/` folder, which this repository does not contain and which `.gitignore` here
refuses. Three checks keep it that way, and they are not the same check:

| Check | What it protects |
|---|---|
| `scripts/export-skill.test.ts` | An exported skill archive |
| `scripts/tracked-tree-privacy.test.ts` | The repository itself — every file `git ls-files` reports, including inside `.docx`/`.pptx`/`.xlsx`/`.odt`, and flagging any tracked PDF or legacy Office file it cannot read |
| `skills/*/src/skill-package.test.ts` | The layout that makes the other two possible |

Both privacy tests share one definition of "private data", in `scripts/privacy-scan.ts`, and both
skip cleanly here, where there is no private material to compare against. They are live where the
private repository is checked out next to this one and `PRIVATE_SKILLS_ROOT` names it, which is where
the risk actually is: they read its `reference/` folder in place and scan this repository against it.
The architecture page's "Private skills" section explains that setup. Findings are reported
by file and label, never by the value that matched.

[docs/CONTEXT-ENGINEERING.md](docs/CONTEXT-ENGINEERING.md) covers this and the other half of the
subject: what each call actually needs to see, and the measured experiment that settled it.

## Evaluation fixtures

**Every eval fixture in this repository is synthetic.** cv-translator's twenty-nine cases — fourteen
golden, fifteen benchmark — are invented CV text. Cover Letter Writer's twelve cases — seven golden,
five benchmark — are built on the fictional
candidate in `candidate-profile.example.md`, and each reproduces the property its private
counterpart exists to test: ownership level not promoted, no technology absent from the CV, every
metric already present in it, a gap addressed rather than hidden, no template placeholder surviving,
German register mirrored, no benefit attributed to an employer whose advert does not mention it.
`skills/cover-letter-writer/evals/synthetic-cases.test.ts` asserts that no real employer, fact or
metric found its way in.

The private, real-world regression sets are **not** part of this repository, and neither are the
approved baselines made from them — a baseline is a full run over the golden cases, so it holds every
drafted letter. What publishing only synthetic cases loses is the *evidential* weight of running
against a real CV. What it does not lose is coverage: every property survives the translation.

One consequence, stated plainly: Cover Letter Writer's public case set has **no approved baseline**,
because approving one costs a paid run. `pnpm eval:regression` will run the cases and report scores;
it has nothing to compare them against until a baseline is approved here.

Which model answers for each role, how hard it reasons and the output budget it has are all in that
skill's `config/models.json`. The settings are role-aware — the role writing the output is not
configured like the role scoring it — and provider-neutral, so a skill never names a vendor's
reasoning parameters. The architecture page has the details and the reasoning behind the defaults.

## Export one skill

```
pnpm export-skill cv-translator
```

Writes `exports/cv-translator-<version>.zip`: that skill and the framework, without secrets, `.env`,
`node_modules`, git history or other skills. The export refuses `reference/`, `data/`, PDFs and
office documents unconditionally, checks that every import resolves inside the archive, and scans
for secrets before writing anything.

## Note on git

On a Mac where the Xcode licence has not been accepted, `/usr/bin/git` refuses to run. Some tests
and every eval run then report the git commit as unknown. Run `sudo xcodebuild -license` once to fix
it.

## History starts here

This repository has a single initial commit, on purpose. The reusable architecture was extracted
from a working repository that held one real person's CV, profile and job applications — in the
files themselves and throughout its history. There is no path to a clean public history from that,
and a filtered history that missed one blob would fail silently, where starting fresh fails closed.
The earlier history is kept privately, where it is useful to its author and to nobody else.
