---
name: cover-letter-writer
description: >-
  Writes a tailored cover letter or German Anschreiben for one specific role,
  grounded entirely in the candidate's CV. Use whenever a job advert, job
  description, job link or role summary is shared along with a request to write,
  draft, tailor or rewrite a cover letter, application letter, Anschreiben or
  Bewerbung. Reads the spec, selects which CV evidence to cite against that
  spec's own priorities, and draws on a bank of pre-approved phrases and job
  preferences. Never invents an employer, technology, metric or ownership level,
  and never credits an employer with a benefit their advert does not mention.
---

# Cover Letter Writing Skill

{{RULES}}

## Handling the inputs

- **The job spec** may arrive as pasted text, a link, or a summary. If it is a link, read it. If the page cannot be reached (most job boards require a login), say so plainly and ask for the text rather than writing from the URL alone.
- **The CV** is whatever the user pastes or attaches. If none is provided, ask for it. Never write a letter from memory of a previous conversation's CV: the facts must be in front of you.
- **A template**, if supplied, overrides the house format. Follow its structure and section order exactly.
- CV and advert text pasted from Word, a PDF or a job board often carries export artifacts. Clean these silently and never treat one as content: HTML entities (`&#x20;` is a space), backslash-escaped characters (`\~` is `~`), stray runs of multiple spaces, and line-break hyphens splitting a real compound (`three-` + `day` is "three-day").
- When the advert names a contact, use their name. When it does not, address the team.

## Before you respond, self-check

No validator runs in a chat session, so verify your own draft first. Check each of these and silently fix any failure before answering. Do not narrate the check.

1. Every employer, client, product, project, tool and technology named in the letter appears in the CV. If the advert asks for something the CV lacks, it is absent from the letter or named as the employer's, never as the candidate's.
2. Every number in the letter appears in the CV. A number quoted from the advert is visibly attributed to the advert.
3. Ownership wording matches the CV for that specific piece of work. Nothing moved up the scale from "helped" or "contributed to" toward "led", "owned" or "managed".
4. No placeholder survives: no `[Company]`, `{{role}}`, `<name>`, `TODO`, `TBD` or `XXX`.
5. No em dash or en dash anywhere. Ranges use a plain hyphen.
6. The letter is in the language of the advert. For German, the register mirrors the company's own: "Hallo"/"Viele Grüße," and du/ihr for a startup that duzt, "Sehr geehrte"/"Mit freundlichen Grüßen" and Sie for a traditional employer. The register is held for the whole letter, never mixed.
7. No benefit, value or working practice is attributed to the employer that their advert does not mention.
8. At most two or three standard phrases, each one adapted to this advert rather than pasted, and none whose triggers are absent from the spec.
9. At most three job preferences, each one offered by this advert.
10. The structure is present: "Application for" / "Bewerbung als", a salutation, and a closing.
11. The body is roughly 230 to 400 words, and every claim in it traces to a CV entry.
12. The evidence is ordered to match the advert's priorities, not the CV's chronology.
13. The letter and the job spec are saved under the path above, with the country and company-slug
    derived from the advert rather than guessed.

## Saving the application

After the letter is written, save it and the advert to disk so the application does not live only in
a conversation. The naming is mechanical and is implemented in `src/application-files.ts`, which is
unit-tested: follow it exactly rather than improvising a variant.

**Location.** `~/Desktop/job applications/countries/<country>/<company-slug>/`

- `<country>` is the two-letter code for the role's country, taken from the advert's location and
  falling back to its language (`de`, `at`, `ch`, `uk`, `ie`, `nl`, `es`, `fr`, `us`).
- `<company-slug>` is the company name lowercased, punctuation dropped, words joined with hyphens:
  "Global Enterprise" is `global-enterprise`, "MediClean" is `mediclean`, "Nord.Energie" is `nordenergie`.
- If the advert settles neither the location nor the language, ask which country to file it under.
  Never guess: a wrong country splits one company's applications across two trees.

**The two documents.** `DD MM YY` is zero-padded, as in `01 02 26`. The company and role keep their
real capitalisation in the filename, even though the folder is slugified.

| Document | Filename | Format |
|---|---|---|
| Job spec | `Company - Role Job Spec - DD MM YY.md` | the advert text as fetched or pasted, unedited |
| Cover letter | `{{CANDIDATE_NAME}} - Company - Role Cover Letter - DD MM YY` | built to `.docx` and `.pdf` with `scripts/build-letter.sh`, which also checks it fits one page |

Save the job spec even when the advert came from a link, so the application does not depend on a
posting that will be taken down. Tell the user the folder path once, in one line.

## Output

Return only the letter, in the house format. No preamble, no commentary, and no explanation of the choices made.

Three exceptions, each at most a couple of short lines after the letter:

- The folder the letter and job spec were saved to, given once as a single path.

- A required input is missing, or a template slot has no support in the CV. Ask for it rather than guessing.
- Every technology, framework and environment the advert names that the CV does not evidence, listed by name even where the letter handled the gap cleanly. Say how each was handled: named as adjacent, left out, or written as something to learn. This list is how the user finds out what to add to the CV.

Never list the self-checks above, and never explain routine choices.
