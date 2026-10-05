import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DeterministicCheckResult } from '../deterministic-checks';
import { createRuntime } from '@skills/framework/runtime/controller';
import { JsonlTraceSink, MemoryTraceSink } from '@skills/framework/runtime/trace';
import { makeUniformRoles } from '@skills/framework/testing/uniform-roles';
import { loadSkillPrompt } from '../skill-loader';
import { FakeModelProvider } from '../test-support/fake-model-provider';
import { runProductionSkill } from './index';
import { describeFailures } from './revise';
import { coverLetterSkill, SKILL_NAME, toDecision } from './skill';
import runtimeConfigJson from './runtime-config.json';
import type { CoverLetterTaskInput, RuntimeConfig, ValidationResult } from './types';

const config = runtimeConfigJson as RuntimeConfig;

const input: CoverLetterTaskInput = {
  cvText: 'NORTHWIND London | Frontend Architect. Stack: React, TypeScript. Led 12 engineers.',
  roleDescription: 'Senior Frontend Engineer at Acme. React, TypeScript.',
  instructions: 'Write a tailored cover letter.',
  language: 'en',
};

const judged = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ factualGrounding: 5, jobRelevance: 5, professionalTone: 5, specificity: 5, naturalness: 5, overall: 5, hardGuardrailFailures: [], ...overrides });

const cleanDeterministic = (overrides: Partial<DeterministicCheckResult> = {}): DeterministicCheckResult => ({
  pass: true,
  missingExactStrings: [],
  missingRequiredGroups: [],
  missingTerms: [],
  matchedForbiddenClaims: [],
  matchedForbiddenCharacters: [],
  unfilledPlaceholders: [],
  unsupportedTechnologies: [],
  unsupportedNumbers: [],
  missingLetterStructure: [],
  openingRestatesAdvert: [],
  phrasesWithoutCvSupport: [],
  usedStandardPhrases: [],
  untriggeredPhrases: [],
  usedPreferences: [],
  unofferedPreferences: [],
  wordCount: 100,
  wordCountOutOfRange: false,
  matchedCliches: [],
  repeatedSentenceOpeners: [],
  ...overrides,
});

const validation = (overrides: Partial<ValidationResult> = {}): ValidationResult => ({
  pass: false,
  deterministic: cleanDeterministic(),
  scores: { factualGrounding: 5, jobRelevance: 5, professionalTone: 5, specificity: 5, naturalness: 5, overall: 5 },
  hardGuardrailFailures: [],
  judgeHardGuardrailFailures: [],
  failingCriteria: [],
  ...overrides,
});

describe('toDecision', () => {
  it('passes a passing validation', () => {
    expect(toDecision(validation({ pass: true }))).toEqual({ status: 'pass' });
  });

  it.each([
    ['missingExactStrings', 'missing-exact-string'],
    ['missingRequiredGroups', 'missing-required-group'],
    ['missingTerms', 'missing-term'],
    ['matchedForbiddenClaims', 'forbidden-claim'],
    ['matchedForbiddenCharacters', 'forbidden-character'],
    ['unfilledPlaceholders', 'unfilled-placeholder'],
    ['unsupportedTechnologies', 'unsupported-technology'],
    ['unsupportedNumbers', 'unsupported-number'],
    ['phrasesWithoutCvSupport', 'phrase-without-cv-support'],
    ['unofferedPreferences', 'unoffered-preference'],
    ['missingLetterStructure', 'missing-letter-structure'],
  ] as const)('gives every %s entry the fixed code %s, from the deterministic layer', (field, code) => {
    const decision = toDecision(validation({ deterministic: cleanDeterministic({ pass: false, [field]: ['x'] }) }));
    expect(decision.status).toBe('revise');
    if (decision.status !== 'revise') return;
    expect(decision.issues.map((i) => [i.source, i.code])).toEqual([['deterministic', code]]);
  });

  it('orders deterministic issues, then the judge\'s guardrails, then failing score dimensions, and marks the last two semantic', () => {
    const decision = toDecision(
      validation({
        deterministic: cleanDeterministic({ pass: false, missingTerms: ['Northwind'], matchedForbiddenClaims: ['ten years'] }),
        judgeHardGuardrailFailures: ['overstates ownership'],
        failingCriteria: ['specificity', 'overall'],
      })
    );
    expect(decision.status).toBe('revise');
    if (decision.status !== 'revise') return;
    expect(decision.issues.map((i) => [i.source, i.code])).toEqual([
      ['deterministic', 'missing-term'],
      ['deterministic', 'forbidden-claim'],
      ['semantic', 'guardrail'],
      ['semantic', 'specificity'],
      ['semantic', 'overall'],
    ]);
  });

  it('gives the reviser\'s own wording as each issue\'s message, so the two can never describe a failure differently', () => {
    const v = validation({
      deterministic: cleanDeterministic({ pass: false, missingTerms: ['Northwind'], unsupportedNumbers: ['45'] }),
      judgeHardGuardrailFailures: ['overstates ownership'],
      failingCriteria: ['jobRelevance'],
    });
    const decision = toDecision(v);
    if (decision.status !== 'revise') throw new Error('expected revise');
    expect(decision.issues.map((i) => i.message)).toEqual(describeFailures(v));
  });

  it('never stops the run: every failure this skill can find is fixable by another draft', () => {
    expect(toDecision(validation({ failingCriteria: ['overall'] })).status).toBe('revise');
  });
});

