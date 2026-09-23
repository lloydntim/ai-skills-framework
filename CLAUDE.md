# Working in this repository

- Read `docs/ARCHITECTURE.md` first. It describes the layout every skill follows.
- To create or change a skill, use the `skill-builder` skill (`skills/skill-builder/`). Its
  blueprint covers what each model call should see (section 7.15); record those decisions in the
  skill's README as its context requirements, each with the test that checks it.
- **Nothing tracked here holds a real person's details.** Not `SKILL.md`, source, prompts, test
  fixtures, templates, `evals/history.jsonl` or anything exported. Those belong in a skill's
  `reference/` folder or in `skills/private/`, both of which are a separate private repository
  that this one ignores. Never commit from them, and never with `git add -f`. Do not print such
  details in command output either.
- **A new eval fixture is synthetic**, built on `candidate-profile.example.md` or on invented CV
  text. Real CV text belongs in `reference/evals/`, never in `evals/cases/`.
- Configure a real profile and letterhead through `COVER_LETTER_PROFILE` and
  `COVER_LETTER_TEMPLATE`, pointing outside the repository. Do not edit a tracked file to hold them.
- `pnpm test` never calls a model. Commands that do are marked as paid in each skill's README; do
  not run them without asking.
- Before committing: `pnpm test`, `pnpm typecheck`, `pnpm skill-builder:validate`.
