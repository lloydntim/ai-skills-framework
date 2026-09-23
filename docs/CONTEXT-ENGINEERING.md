# Context engineering

Two questions sit behind every prompt this repository sends:

1. **What is this call allowed to see?** — the privacy boundary.
2. **What does this call actually need to see?** — the context-selection question.

They are different questions with different answers, and mixing them up is how prompts quietly grow.
`docs/ARCHITECTURE.md`, under "What each call sees", describes the mechanism. This page records what
was measured, and what was decided as a result.

## 1. What a call is allowed to see

A skill here is written once, for nobody in particular. Cover Letter Writer's `SKILL.md` names 24
`{{PLACEHOLDER}}`s and contains no fact about any person. A profile file fills them at load time,
and the deterministic checks read that same profile, so what the model is shown is exactly what the
rules enforce. Point `COVER_LETTER_PROFILE` at a different file and the same skill writes for a
different candidate, with no edit to any tracked file.

That makes the privacy boundary mechanical rather than a matter of care:

| Concern | Where it is enforced |
|---|---|
| A skill's reusable files hold no personal data | `SKILL.md` is placeholders; the suite runs against `candidate-profile.example.md`, a fictional candidate |
| An exported skill carries no personal data | `scripts/export-skill.ts` refuses `reference/`, `data/`, PDFs and office documents unconditionally, and scans for secrets before writing |
| The **repository** carries no personal data | `scripts/tracked-tree-privacy.test.ts` scans every file `git ls-files` reports — including inside `.docx`/`.pptx`/`.xlsx`/`.odt`, which are a ZIP of XML — using the detectors in `scripts/privacy-scan.ts` |

The third check exists because the first two are not the same as the second. An archive can be clean
while the repository that produced it is not: a file can be excluded from an export by extension and
still be committed. The scan reports by file and label, never by the value it matched, so a failure
is not a second place the data leaks from.

Real regression material — a real CV, a real profile, eval cases built from them — lives in a
skill's `reference/` folder, which this repository does not contain. See "Evaluation fixtures" in the
root `README.md`.

## 2. What a call actually needs to see

Each call gets only its job's parts. Judges never receive `SKILL.md`, because a judge that has read
the rules is grading against the rules rather than the result. The reviser receives the failures, not
the whole validation. Every prompt part is measured: `components` on the request metadata records the
size of each part, and `--token-report=true` prints the breakdown per request type. A pipeline test
with a fake provider asserts, per request type, which components were sent.

### The `full` vs `by-task` experiment

Cover Letter Writer's `SKILL.md` carries sections that only some letters can use — a German letter
template and the German Anschreiben conventions are dead weight in an English letter. `by-task`
selection (`src/skill-sections.ts`) sends only the sections a given letter needs.

It was built, measured against `full`, and **not adopted**.

The run: 12 golden cases × 3 repeats × 2 arms × variants B and C — 72 benchmark calls, 144 scored
observations. Both arms shared everything except `runtimeConfig.skillContext`: the same models, the
same temperatures, the same profile, the same cases, the same checks. Within each repeat the two arms
ran adjacent and alternated which went first; the order check found no effect.

| Measure (variant C, the production pipeline) | Result |
|---|---|
| Overall quality | 3.917 `full` → 3.972 `by-task`; paired difference **+0.056**, 95% CI [-0.496, +0.607] |
| Smallest difference detectable at n=36 | 0.552 — larger than the difference observed |
| Generation input tokens per case | −10.2% |
| Cost per case | −8.8% |
| Latency per case | −20.7% |
| Deterministic checks passed | 26/36 `full` → 24/36 `by-task` |

On quality the difference is smaller than the noise floor: unchanged. The aggregate check count hides
what decided it. Split by cell, one cell of three moved sharply — English letters with no market went
from 7/9 to 3/9, driven by a single case that passes 3/3 under `full` and fails 3/3 under `by-task`,
exhausting its revision budget every time.

The regression is not explained by what was removed. That case loses the German template and the
German conventions, neither of which an English letter can use. The honest reading is that perturbing
a working prompt moved the model on borderline cases, in both directions, and the net happened to
land near zero. **A selector that reshuffles which cases pass is not worth 10% of the input**, so
`full` stays the default and `by-task` stays opt-in — as a diagnostic, and as the way to ask the
question again.

Two limits on how far this should be pushed, stated because they bound the claim:

- The paired-difference SD is 1.69 on a five-point scale, so resolving a real difference of 0.2 would
  take roughly eight times this run. The aggregate quality comparison cannot be sharpened affordably.
- The golden set has no UK and no Ireland case, so nothing above says anything about those markets.
  Nothing has been inferred for them.

### Why the negative result is kept

`by-task` is one small module and one config field. Removing it would throw away the only instrument
that can ask the question, and the answer is provisional: it was measured under one provider
configuration. What the experiment established is not "selection does not work" but "this selection,
on this prompt, bought a 10% saving and cost reliability" — and this repository already holds that
reliability outweighs a small context saving.

## 3. Known development issue

`framework/manifest/versions.ts` (`snapshotVersions`) reads a skill's dataset directory straight
from `skill.json`. It does not use the public/private fallback that
`skills/cover-letter-writer/evals/cases-loader.ts` applies, which prefers a private `reference/evals/`
directory where one is mounted and falls back to the public synthetic cases otherwise.

Cover Letter Writer's `skill.json` points its two datasets at `reference/evals/`, which a public
checkout does not have, so `snapshotVersions` throws `ENOENT` there. It fails closed rather than
recording a snapshot that does not match the cases actually loaded, which is the better of the two
failure modes but is still a failure.

What this does and does not affect:

| | Status in a public checkout |
|---|---|
| `pnpm test`, `pnpm typecheck`, `pnpm framework:validate` | Unaffected. `checkSkillPackage` already treats an absent `reference/` dataset as a supported environment condition and skips it |
| Anything that does not call a model | Unaffected |
| cv-translator and skill-framework, paid or free | Unaffected — their datasets are already public paths |
| A **paid** Cover Letter Writer eval run | Fails at startup with `ENOENT` on `reference/evals/benchmark` |

The fix is to give `snapshotVersions` the same fallback the case loader has, so the version snapshot
describes the cases that were actually loaded. Until then, paid eval runs are not supported for
Cover Letter Writer from a public checkout.
