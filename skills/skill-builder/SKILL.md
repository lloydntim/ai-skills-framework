---
name: skill-builder
description: >-
  Structures a model skill so its quality can be measured and its regressions
  caught: one source file for the instructions, mechanical checks with unit
  tests, hard versus soft guardrails, benchmark and golden cases, and an
  approved baseline to compare against. Use when creating a new skill,
  rewriting or restructuring an existing one, adding evaluations or tests to a
  skill, or working out whether an edit to a skill's instructions actually made
  the output better. Also covers how to write the instruction file itself.
---

# Skill Builder

## Read the blueprint first

The full architecture is in `reference/blueprint.md`, next to this file. Read it before doing any
of the work below. It holds every rule this skill relies on, together with the reason each one
exists, and nothing here repeats it.

This file covers only how to run the conversation. The blueprint covers what to build.

## Settle two things before building anything

**1. Which skill, and where does it live now?** Find the instruction text before proposing
anything. It is often pasted into more than one place, and finding that out changes the first step.

**2. How far does the user want to go?** The eight steps in the blueprint's porting-order section
are a menu, not a mandate. Say plainly what each band costs before starting:

| Steps | Cost |
|---|---|
| 1-2 — one source file, hard rules separated from soft | An hour. No running cost. |
| 3-4 — deterministic checks, unit tests, golden cases | A day. Still free to run. |
| 5-8 — judge, runner, variants, runtime loop | Real API tokens on every single run, for as long as the project lives. |

Most skills should stop after step 4. Recommend the smallest band that answers the question the
user actually has, and say which band you are recommending and why. Put the recommendation on a
line of its own, in this form, before explaining it, so it cannot be missed:

`Recommended band: steps 5-8` (or `steps 1-2`, or `steps 3-4`)

When every condition in the
blueprint's section 2 holds (output judged on quality, instructions still being edited, a wrong
output has a real cost) and the output is not mechanically checkable end to end, that band is
5-8: recommend it, give its call count, and let the user decide on the spend. Step 8 can still
wait for what step 7 shows.

## Rules for the conversation

**Restructure and rewrite are two separate changes.** When porting an existing skill, move the
instruction text without editing its wording first. Change the wording in a second pass. Doing both
at once means that when the output changes you cannot tell which change caused it — which is the
exact problem this skill exists to solve, so do not create it while setting the skill up.

**Moving text is not editing text.** Preserve the existing skill's wording exactly unless the user
asks for rewriting. If a rule looks wrong while you are moving it, say so and leave it alone.

**Never scaffold something that spends money silently.** Before recommending any step past 4, and
again before writing an eval runner, state roughly how many model calls one full run will make:
cases x variants, plus one judge call each, plus one more per revision attempt. Give a number for
this skill, with the case count assumed if it is not known yet; "real tokens" is not a number. The
user decides whether that is acceptable.

**Do not claim an improvement without numbers.** "This should be better" is not a result. Either
run the comparison and report what it said, or say plainly that it has not been measured yet.

**Decide what the skill needs to know, and when.** Do this every time you create a skill or change
what it loads or sends to a model, without waiting to be asked. Work through the questions in the
blueprint's section 7.15 with the user: what every call must have, what to fetch only when a task
needs it, what stays outside the skill, what must outlast the conversation or the run, and which
judgement needs a context of its own. Answer only the questions that fit this skill; a small
instructions-only skill may need two. Write the answers into the skill's README as its context
requirements, each with the test or eval that checks it. Do not copy section 7.15 into the new skill,
and do not add context headings to its instructions. Anything about one real person stays out of the
reusable skill: the skill names what it needs, and private data supplies it at run time. Subagents,
caching and a host's memory are ways one host can meet a requirement, never a requirement of the
skill itself.

**Approve a baseline only after reading the outputs.** Never approve one just because the suite
ran. An approved baseline nobody has read is worse than having none, because every later run is
measured against it.

## When creating a skill from scratch

Write the instruction file first and use it by hand for a while. Real failures are what tell you
which hard rules you need, and a guardrail written before you have seen the failure it prevents is
usually guarding the wrong thing. Before writing it, settle three of the context questions: what the
skill needs from the user on every call, which of that is personal and must stay out of the skill
file, and which large material belongs in a reference file read only when a task needs it. Build
steps 3 and 4 once you have a handful of real examples of
the skill getting something wrong.

## Reference

`reference/blueprint.md` — the full architecture: the design rules with the reason each exists,
portability across agent hosts, the provider and model-role contract, usage accounting, deciding
what each model call sees and how to record and check it (7.15), the porting order, testing a workflow skill, how to choose scoring
dimensions, how to write the instruction file itself, and the ADOPT/REVIEW/REVISE/RETIRE decision
framework.
