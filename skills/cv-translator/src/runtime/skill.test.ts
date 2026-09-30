import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EmptyModelResponseError } from '@skills/framework/provider/anthropic-provider';
import { createRuntime } from '@skills/framework/runtime/controller';
import { JsonlTraceSink, MemoryTraceSink } from '@skills/framework/runtime/trace';
import { QueuedResponseProvider } from '@skills/framework/testing/queued-response-provider';
import { makeUniformRoles } from '@skills/framework/testing/uniform-roles';
import { runProductionSkill } from './index';
import { cvTranslatorSkill, SKILL_NAME, toDecision } from './skill';
import type { GuardrailSources } from './validator';
import runtimeConfigJson from './runtime-config.json';
import type { CvTaskInput, RuntimeConfig, ValidationResult } from './types';

const config = { ...(runtimeConfigJson as RuntimeConfig), maxLengthRatio: 100 };

const input: CvTaskInput = {
  sourceLanguage: 'de',
  targetLanguage: 'en',
  input: 'Leitete die Migration für 40 Ingenieure bei Fiktiv GmbH.',
  instructions: 'Translate faithfully.',
};

const judged = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ faithfulness: 5, naturalness: 5, cvQuality: 5, terminology: 5, unsupportedClaims: [], hardGuardrailFailures: [], ...overrides });

const validation = (overrides: Partial<ValidationResult>): ValidationResult => ({
  pass: false,
  hardGuardrailFailures: [],
  scores: { faithfulness: 5, naturalness: 5, cvQuality: 5, terminology: 5 },
  unsupportedClaims: [],
  failingCriteria: [],
  ...overrides,
});

const sources = (overrides: Partial<GuardrailSources> = {}): GuardrailSources => ({ deterministic: [], judge: [], ...overrides });

describe('toDecision', () => {
  it('passes a passing validation', () => {
    expect(toDecision(validation({ pass: true }), sources())).toEqual({ status: 'pass' });
  });

  it('asks for a revision, telling deterministic rules from the judge, and criteria from guardrails', () => {
    const decision = toDecision(
      validation({
        hardGuardrailFailures: ['missing required term: "Northwind"', 'invented employer'],
        failingCriteria: ['faithfulness', 'length', 'repetition'],
      }),
      sources({ deterministic: ['missing required term: "Northwind"'], judge: ['invented employer'] })
    );
    expect(decision.status).toBe('revise');
    if (decision.status !== 'revise') return;
    expect(decision.issues.map((i) => [i.source, i.code])).toEqual([
      ['deterministic', 'guardrail'],
      ['semantic', 'guardrail'],
      ['semantic', 'faithfulness'],
      ['deterministic', 'length'],
      ['deterministic', 'repetition'],
    ]);
  });
});

describe('the domain result carries no tracing concern', () => {
  it('has no per-layer provenance field; the trace still tells the layers apart', async () => {
    const provider = new QueuedResponseProvider([
      { text: 'Draft with a — dash.' },
      { text: judged({ hardGuardrailFailures: ['invented employer'] }) },
      { text: 'Draft without.' },
      { text: judged() },
    ]);
    const result = await createRuntime({ skills: [cvTranslatorSkill(config)], roles: makeUniformRoles(provider) }).execute<CvTaskInput, ValidationResult>({ skill: SKILL_NAME, input });

    expect(Object.keys(result.detail ?? {})).not.toContain('judgeHardGuardrailFailures');
    expect(result.trace.validationResults[0].issues).toEqual([
      { source: 'deterministic', code: 'guardrail' },
      { source: 'semantic', code: 'guardrail' },
    ]);
  });
});

