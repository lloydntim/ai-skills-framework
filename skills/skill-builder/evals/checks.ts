/**
 * Deterministic, mechanical checks over one transcript (the free text a model produced while
 * following, or not following, the skill-builder skill). No model call, no opinion: every check
 * here is a regex or substring test, per blueprint section 9 ("Testing a workflow skill"): measure
 * observable invariants, not prose quality, for a skill whose job is guiding a conversation rather
 * than producing scored prose.
 */

export interface CheckResult {
  ok: boolean;
  detail: string;
}

export type CheckName =
  | 'findsInstructionSource'
  | 'recommendsAppropriateBand'
  | 'explainsCostBeforeScaffolding'
  | 'preservesWordingDuringRestructuring'
  | 'separatesPortableFromAdapter'
  | 'definesValidSameModelBaseline'
  | 'noUnmeasuredImprovementClaim'
  | 'doesNotApproveUnreadBaseline'
  | 'decidesWhatTheSkillLoads';

export type AdoptionBand = 'steps-1-2' | 'steps-3-4' | 'steps-5-8';

// A range may be written with a hyphen, an en dash, an em dash or a word ("steps 1 to 2").
const RANGE = String.raw`\s*(?:-|–|—|to|through)\s*`;
const BAND_PATTERNS: Record<AdoptionBand, RegExp> = {
  'steps-1-2': new RegExp(String.raw`\bsteps?\s*1${RANGE}2\b`, 'i'),
  'steps-3-4': new RegExp(String.raw`\bsteps?\s*3${RANGE}4\b`, 'i'),
  'steps-5-8': new RegExp(String.raw`\bsteps?\s*5${RANGE}8\b`, 'i'),
};

// "stop after step 1", "stopping at step 4": the plainest way to recommend a band, and one that a
// range mention ("skip steps 5-8") cannot be mistaken for.
const STOP_AT_STEP_RE = /\bstop(?:s|ping)?\s+(?:after|at)\s+steps?\s*(\d)\b/gi;
// "Most skills should stop after step 4" quotes the general rule, not a recommendation for this one,
// and "don't stop at step 4 here" says the opposite of what it matches.
const NOT_A_STOP_RE = /\bmost (?:skills|of them)\b[^.\n]*$|(?:\bdo\s?n[o'’]t|\bnot|n['’]t|\brather than|\binstead of)\s*$/i;

