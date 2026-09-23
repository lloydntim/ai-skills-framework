import { describe, expect, it } from 'vitest';
import { InstrumentingProvider, RequestLog } from '@skills/framework/provider/instrumentation';
import { QueuedResponseProvider } from '@skills/framework/testing/queued-response-provider';
import { makeUniformRoles } from '@skills/framework/testing/uniform-roles';
import { generateDraft } from './generate';
import { runProductionSkill } from './index';
import { reviseDraft } from './revise';
import type { CvTaskInput, RuntimeConfig, ValidationResult } from './types';
import { validateDraft } from './validator';

/**
 * Confirms the metadata each production call site attaches actually reaches an instrumenting
 * wrapper correctly, end to end — the unit tests for generate/revise/validate assert other things
 * and do not inspect metadata, and the aggregation tests use synthetic entries rather than the real
 * call sites. No API calls: everything runs through QueuedResponseProvider.
 */

const config: RuntimeConfig = {
  temperature: 0.3,
  maxOutputTokens: 4000,
  maxRevisionAttempts: 5,
  maxLengthRatio: 100,
  forbiddenCharacters: ['—', '–'],
  thresholds: { faithfulness: 5, unsupportedClaims: 0, naturalness: 4, cvQuality: 4, terminology: 4 },
};

const input: CvTaskInput = {
  sourceLanguage: 'de',
  targetLanguage: 'en',
  input: 'Kurzer Lebenslaufabschnitt.',
  instructions: 'Translate faithfully.',
};

function validationJson(overrides: Partial<{ faithfulness: number }> = {}) {
  return JSON.stringify({
    faithfulness: 5,
    naturalness: 5,
    cvQuality: 5,
    terminology: 5,
    unsupportedClaims: [],
    hardGuardrailFailures: [],
    ...overrides,
  });
}

describe('generateDraft', () => {
  it('tags a skill-mode call as initial-generation, with the skill component recorded', async () => {
    const inner = new QueuedResponseProvider([{ text: 'draft' }]);
    const log = new RequestLog();
    await generateDraft(input, new InstrumentingProvider(inner, log), 'fake-model', config, 'skill');

    expect(log.entries).toHaveLength(1);
    expect(log.entries[0].requestType).toBe('initial-generation');
    expect(log.entries[0].components?.map((c) => c.component)).toEqual(['skill', 'task-instructions', 'case-input']);
  });

  it('tags a baseline-mode call with the baseline-prompt component instead of skill', async () => {
    const inner = new QueuedResponseProvider([{ text: 'draft' }]);
    const log = new RequestLog();
    await generateDraft(input, new InstrumentingProvider(inner, log), 'fake-model', config, 'baseline');

    expect(log.entries[0].components?.[0].component).toBe('baseline-prompt');
  });
});

describe('reviseDraft', () => {
  it('tags the call as revision, with the previous output recorded as a component', async () => {
    const validation: ValidationResult = {
      pass: false,
      hardGuardrailFailures: ['missing required exact string: "Northwind Labs"'],
      scores: { faithfulness: 5, naturalness: 5, cvQuality: 5, terminology: 5 },
      unsupportedClaims: [],
      failingCriteria: [],
    };
    const inner = new QueuedResponseProvider([{ text: 'revised draft' }]);
    const log = new RequestLog();
    await reviseDraft(input, 'previous draft text', validation, new InstrumentingProvider(inner, log), 'fake-model', config);

    expect(log.entries[0].requestType).toBe('revision');
    const components = log.entries[0].components!;
    expect(components.find((c) => c.component === 'previous-output')?.chars).toBe('previous draft text'.length);
  });
});

describe('validateDraft', () => {
  it('defaults to semantic-validation when the caller does not say otherwise', async () => {
    const inner = new QueuedResponseProvider([{ text: validationJson() }]);
    const log = new RequestLog();
    await validateDraft(input, 'a draft', new InstrumentingProvider(inner, log), 'fake-model', config);

    expect(log.entries[0].requestType).toBe('semantic-validation');
  });

  it('tags a revalidation call distinctly when the caller says so', async () => {
    const inner = new QueuedResponseProvider([{ text: validationJson() }]);
    const log = new RequestLog();
    await validateDraft(input, 'a draft', new InstrumentingProvider(inner, log), 'fake-model', config, 'revalidation');

    expect(log.entries[0].requestType).toBe('revalidation');
  });

  it('records the validation rubric as a component', async () => {
    const inner = new QueuedResponseProvider([{ text: validationJson() }]);
    const log = new RequestLog();
    await validateDraft(input, 'a draft', new InstrumentingProvider(inner, log), 'fake-model', config);

    expect(log.entries[0].components?.some((c) => c.component === 'validation-rubric')).toBe(true);
  });
});

describe('runProductionSkill', () => {
  it('tags the first validation as semantic-validation and a later one as revalidation', async () => {
    const failingJson = validationJson({ faithfulness: 1 });
    const passingJson = validationJson();
    const inner = new QueuedResponseProvider([
      { text: 'first draft' }, // generate
      { text: failingJson }, // validate: fails
      { text: 'revised draft' }, // revise
      { text: passingJson }, // validate again: passes
    ]);
    const log = new RequestLog();
    const provider = new InstrumentingProvider(inner, log);
    const roles = makeUniformRoles(provider);

    await runProductionSkill(input, roles, config);

    const validationCalls = log.entries.filter(
      (e) => e.requestType === 'semantic-validation' || e.requestType === 'revalidation'
    );
    expect(validationCalls.map((e) => e.requestType)).toEqual(['semantic-validation', 'revalidation']);
  });
});
