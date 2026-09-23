import { describe, expect, it } from 'vitest';
import { makeUniformRoles } from '@skills/framework/testing/uniform-roles';
import { contactRequirements, MARKETS, type Market } from './markets';
import { runProductionSkill } from './runtime';
import { buildUserPrompt, skillSystemPrompt } from './runtime/generate';
import type { CoverLetterTaskInput, RuntimeConfig } from './runtime/types';
import { loadSkillPrompt } from './skill-loader';
import { selectSkillSections, skillContextOption } from './skill-sections';
import { FakeModelProvider } from './test-support/fake-model-provider';
import type { LetterLanguage } from './templates';

const skill = loadSkillPrompt();
const headings = (text: string) => text.split('\n').filter((line) => /^#{1,3} /.test(line));

const LANGUAGES: LetterLanguage[] = ['en', 'de'];
const TASKS = LANGUAGES.flatMap((language) =>
  [...MARKETS, undefined].map((market) => ({ language, market: market as Market | undefined }))
);

// Sections every letter needs, whatever its language or market. None may ever be selected out.
const ALWAYS_SENT = [
  '## Role',
  '## Hard rules (never break)',
  '## Reading the job spec',
  '## Quality goals',
  '## Voice',
  '## Structure',
  '## Standard phrases',
  '## Job preferences',
  '## Letter templates',
  '### Paragraph plan',
  '### Choosing what to cite',
  '### Filling the slots',
  '## Handling gaps honestly',
  '## Length and priority order',
  '## Output format',
];

describe('selectSkillSections', () => {
  it('finds every section it selects on in the real SKILL.md, for every language and market', () => {
    for (const task of TASKS) expect(() => selectSkillSections(skill, task)).not.toThrow();
  });

  it('never leaves out a section every letter needs', () => {
    for (const task of TASKS) {
      const kept = headings(selectSkillSections(skill, task).text);
      for (const heading of ALWAYS_SENT) expect(kept, `${task.language}/${task.market}`).toContain(heading);
    }
  });

  it('leaves out only the other language and, for DACH, the UK and Ireland section', () => {
    const omitted = (language: LetterLanguage, market?: Market) => selectSkillSections(skill, { language, market }).omitted;
    expect(omitted('en', 'uk')).toEqual(['### German', '## German Anschreiben conventions']);
    expect(omitted('en', undefined)).toEqual(['### German', '## German Anschreiben conventions']);
    expect(omitted('en', 'dach')).toEqual(['### German', '## German Anschreiben conventions', '## Applying in the UK and Ireland']);
    expect(omitted('de', 'ie')).toEqual(['### English']);
    expect(omitted('de', 'dach')).toEqual(['### English', '## Applying in the UK and Ireland']);
  });

  it('removes whole sections and changes nothing else', () => {
    const { text } = selectSkillSections(skill, { language: 'en', market: 'dach' });
    expect(text).not.toContain('```cover-letter-de');
    expect(text).toContain('```cover-letter-en');
    // Every line kept is an unchanged line of the original, in the original order.
    const original = skill.split('\n');
    let cursor = 0;
    for (const line of text.split('\n')) {
      cursor = original.indexOf(line, cursor);
      expect(cursor).toBeGreaterThanOrEqual(0);
      cursor += 1;
    }
  });

  it('ends a section at the next heading of the same or higher level, ignoring fenced blocks', () => {
    const text = ['# T', '## German Anschreiben conventions', 'a', '```', '## not a heading', '```', '### A1', 'a1', '### German', 'g', '## B', 'b'].join('\n');
    expect(selectSkillSections(text, { language: 'en' }).text).toBe(['# T', '## B', 'b'].join('\n'));
  });

  it('throws when a section it selects on has been renamed, rather than silently sending it', () => {
    expect(() => selectSkillSections('# Skill\n## Role\nx', { language: 'en' })).toThrow(/no "### German" section/);
  });
});

describe('what the model is shown still lets it meet the checks', () => {
  it('for DACH, every contact detail the checks require is in the user prompt', () => {
    const input: CoverLetterTaskInput = { cvText: 'cv', roleDescription: 'ad', instructions: 'x', language: 'de', market: 'dach' };
    const userPrompt = buildUserPrompt(input);
    for (const required of contactRequirements('dach').require) expect(userPrompt).toContain(required);
  });
});

const config: RuntimeConfig = {
  temperature: 0.3,
  maxOutputTokens: 4000,
  maxRevisionAttempts: 1,
  thresholds: { factualGrounding: 5, jobRelevance: 4, professionalTone: 4, specificity: 4, naturalness: 4, overall: 4 },
};
const input: CoverLetterTaskInput = { cvText: 'cv React', roleDescription: 'advert React', instructions: 'Write it.', language: 'en', market: 'dach' };

describe('skillSystemPrompt', () => {
  it("sends the whole SKILL.md by default, exactly as before 'by-task' existed", () => {
    expect(skillSystemPrompt(input, config)).toBe(skill);
    expect(skillSystemPrompt(input, { ...config, skillContext: 'full' })).toBe(skill);
  });

  it("gives the generator and the reviser the same selected text in 'by-task' mode", async () => {
    const judge = (relevance: number) =>
      JSON.stringify({ factualGrounding: 5, jobRelevance: relevance, professionalTone: 5, specificity: 5, naturalness: 5, overall: 5, hardGuardrailFailures: [] });
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Draft one' })
      .queueResponse({ text: judge(2) })
      .queueResponse({ text: 'Draft two' })
      .queueResponse({ text: judge(5) });

    await runProductionSkill(input, makeUniformRoles(provider), { ...config, skillContext: 'by-task' });

    const [generation, validation, revision] = provider.requests;
    const expected = selectSkillSections(skill, input).text;
    expect(generation.systemPrompt).toBe(expected);
    expect(revision.systemPrompt).toBe(expected);
    expect(generation.metadata?.components?.[0]).toEqual({ component: 'skill', chars: expected.length });
    // The validator never sees SKILL.md in either mode.
    expect(validation.systemPrompt).not.toContain('## Hard rules');
  });
});

describe('skillContextOption', () => {
  it('overrides only when given, and rejects an unknown value', () => {
    expect(skillContextOption(undefined)).toEqual({});
    expect(skillContextOption('by-task')).toEqual({ skillContext: 'by-task' });
    expect(() => skillContextOption('bytask')).toThrow(/must be "full" or "by-task"/);
  });
});
