# Candidate profile (example)

A fictional candidate, Jordan Sample, whose employers (Northwind Retail, Fabrikam Energy, Contoso
Bank) are made up. This file is public: the tests run against it, and it is the starting point for
a real profile.

SKILL.md holds the rules and names what it needs from the candidate as `{{PLACEHOLDERS}}`. Each
`## KEY` section below fills the placeholder of the same name, exactly as written (blank lines
around it are dropped). To use the skill for a real person, copy this file to
`reference/candidate-profile.md`, which is private and never exported, and replace every section.
To keep it outside the repository instead, set `COVER_LETTER_PROFILE` to its path (in the shell or
in `.env`).

Everything under a heading must be true of the candidate and grounded in their CV. The checks
enforce the two banks against the CV, and the contact and right-to-work keys against every letter.

| Key | What it is | Where it is used |
|---|---|---|
| `CANDIDATE_NAME` | Name as signed at the end of a letter | letter templates, saved filename |
| `CANDIDATE_NAME_LETTERHEAD` | Name as it heads the letter | letter templates |
| `EMAIL` | The one address used in every market | contact block, checks |
| `LINKEDIN`, `GITHUB`, `PORTFOLIO` | Profile links, as written on a letter | SKILL.md |
| `POSITIONING_EXAMPLES` | Title lines the CV supports | SKILL.md |
| `UK_LOCATION`, `UK_PHONE` | Contact block for UK and Irish roles | SKILL.md, contact checks |
| `DACH_LOCATION`, `DACH_PHONE` | Contact block for German, Austrian and Swiss roles; the part before the comma is forbidden on a UK letter | SKILL.md, contact checks |
| `UK_RIGHT_TO_WORK`, `IE_RIGHT_TO_WORK` | The candidate's status in each market and how to state it | SKILL.md |
| `UK_RIGHT_TO_WORK_WORDINGS`, `IE_RIGHT_TO_WORK_WORDINGS` | Comma-separated wordings, one of which a letter for that market must contain | checks |
| `STANDARD_PHRASES` | Rows of the phrase bank: `ID \| triggers \| phrase \| German or - \| CV anchor` | SKILL.md, phrase checks |
| `JOB_PREFERENCES` | Rows of the preference bank: `ID \| signals \| sentence \| German or -` | SKILL.md, preference checks |
| `OWNERSHIP_EXAMPLES` | CV wordings that must not be upgraded, as indented bullets | hard rules |
| `METRIC_EXAMPLES` | CV metrics that must not be restated | hard rules |
| `GAP_ADJACENT_EXAMPLE`, `SHALLOW_EXPOSURE_EXAMPLE` | How this CV's adjacent and dated experience may be described | gaps |
| `OVERCLAIM_EXAMPLE` | A claim of knowledge the CV does not support, not to be repeated | gaps |
| `LEARNING_DISPOSITION` | The candidate's approved wording for picking things up quickly | gaps |
| `CITATION_NOTES` | Candidate-specific guidance on which evidence to lead with | choosing what to cite |
| `VOICE` | How the candidate writes, with wrong-and-right pairs | voice |
| `TEMPLATE_PROVENANCE`, `TEMPLATE_LANGUAGE_PROVENANCE` | Where the house format came from | letter templates |

## CANDIDATE_NAME

Jordan Sample

## CANDIDATE_NAME_LETTERHEAD

JORDAN SAMPLE

## EMAIL

jordan.sample@example.com

## LINKEDIN

linkedin.com/in/jordan-sample-example

## GITHUB

github.com/jordan-sample-example

## PORTFOLIO

https://jordan-sample.example.com

## POSITIONING_EXAMPLES

"Senior Frontend Engineer", "Frontend Engineer / Design Systems"

## UK_LOCATION

London, UK

## UK_PHONE

+44 7700 900123

## DACH_LOCATION

Leipzig, Germany

## DACH_PHONE

+49 176 12345678

## UK_RIGHT_TO_WORK

the candidate is a British citizen, so no visa sponsorship is needed. Say so in the closing paragraph of every UK letter: "As a British citizen I have the right to work in the UK, so no visa sponsorship is required." Never state a different status.

