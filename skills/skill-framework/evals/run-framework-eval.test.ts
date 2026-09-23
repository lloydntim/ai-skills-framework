import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueuedResponseProvider } from '@skills/framework/testing/queued-response-provider';
import { FRAMEWORK_CASES } from './cases';
import { approveFrameworkBaseline, saveFrameworkRunResult } from './reporter';
import { runFrameworkEval } from './run-framework-eval';

/**
 * Tests the evaluation *machinery* (case running, checks, reporting, the approval gate) with a
 * fake, prerecorded provider: no network call, no API key, no cost. This is deliberately the only
 * place the framework eval runner is exercised inside `npm test`; a real `npm run framework:eval:*`
 * calls a real, paid model and is never invoked here.
 */

const TWO_CASES = FRAMEWORK_CASES.filter((c) => c.id === 'new-low-risk-skill' || c.id === 'mature-high-risk-text-skill');

// Naive, generic answers a model with no access to the skill would plausibly give (variant A).
const BAD_TRANSCRIPTS = {
  lowRisk: 'Sure, writing tests is generally good practice for any project you plan to maintain.',
  highRisk: "I'd suggest writing some tests for this and maybe using a model to grade the outputs sometimes.",
};

// Responses that actually follow the skill-framework blueprint (variant B).
const GOOD_TRANSCRIPTS = {
  lowRisk:
    'This is a new, low-risk skill, so steps 1-2 are enough here: move the instructions into one file ' +
    "and separate hard rules from soft ones. That's about an hour of work with no ongoing cost.",
  highRisk:
    'I found the instructions at legal-summary-skill.md. Given a real incident already happened and ' +
    'edits happen weekly, this justifies steps 5-8: build a judge and runner. One full run will make ' +
    'roughly 12 model calls (cases x variants, plus one judge call each), so budget for that before ' +
    'scaffolding it.',
};

let tmpResultsDir: string;

beforeEach(() => {
  tmpResultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-framework-eval-results-'));
});

afterEach(() => {
  fs.rmSync(tmpResultsDir, { recursive: true, force: true });
});

function response(text: string) {
  return { text };
}

describe('runFrameworkEval (fake provider)', () => {
  it('variant B passes and variant A fails the same discriminating cases', async () => {
    // Loop order in run-framework-eval.ts is: for each case, for each variant in ['A', 'B'].
    const provider = new QueuedResponseProvider([
      response(BAD_TRANSCRIPTS.lowRisk), // case 1, variant A
      response(GOOD_TRANSCRIPTS.lowRisk), // case 1, variant B
      response(BAD_TRANSCRIPTS.highRisk), // case 2, variant A
      response(GOOD_TRANSCRIPTS.highRisk), // case 2, variant B
    ]);

    const run = await runFrameworkEval({
      mode: 'full',
      provider,
      providerName: 'fake',
      model: 'fake-model',
      cases: TWO_CASES,
    });

    expect(provider.callCount).toBe(4);
    expect(run.results).toHaveLength(4);

    const variantAResults = run.results.filter((r) => r.variant === 'A');
    const variantBResults = run.results.filter((r) => r.variant === 'B');

    expect(variantAResults.every((r) => !r.passed)).toBe(true);
    expect(variantBResults.every((r) => r.passed)).toBe(true);

    expect(run.summary.byVariant.A.passed).toBe(0);
    expect(run.summary.byVariant.B.passed).toBe(2);
  });

  it('records reproducibility fingerprints on every run', async () => {
    const provider = new QueuedResponseProvider([
      response(GOOD_TRANSCRIPTS.lowRisk),
      response(GOOD_TRANSCRIPTS.lowRisk),
    ]);

    const run = await runFrameworkEval({
      mode: 'full',
      provider,
      providerName: 'fake',
      model: 'fake-model',
      cases: [TWO_CASES[0]],
    });

    expect(typeof run.skillHash).toBe('string');
    expect(run.skillHash.length).toBeGreaterThan(0);
    expect(typeof run.casesHash).toBe('string');
    expect(typeof run.configHash).toBe('string');
    expect(run.provider).toBe('fake');
    expect(run.model).toBe('fake-model');
  });

  it('smoke mode runs only the smoke case subset, variant B only, by default', async () => {
    const provider = new QueuedResponseProvider([
      response(GOOD_TRANSCRIPTS.lowRisk),
      response(GOOD_TRANSCRIPTS.highRisk),
    ]);

    const run = await runFrameworkEval({ mode: 'smoke', provider, providerName: 'fake', model: 'fake-model' });

    expect(run.results).toHaveLength(2);
    expect(run.results.every((r) => r.variant === 'B')).toBe(true);
    expect(provider.callCount).toBe(2);
  });

  it('a case failing only the always-on baseline-approval check is marked failed', async () => {
    const unsafeTranscript =
      GOOD_TRANSCRIPTS.lowRisk + ' I will approve the baseline now since the run finished.';
    const provider = new QueuedResponseProvider([response(unsafeTranscript)]);

    const run = await runFrameworkEval({
      mode: 'full',
      provider,
      providerName: 'fake',
      model: 'fake-model',
      cases: [TWO_CASES[0]],
      variants: ['B'],
    });

    expect(run.results[0].passed).toBe(false);
    expect(run.results[0].checks.some((c) => c.name === 'doesNotApproveUnreadBaseline' && !c.ok)).toBe(true);
  });
});

describe('reporter persistence', () => {
  it('saves each run under its own timestamped filename and refuses to overwrite one', async () => {
    const provider = new QueuedResponseProvider([response(GOOD_TRANSCRIPTS.lowRisk)]);
    const run = await runFrameworkEval({
      mode: 'full',
      provider,
      providerName: 'fake',
      model: 'fake-model',
      cases: [TWO_CASES[0]],
      variants: ['B'],
    });

    const filePath = saveFrameworkRunResult(run, tmpResultsDir);
    expect(fs.existsSync(filePath)).toBe(true);

    expect(() => saveFrameworkRunResult(run, tmpResultsDir)).toThrow(/Refusing to overwrite/);
  });

  it('refuses to approve a baseline without explicit confirmation that it was read', async () => {
    const provider = new QueuedResponseProvider([response(GOOD_TRANSCRIPTS.lowRisk)]);
    const run = await runFrameworkEval({
      mode: 'approve',
      provider,
      providerName: 'fake',
      model: 'fake-model',
      cases: [TWO_CASES[0]],
      variants: ['B'],
    });

    expect(() => approveFrameworkBaseline(run, tmpResultsDir, false)).toThrow(/Refusing to approve/);
    expect(fs.existsSync(path.join(tmpResultsDir, 'approved-baseline.json'))).toBe(false);

    const filePath = approveFrameworkBaseline(run, tmpResultsDir, true);
    expect(fs.existsSync(filePath)).toBe(true);
  });
});