describe('cover-letter-writer through the shared runtime', () => {
  it('generates, validates, revises and completes, with a trace of what happened and no text in it', async () => {
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Dear Acme — I led Northwind.', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, cost: 0.01 })
      .queueResponse({ text: judged({ hardGuardrailFailures: ['invents an employer called Zeta'] }), usage: { totalTokens: 100 }, cost: 0.005 })
      .queueResponse({ text: 'Dear Acme, I led Northwind.', usage: { totalTokens: 180 }, cost: 0.012 })
      .queueResponse({ text: judged(), usage: { totalTokens: 110 }, cost: 0.006 });
    const sink = new MemoryTraceSink();
    const runtime = createRuntime({ skills: [coverLetterSkill(config)], roles: makeUniformRoles(provider), traceSink: sink });

    const result = await runtime.execute({ skill: SKILL_NAME, input });

    expect(result).toMatchObject({ status: 'completed', output: 'Dear Acme, I led Northwind.' });
    expect(result.trace.states.map((s) => s.state)).toEqual([
      'INITIALISING', 'PREPARING', 'EXECUTING', 'VALIDATING', 'REVISING', 'VALIDATING', 'COMPLETED',
    ]);
    expect(result.trace.validationResults.map((v) => v.status)).toEqual(['revise', 'pass']);
    expect(result.trace.validationResults[0].issues).toEqual([
      { source: 'deterministic', code: 'forbidden-character' },
      { source: 'semantic', code: 'guardrail' },
    ]);
    expect(result.trace.modelCalls.map((c) => c.requestType)).toEqual(['initial-generation', 'semantic-validation', 'revision', 'revalidation']);
    expect(result.trace.cost).toBeCloseTo(0.033);
    expect(sink.traces).toHaveLength(1);

    const text = JSON.stringify(result.trace);
    for (const secret of ['NORTHWIND', 'Northwind', 'Acme', 'Zeta', 'Dear ', 'invents an employer']) expect(text).not.toContain(secret);
  });

  it('keeps each call\'s prompt-part sizes, as the skill has always reported them', async () => {
    const provider = new FakeModelProvider().queueResponse({ text: 'Draft.' }).queueResponse({ text: judged() });
    const result = await createRuntime({ skills: [coverLetterSkill(config)], roles: makeUniformRoles(provider) }).execute({ skill: SKILL_NAME, input });

    expect(result.trace.modelCalls[0].components?.map((c) => c.component)).toEqual(['skill', 'task-instructions', 'case-input']);
    expect(result.trace.modelCalls[0].components?.find((c) => c.component === 'case-input')?.chars).toBe(input.cvText.length + input.roleDescription.length);
  });

  it('fails with CONTEXT_ERROR before any model call when SKILL.md is missing, without the path in the trace', async () => {
    const provider = new FakeModelProvider();
    const missing = path.join(os.tmpdir(), 'no-such-dir', 'SKILL.md');
    const result = await createRuntime({ skills: [coverLetterSkill(config, missing)], roles: makeUniformRoles(provider) }).execute({ skill: SKILL_NAME, input });

    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'CONTEXT_ERROR' } });
    expect(JSON.stringify(result.trace)).not.toContain('no-such-dir');
    expect(provider.callCount).toBe(0);
  });

  it('honours a cost limit set for the run', async () => {
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Draft one.', usage: { totalTokens: 10 }, cost: 0.03 })
      .queueResponse({ text: judged({ jobRelevance: 1 }), usage: { totalTokens: 10 }, cost: 0.03 });
    const result = await createRuntime({ skills: [coverLetterSkill(config)], roles: makeUniformRoles(provider) }).execute({
      skill: SKILL_NAME,
      input,
      options: { settings: { budget: { maxCostUsd: 0.05 } } },
    });
    expect(result).toMatchObject({ status: 'failed', output: 'Draft one.', failure: { kind: 'BUDGET_EXCEEDED' } });
    expect(provider.callCount).toBe(2);
  });
});