## UK_RIGHT_TO_WORK_WORDINGS

British citizen, right to work in the UK, no visa sponsorship

## IE_RIGHT_TO_WORK

a British citizen may live and work in Ireland under the Common Travel Area. State it plainly in the closing paragraph: "As a British citizen I have the right to work in Ireland."

## IE_RIGHT_TO_WORK_WORDINGS

right to work in Ireland, British citizen, Common Travel Area

## STANDARD_PHRASES

| performance-seo | performance, Core Web Vitals, Lighthouse, page speed, SEO, Ladezeit | At Northwind Retail I moved the product pages to server-side rendering, which lifted Lighthouse scores from 60 to 90 without losing search traffic. | - | Northwind |
| design-system | design system, component library, Design-System, Komponentenbibliothek, reusable components | At Fabrikam Energy I helped consolidate three separate form implementations into one shared component library used by four product teams. | - | Fabrikam |
| testing-quality | testing, test coverage, quality, TDD, code review, Testabdeckung | At Contoso Bank I introduced Vitest and structured code reviews, raising frontend test coverage from 20% to 65%. | Bei der Contoso Bank führte ich Vitest und strukturierte Code Reviews ein und erhöhte die Frontend-Testabdeckung von 20 % auf 65 %. | Contoso |
| bilingual-dach | German, Deutsch, DACH, bilingual, Deutschkenntnisse | I work in German and English, which kept me effective in the Leipzig team at Fabrikam Energy. | - | German |

## JOB_PREFERENCES

| remote-work | remote, hybrid, remote-first, work from home, home office, Homeoffice, mobiles Arbeiten | Working remotely matters to me, because I plan my week around long stretches of focused work. | - |
| learning-budget | training budget, learning budget, conference, certification, Weiterbildung, Weiterbildungsbudget, Fortbildung | A budget for learning appeals to me, because I would rather keep deepening what I know than stand still. | - |
| international-team | international, multilingual, cross-border, global team, distributed team, internationales Team, mehrsprachig | I like working in international teams, where people bring different habits to the same problem. | - |
| early-stage | early stage, founding, first hire, seed, greenfield, Gründer, frühe Phase, Aufbau | Joining while the product and the engineering habits are still being shaped is the kind of work I want next. | - |
| design-product-collaboration | designer, product manager, product owner, UX, cross-functional, Design-Team, Produktteam, stakeholder | I enjoy working closely with designers and product managers, and bringing the technical view in early. | Ich arbeite gerne eng mit Designern und Product Managern zusammen und bringe die technische Sicht früh ein. |

## OWNERSHIP_EXAMPLES

  - CV "helped consolidate three separate form implementations" is never "built the component library".
  - CV "contributed to the checkout rewrite" is never "led the checkout rewrite".

## METRIC_EXAMPLES

CV "lifted Lighthouse scores from 60 to 90" is never "a 50% performance gain". CV "four product teams" is never "every product team".

## GAP_ADJACENT_EXAMPLE

"I have worked with Vue at Northwind Retail, though most of my recent depth is in React"

## SHALLOW_EXPOSURE_EXAMPLE

CV "Junior Developer - Contoso Bank (2016) - jQuery" does not support "extensive jQuery experience".

## OVERCLAIM_EXAMPLE

A draft that says "I already bring some knowledge of Kafka" crosses this line when Kafka is not in
the CV. Do not write that pattern. Where the knowledge is real, it is the CV that needs updating.

## LEARNING_DISPOSITION

The candidate's approved wording: "I pick up new tools quickly and like putting what I learn into
practice straight away."

## CITATION_NOTES

**Design-system adverts.** The component-library work at Fabrikam Energy is the candidate's
strongest evidence for these roles, so lead with it even though it is not the most recent.

## VOICE

Write in the first person and do not avoid "I". Use full sentences with finite verbs, and state
interest plainly rather than performing it.
- Not "Five years of frontend work, mostly React."
- But "I have spent five years in frontend engineering, most of it in React."

## TEMPLATE_PROVENANCE

The house format follows the letters the candidate has already sent.

## TEMPLATE_LANGUAGE_PROVENANCE

The German template follows the same structure, with the German register and closing.
