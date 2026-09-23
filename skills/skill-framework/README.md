# Skill Framework

The skill used to create, restructure and evaluate the other skills in this repository. It is
itself a skill: instructions for a model, with a build, a validator and an eval of its own.

| File | What it is |
|---|---|
| `SKILL.md` | The instructions: how to run the conversation. Portable Agent Skills frontmatter (`name`, `description` only). |
| `docs/skill-framework-blueprint.md` | The architecture the instructions point at. Copied unchanged into every build as `reference/blueprint.md`. |
| `scripts/build-framework-skill.ts` | Builds `SKILL.md` + the blueprint for Claude Code or for any Agent Skills host. |
| `scripts/validate-framework-skill.ts` | Free, mechanical checks of the source and of both builds. |
| `evals/` | A/B eval: a plain model (A) against the model with this skill loaded (B), over fixed scenarios. |

It depends only on `@skills/framework`. It does not use any other skill's code.

## Commands

| Command | What it does | Costs money? |
|---|---|---|
| `pnpm test` | Unit tests, including the validator and the layout check | No |
| `pnpm validate` | Builds both targets into a temporary folder and checks them | No |
| `pnpm build` | Installs the Claude Code build at `~/.claude/skills/skill-framework/` | No |
| `pnpm build:portable` | Writes the portable build to `dist/skill-framework-portable/` | No |
| `pnpm eval:smoke` | 2 scenarios, variant B only | Yes, 2 model calls |
| `pnpm eval:full` / `eval:compare` / `eval:approve` | Every scenario, variants A and B | Yes, 2 calls per scenario |

The eval's model is set in `evals/config/models.json` (one `advisor` role). This skill has no
production pipeline, so it declares no prompts and has no `config/models.json`.