// These pin what each call is shown (README, "What each call sees"). They describe behaviour that
// predates the runtime, so they were green as soon as they were written: they are regression
// cover for the migration, not a driver of new code.
describe('what each call is shown, through the runtime', () => {
  async function requestsFor() {
    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Draft — with a dash.' })
      .queueResponse({ text: judged({ hardGuardrailFailures: ['overstates ownership'] }) })
      .queueResponse({ text: 'Draft, revised.' })
      .queueResponse({ text: judged() });
    await runProductionSkill(input, makeUniformRoles(provider), config);
    return provider.requests;
  }

  it('sends the validator its own rubric and never SKILL.md, so it is not primed by the rules it checks', async () => {
    const [generation, validation] = await requestsFor();
    const skill = loadSkillPrompt();
    expect(generation.systemPrompt).toBe(skill);
    expect(validation.systemPrompt).not.toBe(skill);
    expect(validation.systemPrompt).not.toContain(skill.slice(0, 200));
  });

  it('holds the revision to the same system prompt the draft was written under', async () => {
    const [generation, , revision] = await requestsFor();
    expect(revision.systemPrompt).toBe(generation.systemPrompt);
  });

  it('tells the reviser the failures found and not the validator\'s raw reply', async () => {
    const [, , revision] = await requestsFor();
    expect(revision.userPrompt).toContain('- remove forbidden character: "—"');
    expect(revision.userPrompt).toContain('- overstates ownership');
    expect(revision.userPrompt).not.toContain('factualGrounding');
  });
});

// Stand-ins for what must never reach a trace. Assembled at run time: a key-shaped literal in source
// would (rightly) stop `pnpm export-skill`.
const NAME = 'Ada Examplesmith';
const EMAIL = 'ada.examplesmith@example.invalid';
const KEY = ['sk-ant', 'api03', 'EXAMPLEEXAMPLEEXAMPLE'].join('-');
const CV_LINE = 'Led the Zephyrquartz migration for 40 engineers at Fictional GmbH';
const PRIVATE_PATH = '/Users/someone/Projects/private-skills/reference/cv.md';
const LEAKY_INPUT: CoverLetterTaskInput = { ...input, cvText: `${NAME} <${EMAIL}>\n${CV_LINE}`, roleDescription: 'Senior Engineer at Zephyrquartz Ltd.' };
const SECRETS = [NAME, EMAIL, KEY, CV_LINE, PRIVATE_PATH, 'Zephyrquartz', loadSkillPrompt().slice(0, 200)];
const leaks = (value: unknown) => SECRETS.filter((secret) => JSON.stringify(value).includes(secret));

