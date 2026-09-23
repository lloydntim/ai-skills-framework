import { describe, expect, it } from 'vitest';
import { FRAMEWORK_CASES } from './cases';
import {
  decidesWhatTheSkillLoads,
  explainsCostBeforeScaffolding,
  findsInstructionSource,
  recommendsAppropriateBand,
} from './checks';

describe('findsInstructionSource', () => {
  it('accepts the one supplied file referred to as "that file", with a question about other copies', () => {
    const t = 'The text you pasted is a description. Is that file the only copy, or is it pasted somewhere else?';
    expect(findsInstructionSource(t, ['legal-summary-skill.md']).ok).toBe(true);
  });

  it('accepts the file the request pointed at, however the transcript refers to it', () => {
    const t = "You've pointed me at one file. Is that genuinely the only copy, or is it in a system prompt too?";
    expect(findsInstructionSource(t, ['legal-summary-skill.md']).ok).toBe(true);
  });

  it('accepts the question about other locations however it is worded', () => {
    const t = 'Does this text live anywhere besides that file? It may have been pasted into a second repo.';
    expect(findsInstructionSource(t, ['legal-summary-skill.md']).ok).toBe(true);
  });

  it('fails a reference to the file that never asks whether other copies exist', () => {
    expect(findsInstructionSource('That file is short. Yes, add evaluation.', ['legal-summary-skill.md']).ok).toBe(false);
  });

  it('never accepts a bare "that file" when several files are expected', () => {
    const t = 'Is that file the only copy?';
    expect(findsInstructionSource(t, ['SKILL.md', 'chat-wrapper.md']).ok).toBe(false);
  });
});

describe('decidesWhatTheSkillLoads', () => {
  const decided = [
    'Keep the manual out of SKILL.md: split it into one reference file per product area, read only when the ticket is about that area.',
    "The agent's name and phone number are personal details: the skill names them as {{AGENT_NAME}} placeholders, filled in at run time, and the test cases use made-up values rather than a real agent's.",
    'The reviewer gets its own prompt and never sees the skill instructions, so it is not primed by the rules it checks.',
  ].join('\n');

  it('passes when all three decisions are made', () => {
    expect(decidesWhatTheSkillLoads(decided).ok).toBe(true);
  });

  it('accepts the same decisions in other words', () => {
    const plain = [
      "Don't feed the whole manual every time: structure it as a routable reference set, not one blob.",
      "The agent's name and number are per-agent values supplied at call time, and never end up in a fixture or anything exported.",
      "Don't let the same model instance that made the mistake grade its own homework.",
    ].join('\n');
    expect(decidesWhatTheSkillLoads(plain).ok).toBe(true);
  });

  it('names each decision that is missing', () => {
    const noIsolation = decided.split('\n').slice(0, 2).join('\n');
    const result = decidesWhatTheSkillLoads(noIsolation);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('keeps the checker apart');
    expect(result.detail).not.toContain('personal details out');
  });

  it('fails a transcript that pastes everything into the skill', () => {
    const everything = 'Paste the whole manual and the agent details into SKILL.md, and have the reviewer use the same file.';
    expect(decidesWhatTheSkillLoads(everything).ok).toBe(false);
  });

  it('cannot be passed by repeating the request, which names none of the decisions', () => {
    const scenario = FRAMEWORK_CASES.find((c) => c.id === 'context-for-new-skill')!;
    const { requestText, cleanup } = scenario.setup();
    cleanup();
    expect(decidesWhatTheSkillLoads(requestText).ok).toBe(false);
  });
});

describe('decidesWhatTheSkillLoads, on personal details', () => {
  const rest =
    'Retrieve only the relevant section of the manual, not the whole thing, and give the reviewer its own prompt with a fresh context. ';

  it('accepts details kept out of the skill file, its test cases and exports', () => {
    const t = `${rest}The signature is runtime data, not skill content: the name and phone never belong in SKILL.md, in a test case, or in anything you export.`;
    expect(decidesWhatTheSkillLoads(t).ok).toBe(true);
  });

  it('fails details handled only as a prompt variable, with nothing said about cases or exports', () => {
    const t = `${rest}Append the signature from agent metadata as a template variable, inserted after generation.`;
    expect(decidesWhatTheSkillLoads(t).ok).toBe(false);
  });

  it('still fails an answer that never settles where the details live', () => {
    const t = `${rest}End each reply with the agent's name and phone number.`;
    expect(decidesWhatTheSkillLoads(t).ok).toBe(false);
  });
});