describe('cv-translator through the shared runtime', () => {
  it('generates, validates, revises and completes, with a trace of what happened', async () => {
    const provider = new QueuedResponseProvider([
      { text: 'Draft one.', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, cost: 0.01 },
      { text: judged({ faithfulness: 1 }), usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 }, cost: 0.005 },
      { text: 'Draft two.', usage: { inputTokens: 120, outputTokens: 60, totalTokens: 180 }, cost: 0.012 },
      { text: judged(), usage: { inputTokens: 85, outputTokens: 25, totalTokens: 110 }, cost: 0.006 },
    ]);
    const sink = new MemoryTraceSink();
    const runtime = createRuntime({ skills: [cvTranslatorSkill(config)], roles: makeUniformRoles(provider), traceSink: sink });

    const result = await runtime.execute({ skill: SKILL_NAME, input });

    expect(result).toMatchObject({ status: 'completed', output: 'Draft two.' });
    expect(result.trace.states.map((s) => s.state)).toEqual([
      'INITIALISING', 'PREPARING', 'EXECUTING', 'VALIDATING', 'REVISING', 'VALIDATING', 'COMPLETED',
    ]);
    expect(result.trace.validationResults.map((v) => v.status)).toEqual(['revise', 'pass']);
    expect(result.trace.validationResults[0].issues).toEqual([{ source: 'semantic', code: 'faithfulness' }]);
    expect(result.trace.modelCalls.map((c) => c.requestType)).toEqual(['initial-generation', 'semantic-validation', 'revision', 'revalidation']);
    expect(result.trace.cost).toBeCloseTo(0.033);
    expect(sink.traces).toHaveLength(1);
  });

  it('keeps each call\'s prompt-part sizes on the trace, and none of the text', async () => {
    const provider = new QueuedResponseProvider([{ text: 'Draft one.' }, { text: judged() }]);
    const result = await createRuntime({ skills: [cvTranslatorSkill(config)], roles: makeUniformRoles(provider) }).execute({ skill: SKILL_NAME, input });

    const generation = result.trace.modelCalls[0];
    expect(generation.components?.map((c) => c.component)).toEqual(['skill', 'task-instructions', 'case-input']);
    expect(generation.components?.find((c) => c.component === 'case-input')?.chars).toBe(input.input.length);
    expect(JSON.stringify(result.trace)).not.toContain('Fiktiv');
    expect(JSON.stringify(result.trace)).not.toContain('Draft one');
  });

  it('fails with CONTEXT_ERROR before any model call when SKILL.md is missing', async () => {
    const provider = new QueuedResponseProvider([]);
    const missing = path.join(os.tmpdir(), 'no-such-dir', 'SKILL.md');
    const result = await createRuntime({ skills: [cvTranslatorSkill(config, missing)], roles: makeUniformRoles(provider) }).execute({ skill: SKILL_NAME, input });

    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'CONTEXT_ERROR' } });
    expect(JSON.stringify(result.trace)).not.toContain('no-such-dir'); // the private path stays out of the trace
    expect(provider.callCount).toBe(0);
  });

  it('honours a cost limit set for the run', async () => {
    const provider = new QueuedResponseProvider([
      { text: 'Draft one.', usage: { totalTokens: 10 }, cost: 0.03 },
      { text: judged({ faithfulness: 1 }), usage: { totalTokens: 10 }, cost: 0.03 },
    ]);
    const result = await createRuntime({ skills: [cvTranslatorSkill(config)], roles: makeUniformRoles(provider) }).execute({
      skill: SKILL_NAME,
      input,
      options: { settings: { budget: { maxCostUsd: 0.05 } } },
    });
    expect(result).toMatchObject({ status: 'failed', output: 'Draft one.', failure: { kind: 'BUDGET_EXCEEDED' } });
    expect(provider.callCount).toBe(2);
  });
});

describe('runProductionSkill (the unchanged public entry point)', () => {
  it('returns the last draft, not an error, when revisions run out', async () => {
    const failing = judged({ faithfulness: 1 });
    const provider = new QueuedResponseProvider([{ text: 'd0' }, { text: failing }, { text: 'd1' }, { text: failing }]);
    const result = await runProductionSkill(input, makeUniformRoles(provider), { ...config, maxRevisionAttempts: 1 });
    expect(result).toMatchObject({ finalText: 'd1', revisionAttempts: 1, requestCount: 4 });
    expect(result.validation.pass).toBe(false);
    expect(result.trace.finalStatus).toBe('failed');
    expect(result.trace.failure?.kind).toBe('VALIDATION_ERROR');
  });

  it('throws a provider\'s own error, as before', async () => {
    const original = new Error('provider down');
    const roles = makeUniformRoles({ generate: async () => { throw original; } });
    await expect(runProductionSkill(input, roles, config)).rejects.toBe(original);
  });

  // Recorded against the pre-runtime implementation: an empty draft that never validates came back
  // as "" with pass=false, it was not thrown. A model that produces no text at all is the provider's
  // own error (EmptyModelResponseError), which is thrown as itself. Both must stay as they were.
  it('returns an empty last draft that fails validation, as before, rather than throwing', async () => {
    const failing = judged({ faithfulness: 1 });
    const provider = new QueuedResponseProvider([{ text: 'd0' }, { text: failing }, { text: '' }, { text: failing }]);
    const result = await runProductionSkill(input, makeUniformRoles(provider), { ...config, maxRevisionAttempts: 1 });
    expect(result).toMatchObject({ finalText: '', revisionAttempts: 1, requestCount: 4 });
    expect(result.validation.pass).toBe(false);

    const neverRevised = new QueuedResponseProvider([{ text: '' }, { text: failing }]);
    const capZero = await runProductionSkill(input, makeUniformRoles(neverRevised), { ...config, maxRevisionAttempts: 0 });
    expect(capZero).toMatchObject({ finalText: '', revisionAttempts: 0, requestCount: 2 });
    expect(capZero.validation.pass).toBe(false);
  });

  it('throws the provider\'s own EmptyModelResponseError when a call produced no text', async () => {
    const original = new EmptyModelResponseError('no text');
    const roles = makeUniformRoles({ generate: async () => { throw original; } });
    await expect(runProductionSkill(input, roles, config)).rejects.toBe(original);
  });

  it('writes a trace only when given a sink', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cvt-'));
    const file = path.join(dir, 'runs.jsonl');
    const provider = () => new QueuedResponseProvider([{ text: 'd0' }, { text: judged() }]);
    await runProductionSkill(input, makeUniformRoles(provider()), config);
    expect(fs.existsSync(file)).toBe(false);
    await runProductionSkill(input, makeUniformRoles(provider()), config, undefined, { traceSink: new JsonlTraceSink(file) });
    expect(fs.readFileSync(file, 'utf-8').trim().split('\n')).toHaveLength(1);
    fs.rmSync(dir, { recursive: true });
  });
});