describe('the trace holds none of what the run was given or produced', () => {
  it('on a run that revises: input, drafts, prompts, and what the judge said and quoted', async () => {
    const provider = new FakeModelProvider()
      .queueResponse({ text: `Dear ${NAME}, ${CV_LINE} — ${EMAIL}`, cost: 0.01, usage: { totalTokens: 10 } })
      .queueResponse({ text: judged({ hardGuardrailFailures: [`${CV_LINE} is not in the CV, per ${NAME}`], jobRelevance: 1 }), cost: 0.01, usage: { totalTokens: 10 } })
      .queueResponse({ text: `Dear ${NAME}, revised`, cost: 0.01, usage: { totalTokens: 10 } })
      .queueResponse({ text: judged(), cost: 0.01, usage: { totalTokens: 10 } });
    const sink = new MemoryTraceSink();
    const result = await createRuntime({ skills: [coverLetterSkill(config)], roles: makeUniformRoles(provider), traceSink: sink }).execute({ skill: SKILL_NAME, input: LEAKY_INPUT });

    expect(result.status).toBe('completed');
    expect(JSON.stringify(result.output)).toContain(NAME); // the run carried it; the trace must not
    expect(provider.requests[0].userPrompt).toContain(EMAIL);
    expect(leaks(result.trace)).toEqual([]);
    expect(leaks(sink.traces)).toEqual([]);
    expect(result.trace.validationResults[0].issues.every((i) => /^[a-z][A-Za-z-]*$/.test(i.code))).toBe(true);
  });

  it('on failure: the message of a provider error, and the path of a missing skill file', async () => {
    const leaky = new FakeModelProvider().queueError(Object.assign(new Error(`401 invalid x-api-key ${KEY} for ${EMAIL}`), { status: 401 }));
    const providerFailure = await createRuntime({ skills: [coverLetterSkill(config)], roles: makeUniformRoles(leaky) }).execute({ skill: SKILL_NAME, input: LEAKY_INPUT });
    expect(providerFailure.trace.failure).toMatchObject({ kind: 'MODEL_ERROR', causeName: 'Error' });
    expect(leaks(providerFailure.trace)).toEqual([]);

    const missing = await createRuntime({ skills: [coverLetterSkill(config, PRIVATE_PATH)], roles: makeUniformRoles(new FakeModelProvider()) }).execute({ skill: SKILL_NAME, input: LEAKY_INPUT });
    expect(missing.trace.failure?.kind).toBe('CONTEXT_ERROR');
    expect(leaks(missing.trace)).toEqual([]);
  });

  it('in the file a sink writes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clw-privacy-'));
    const file = path.join(dir, 'runs.jsonl');
    const provider = new FakeModelProvider().queueResponse({ text: `${NAME} draft` }).queueResponse({ text: judged() });
    await runProductionSkill(LEAKY_INPUT, makeUniformRoles(provider), config, undefined, { traceSink: new JsonlTraceSink(file) });
    expect(leaks(fs.readFileSync(file, 'utf-8'))).toEqual([]);
    fs.rmSync(dir, { recursive: true });
  });
});

describe('runProductionSkill (the unchanged public entry point)', () => {
  it('returns the last draft and its failing validation, not an error, when revisions run out', async () => {
    const failing = judged({ jobRelevance: 1 });
    const provider = new FakeModelProvider().queueResponse({ text: 'd0' }).queueResponse({ text: failing }).queueResponse({ text: 'd1' }).queueResponse({ text: failing });
    const result = await runProductionSkill(input, makeUniformRoles(provider), { ...config, maxRevisionAttempts: 1 });
    expect(result).toMatchObject({ finalText: 'd1', revisionAttempts: 1, requestCount: 4, initialPass: false });
    expect(result.finalValidation.pass).toBe(false);
    expect(result.trace.finalStatus).toBe('failed');
    expect(result.trace.failure?.kind).toBe('VALIDATION_ERROR');
  });

  it('throws a provider\'s own error, as that same object', async () => {
    const original = new Error('provider down');
    const provider = new FakeModelProvider().queueError(original);
    await expect(runProductionSkill(input, makeUniformRoles(provider), config)).rejects.toBe(original);
  });

  it('writes a trace only when given a sink', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clw-'));
    const file = path.join(dir, 'runs.jsonl');
    const provider = () => new FakeModelProvider().queueResponse({ text: 'd0' }).queueResponse({ text: judged() });
    await runProductionSkill(input, makeUniformRoles(provider()), config);
    expect(fs.existsSync(file)).toBe(false);
    await runProductionSkill(input, makeUniformRoles(provider()), config, undefined, { traceSink: new JsonlTraceSink(file) });
    expect(fs.readFileSync(file, 'utf-8').trim().split('\n')).toHaveLength(1);
    fs.rmSync(dir, { recursive: true });
  });

  it('refuses more revisions than the runtime allows, before any model call', async () => {
    const provider = new FakeModelProvider();
    await expect(runProductionSkill(input, makeUniformRoles(provider), { ...config, maxRevisionAttempts: 500 })).rejects.toThrow(/ceiling/);
    expect(provider.callCount).toBe(0);
  });
});