describe('recommendsAppropriateBand', () => {
  it('reads a stated stopping point as the recommended band', () => {
    const t = 'So my recommendation: stop after step 1, maybe glance at step 2, and skip 3-8 entirely.';
    expect(recommendsAppropriateBand(t, 'steps-1-2').ok).toBe(true);
    expect(recommendsAppropriateBand(t, 'steps-3-4').ok).toBe(false);
  });

  it('takes the first stopping point when a fallback is offered', () => {
    const t = 'Steps 5-8 are not worth it. Stopping after step 2 (or 4, if the stakes justify it) is the correct call.';
    expect(recommendsAppropriateBand(t, 'steps-1-2').ok).toBe(true);
  });

  it('accepts a range written with an en dash', () => {
    expect(recommendsAppropriateBand('Build steps 3\u20134 and stop there.', 'steps-3-4').ok).toBe(true);
  });

  it('fails an answer that never names a band, however sound', () => {
    const t = 'Use schema validation and deterministic checks with unit tests. No judge is needed.';
    expect(recommendsAppropriateBand(t, 'steps-3-4').ok).toBe(false);
  });

  it('reads the furthest step of a laid-out plan as the recommended band', () => {
    const t =
      '1. Steps 1–2 regardless.\n2. Step 4 first, not last.\n' +
      '3. Steps 5–6 (approved baseline + regression run) next.\n' +
      '4. Step 8 (runtime validator) is its own decision.';
    expect(recommendsAppropriateBand(t, 'steps-5-8').ok).toBe(true);
    expect(recommendsAppropriateBand(t, 'steps-3-4').ok).toBe(false);
  });

  it('does not count a planned step that is skipped or made conditional', () => {
    const t = 'Do steps 1-2 first. Skip steps 5-8 then. Steps 3-4 only once it grows, then revisit.';
    expect(recommendsAppropriateBand(t, 'steps-1-2').ok).toBe(true);
  });

  it('reads the verdict line in preference to anything else the prose says', () => {
    const t = 'Recommended band: steps 5-8\n\nSteps 1-4 come first regardless, and most skills stop after step 4.';
    expect(recommendsAppropriateBand(t, 'steps-5-8').ok).toBe(true);
    expect(recommendsAppropriateBand('**Recommended band: steps 1-2**\n\nSteps 3-4 later.', 'steps-1-2').ok).toBe(true);
  });

  it('reads a band recommended by name over the order the steps are built in', () => {
    const band = 'recommend the full band, so I am: build through step 8. Steps 1-4 are free and come first regardless.';
    expect(recommendsAppropriateBand(band, 'steps-5-8').ok).toBe(true);
    const range = 'The honest recommendation is the full band — steps 5-8.\n\n| 1-2 | free |\n| 3-4 | free |';
    expect(recommendsAppropriateBand(range, 'steps-5-8').ok).toBe(true);
    expect(recommendsAppropriateBand('So: recommend the full 5-8 band, state the cost.', 'steps-5-8').ok).toBe(true);
  });

  it('does not read a negated stopping point as the band', () => {
    const t = 'What the framework says to recommend band 5-8 for. So: don’t stop at step 4 here. Do steps 1-4 now.';
    expect(recommendsAppropriateBand(t, 'steps-5-8').ok).toBe(true);
  });

  it('does not read a declined recommendation as the band', () => {
    const t = "I wouldn't recommend steps 5-8 here. My recommendation is steps 1-2.";
    expect(recommendsAppropriateBand(t, 'steps-1-2').ok).toBe(true);
  });

  it('does not read the quoted general rule as this skill’s stopping point', () => {
    const t = 'Most skills should stop after step 4. This one should not: steps 5-6 next, then decide on 8.';
    expect(recommendsAppropriateBand(t, 'steps-5-8').ok).toBe(true);
  });
});

describe('explainsCostBeforeScaffolding', () => {
  it('needs no cost statement when a judge is only declined', () => {
    const t = 'There is no judge worth paying for here, and steps 5-8 (judge, runner, variants) are overkill. Stop after step 1.';
    expect(explainsCostBeforeScaffolding(t).ok).toBe(true);
  });

  it('requires a cost statement when a judge is proposed', () => {
    expect(explainsCostBeforeScaffolding("Next, I'll build a judge to score each summary.").ok).toBe(false);
    expect(
      explainsCostBeforeScaffolding("Next, I'll build a judge to score each summary: about 40 model calls per run.").ok
    ).toBe(true);
  });

  it('treats a recommendation to stop at step 5 or later as proposing paid evaluation', () => {
    expect(explainsCostBeforeScaffolding('Stop at step 8 for this one.').ok).toBe(false);
  });

  it('reads a call count written with markdown and arithmetic in the way', () => {
    const t =
      'Recommended band: steps 5-8. Roughly `2 × 25` generate calls + `25` evaluator calls per benchmark run.';
    expect(explainsCostBeforeScaffolding(t).ok).toBe(true);
  });

  it('treats a plan that reaches step 5 or later as proposing paid evaluation', () => {
    const t = 'Step 4 first. Steps 5–6 (approved baseline + regression run) next.';
    expect(explainsCostBeforeScaffolding(t).ok).toBe(false);
    expect(explainsCostBeforeScaffolding(`${t} With 8 golden cases that is about 16 model calls per run.`).ok).toBe(true);
  });
});