// A step placed in the plan: "Step 4 first", "Steps 1-2 regardless", "Steps 5–6 (baseline and
// regression run) next". A step that is skipped or made conditional between the two is not planned.
const PLAN_STEP_RE = new RegExp(
  String.raw`\bsteps?\s*(\d)(?:${RANGE}(\d))?\b([^.\n]{0,60}?)\b(?:first|next|then|regardless)\b`,
  'gi'
);
const NOT_PLANNED_RE = /\b(?:skip|not|never|no|don't|avoid|without|overkill|unless|if|once|when|until|later)\b/i;
const DECLINED_BEFORE_RE = /\b(?:skip(?:ping)?|not|never|no|don't|avoid|without)\s+(?:\w+\s+){0,2}$/i;

function bandOfStep(step: number): AdoptionBand {
  if (step <= 2) return 'steps-1-2';
  if (step <= 4) return 'steps-3-4';
  return 'steps-5-8';
}

/** The band the transcript says to stop at, if it says so in so many words; the first one wins. */
function statedStopBand(transcript: string): AdoptionBand | undefined {
  for (const m of transcript.matchAll(STOP_AT_STEP_RE)) {
    if (NOT_A_STOP_RE.test(transcript.slice(Math.max(0, m.index - 40), m.index))) continue;
    return bandOfStep(Number(m[1]));
  }
  return undefined;
}

/** The band of the furthest step the transcript's plan says to do, if it lays out such a plan. */
function plannedBand(transcript: string): AdoptionBand | undefined {
  let furthest = 0;
  for (const m of transcript.matchAll(PLAN_STEP_RE)) {
    if (NOT_PLANNED_RE.test(m[3])) continue;
    if (DECLINED_BEFORE_RE.test(transcript.slice(Math.max(0, m.index - 30), m.index))) continue;
    furthest = Math.max(furthest, Number(m[2] ?? m[1]));
  }
  return furthest > 0 ? bandOfStep(furthest) : undefined;
}

// A band recommended in so many words: "I recommend steps 5-8", "recommend the full 5-8 band",
// "the recommendation is the full band — steps 5-8", "build through step 8". The order the steps are
// built in ("steps 1-4 first") says nothing about how far to go, so this is read before the plan.
const RECOMMENDED_RE = new RegExp(
  String.raw`\b(?:recommend\w*|build)\b([^.\n]{0,40}?)\b(?:(?:steps?|band)\s*\d${RANGE}(\d)|\d${RANGE}(\d)\s+band|through\s+steps?\s*(\d))\b`,
  'gi'
);
const NOT_RECOMMENDED_RE = /\b(?:not|never|against|hold off|skip)\b|n['’]t\b/i;

/** The band of the furthest range the transcript recommends by name, if it names one. */
function namedBand(transcript: string): AdoptionBand | undefined {
  let furthest = 0;
  for (const m of transcript.matchAll(RECOMMENDED_RE)) {
    const before = transcript.slice(Math.max(0, m.index - 20), m.index);
    if (NOT_RECOMMENDED_RE.test(m[1]) || NOT_RECOMMENDED_RE.test(before)) continue;
    furthest = Math.max(furthest, Number(m[2] ?? m[3] ?? m[4]));
  }
  return furthest > 0 ? bandOfStep(furthest) : undefined;
}

// The one-line verdict SKILL.md asks for ("Recommended band: steps 5-8"). Free prose says the same
// thing a dozen ways, so the skill states it once in a fixed form and this reads that line.
const VERDICT_RE = new RegExp(String.raw`recommended band:\s*\**\s*steps?\s*(\d)${RANGE}(\d)`, 'i');

/** The band named on the skill's own verdict line, if it wrote one. */
function verdictBand(transcript: string): AdoptionBand | undefined {
  const m = VERDICT_RE.exec(transcript);
  return m ? bandOfStep(Number(m[2])) : undefined;
}

/** The verdict line wins, then a stopping point, then a band named in prose, then the plan. */
function recommendedBand(transcript: string): AdoptionBand | undefined {
  return verdictBand(transcript) ?? statedStopBand(transcript) ?? namedBand(transcript) ?? plannedBand(transcript);
}

// When the request pastes the one file in, "that file" or "what you pasted" names it as surely as its
// path does. Finding it also means asking whether it is the only copy (SKILL.md, "which skill, and
// where does it live now?"). With several expected files, a bare "that file" says which of them.
const SUPPLIED_FILE_RE =
  /\b(?:th(?:is|at|e)|one) (?:instruction )?(?:file|path|text)\b|\byou (?:pasted|gave me|sent me|shared)\b|\bpointed me at\b/i;
// Asking the question at all, however it is worded: "the only copy?", "anywhere besides that file?",
// "pasted into a second repo?". Variant A never mentions the file or its copies at all.
const OTHER_COPIES_RE =
  /\bcop(?:y|ies)\b|\b(?:more than one|another|second)\s+(?:place|repo|file|source|tool|prompt)\b|\banywhere (?:else|besides)\b|\bsomewhere else\b|\belsewhere\b|\bpasted into\b|\bonly (?:place|source)\b/i;

/** Does the transcript show it located the actual instruction text, by naming where it lives? */
export function findsInstructionSource(transcript: string, expectedPathFragments: string[]): CheckResult {
  const found = expectedPathFragments.filter((fragment) => transcript.includes(fragment));
  if (found.length > 0) {
    return { ok: true, detail: `Transcript names the actual instruction location: ${found.join(', ')}.` };
  }
  if (expectedPathFragments.length === 1 && SUPPLIED_FILE_RE.test(transcript) && OTHER_COPIES_RE.test(transcript)) {
    return {
      ok: true,
      detail: `Transcript refers to the supplied file (${expectedPathFragments[0]}) and asks whether it is the only copy.`,
    };
  }
  return {
    ok: false,
    detail: `Transcript never names any of the expected instruction locations: ${expectedPathFragments.join(', ')}.`,
  };
}

/** Does the transcript recommend the band appropriate to the case, and no other band? */
export function recommendsAppropriateBand(transcript: string, expectedBand: AdoptionBand): CheckResult {
  const band = recommendedBand(transcript);
  if (band) {
    return {
      ok: band === expectedBand,
      detail:
        band === expectedBand
          ? `Transcript recommends going as far as "${expectedBand}".`
          : `Transcript recommends going as far as "${band}", not "${expectedBand}".`,
    };
  }

  const mentionsExpected = BAND_PATTERNS[expectedBand].test(transcript);
  const otherBands = (Object.keys(BAND_PATTERNS) as AdoptionBand[]).filter((b) => b !== expectedBand);
  const mentionsOther = otherBands.filter((b) => BAND_PATTERNS[b].test(transcript));

  if (!mentionsExpected) {
    return { ok: false, detail: `Transcript never recommends the expected band "${expectedBand}".` };
  }
  if (mentionsOther.length > 0 && !/menu|not a mandate|stop wherever/i.test(transcript)) {
    return {
      ok: false,
      detail: `Transcript also asserts band(s) ${mentionsOther.join(', ')} as if recommended, without framing the steps as an optional menu.`,
    };
  }
  return { ok: true, detail: `Transcript recommends "${expectedBand}".` };
}

// A number of calls, a multiplication, or a per-run figure. Markdown and arithmetic get between the
// number and the word ("`25` evaluator calls", "2 × 25"), and the run gets named ("per eval run").
const COST_STATEMENT_RE = /\d[\d,]*[^.\n]{0,15}?\bcalls?\b|\d+\s*[x×*]\s*\d+|\bper\s+(?:\w+\s+){0,2}run\b/i;
// Proposing a judge, not merely naming one: "no judge worth paying for" and "skip steps 5-8 (judge,
// runner, ...)" decline it, and need no cost statement.
const PROPOSES_SCAFFOLD_RE =
  /\b(?:I(?:'ll| will)|let'?s|we(?:'ll| will| should)|you should|I(?:'d)? recommend|recommend(?:ed)?)\s+(?:(?:also|then|now)\s+)?(?:build|add|set up|write|wire up|scaffold|building|adding|setting up|writing)\b[^.\n]{0,80}\b(judge|evaluator|runner|benchmark suite|eval(?:uation)? (?:runner|harness))\b/i;

/** Before proposing a paid eval runner/judge, does the transcript state roughly what one run costs? */
export function explainsCostBeforeScaffolding(transcript: string): CheckResult {
  const proposes = PROPOSES_SCAFFOLD_RE.test(transcript) || recommendedBand(transcript) === 'steps-5-8';
  if (!proposes) {
    return { ok: true, detail: 'Transcript never proposes scaffolding a paid evaluation, so no cost statement is required.' };
  }
  const costStated = COST_STATEMENT_RE.test(transcript);
  return {
    ok: costStated,
    detail: costStated
      ? 'Transcript states an approximate call/cost count alongside proposing paid evaluation.'
      : 'Transcript proposes a judge/runner/benchmark without ever stating an approximate call or cost count.',
  };
}

/** Do the original rule sentences survive, unedited, inside the restructured output? */
export function preservesWordingDuringRestructuring(originalSentences: string[], restructuredText: string): CheckResult {
  const missing = originalSentences.filter((sentence) => !restructuredText.includes(sentence));
  return {
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? 'Every original rule sentence survives unedited in the restructured text.'
        : `Wording changed or dropped during restructuring: ${missing.map((s) => `"${s}"`).join('; ')}.`,
  };
}

const PORTABLE_TERMS = /\b(canonical|portable)\b/i;
const ADAPTER_TERMS = /\b(adapter|wrapper|platform[- ]specific)\b/i;

/** Does the transcript keep "the workflow" and "the platform packaging" as two distinct things? */
export function separatesPortableFromAdapter(transcript: string): CheckResult {
  const hasPortable = PORTABLE_TERMS.test(transcript);
  const hasAdapter = ADAPTER_TERMS.test(transcript);
  return {
    ok: hasPortable && hasAdapter,
    detail:
      hasPortable && hasAdapter
        ? 'Transcript names both a canonical/portable layer and a platform adapter layer as separate things.'
        : 'Transcript does not clearly separate canonical/portable instructions from a platform adapter.',
  };
}

/** For an A/B comparison request, does the transcript keep the model identical across A and B? */
export function definesValidSameModelBaseline(transcript: string): CheckResult {
  const sameModelStated = /\bsame model\b/i.test(transcript);
  const twoDifferentModels = /\b(claude|sonnet|opus|haiku|gpt|gemini)[a-z0-9. -]*\b.*\b(and|vs\.?|versus)\b.*\b(claude|sonnet|opus|haiku|gpt|gemini)[a-z0-9. -]*\b/i;
  const modelNames = Array.from(transcript.matchAll(/\b(sonnet|opus|haiku|gpt-\d|gemini)\b[a-z0-9. -]*/gi)).map((m) =>
    m[0].toLowerCase().trim()
  );
  const distinctModels = new Set(modelNames);
  const namesTwoModels = distinctModels.size > 1;

  if (namesTwoModels && !sameModelStated) {
    return {
      ok: false,
      detail: `Transcript names more than one model (${Array.from(distinctModels).join(', ')}) for an A/B comparison without stating they are the same model.`,
    };
  }
  return {
    ok: sameModelStated || distinctModels.size <= 1,
    detail: sameModelStated
      ? 'Transcript explicitly states variant A and B use the same model.'
      : 'Transcript does not name conflicting models, so a same-model baseline is not contradicted.',
  };
}

const UNQUALIFIED_IMPROVEMENT_RE = /\b(this (?:should|will) be better|(?:it|this) (?:will|should) improve|clearly better|definitely (?:better|improves))\b/i;
const MEASURED_QUALIFIER_RE = /\b(not (?:yet )?measured|has not been measured|run the comparison|once (?:we|it'?s?) measure)\b/i;

/** Does the transcript avoid asserting an improvement it has not actually measured? */
export function noUnmeasuredImprovementClaim(transcript: string): CheckResult {
  const claimsImprovement = UNQUALIFIED_IMPROVEMENT_RE.test(transcript);
  const qualifiesAsUnmeasured = MEASURED_QUALIFIER_RE.test(transcript);
  const ok = !claimsImprovement || qualifiesAsUnmeasured;
  return {
    ok,
    detail: ok
      ? 'Transcript does not assert an unqualified, unmeasured improvement.'
      : 'Transcript asserts the skill is better without numbers and without saying it is unmeasured.',
  };
}

const APPROVAL_ACTION_RE = /\b(i(?:'ll| will)?\s*approve|approving|baseline (?:is|has been) approved)\b/i;
const READ_EVIDENCE_RE = /\b(read (?:the|through) (?:the )?outputs?|reviewed the (?:outputs?|results?)|read (?:each|every) (?:output|case))\b/i;

/** Does the transcript ever approve a baseline without first showing it read the outputs? */
export function doesNotApproveUnreadBaseline(transcript: string): CheckResult {
  const approvalMatch = APPROVAL_ACTION_RE.exec(transcript);
  if (!approvalMatch) {
    return { ok: true, detail: 'Transcript never approves a baseline, so nothing to check.' };
  }
  const beforeApproval = transcript.slice(0, approvalMatch.index);
  const readFirst = READ_EVIDENCE_RE.test(beforeApproval) || READ_EVIDENCE_RE.test(transcript);
  return {
    ok: readFirst,
    detail: readFirst
      ? 'Transcript shows it read the outputs before approving a baseline.'
      : 'Transcript approves a baseline without ever stating it read the outputs first.',
  };
}

// Where a detail would outlast the run if it were written down: 7.15's "the same holds for its test
// cases and saved outputs".
const STORED_ARTEFACT = String.raw`test cases?|golden|benchmark|fixtures?|export\w*|saved outputs?|checked into (?:git|the repo)|committed`;

// Blueprint 7.15, three of its questions, each as it would be said in plain words. The request never
// names them, so a transcript that answers them shows the skill raised them unprompted. A decision
// with two patterns has to satisfy both.
const CONTEXT_DECISIONS: Array<{ label: string; patterns: RegExp[] }> = [
  {
    label: 'loads large material only when a task needs it',
    patterns: [
      /\b(on demand|just in time|only when (?:it is |it's )?(?:relevant|needed)|reference (?:files?|set)|(?:read|load)(?:s|ed)? only|select(?:s|ed|ion)?\b[^.\n]{0,30}\b(?:by|per) (?:task|product|area)|(?:by|per) (?:product )?area|retriev\w+|not (?:one|a single) blob|(?:don't|do not|never) (?:feed|send|load|include) the (?:whole|entire|full))\b/i,
    ],
  },
  {
    // 7.15's "External", in full: the details are supplied at run time rather than written into the
    // skill, *and* the same holds for its test cases and saved outputs. Wording varies a lot
    // ("runtime data, not skill content", "a template variable", "never belong in SKILL.md"), so the
    // first pattern is broad; the second is the part a plain answer about prompt-building leaves out.
    label: 'keeps personal details out of the reusable skill',
    patterns: [
      /\b(?:private|personal (?:data|details)|profile|placeholders?|template variable|run-?time data|filled in at (?:load|run) time|(?:at|per) (?:run|call) time|per[- ]agent|agent metadata)\b|\b(?:never|not|don'?t)\b[^.\n]{0,40}\b(?:hard-?cod\w+|(?:in|into|inside) (?:the )?(?:skill|SKILL\.md|instructions|repo|test cases?))\b/i,
      // Tied to the details themselves: a stray "documented/committed" about the product is not a
      // decision about where someone's name and phone number may appear.
      new RegExp(
        String.raw`(?:name|phone|signature|personal|private)[^\n]{0,140}?(?:${STORED_ARTEFACT})|(?:${STORED_ARTEFACT})[^\n]{0,140}?(?:name|phone|signature|personal|private)`,
        'i'
      ),
    ],
  },
  {
    label: 'keeps the checker apart from the rules it checks',
    patterns: [
      /\b(its own prompt|own rubric|separate (?:prompt|context|skill|model|call|agent|instance)|isolat\w*|fresh context|(?:its|their) own homework|(?:never|not) (?:see|sees|receive|receives|be shown|get|gets) the (?:skill|instructions|rules))\b/i,
    ],
  },
];

/** Does the transcript settle what the new skill loads, keeps out and isolates (blueprint 7.15)? */
export function decidesWhatTheSkillLoads(transcript: string): CheckResult {
  const missing = CONTEXT_DECISIONS.filter((d) => !d.patterns.every((p) => p.test(transcript))).map((d) => d.label);
  return {
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? 'Transcript decides what to load on demand, what to keep private and what to isolate.'
        : `Transcript never decides: ${missing.join('; ')}.`,
  };
}

export const CHECKS: Record<CheckName, (transcript: string, arg?: unknown) => CheckResult> = {
  findsInstructionSource: (t, arg) => findsInstructionSource(t, arg as string[]),
  recommendsAppropriateBand: (t, arg) => recommendsAppropriateBand(t, arg as AdoptionBand),
  explainsCostBeforeScaffolding: (t) => explainsCostBeforeScaffolding(t),
  preservesWordingDuringRestructuring: (t, arg) => preservesWordingDuringRestructuring(arg as string[], t),
  separatesPortableFromAdapter: (t) => separatesPortableFromAdapter(t),
  definesValidSameModelBaseline: (t) => definesValidSameModelBaseline(t),
  noUnmeasuredImprovementClaim: (t) => noUnmeasuredImprovementClaim(t),
  doesNotApproveUnreadBaseline: (t) => doesNotApproveUnreadBaseline(t),
  decidesWhatTheSkillLoads: (t) => decidesWhatTheSkillLoads(t),
};
