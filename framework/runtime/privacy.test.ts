import { describe, expect, it } from 'vitest';
import type { ModelProvider } from '../provider/types';
import { QueuedResponseProvider } from '../testing/queued-response-provider';
import { scriptedSkill } from '../testing/scripted-skill';
import { makeUniformRoles } from '../testing/uniform-roles';
import { createRuntime } from './controller';
import { JsonlTraceSink, MemoryTraceSink } from './trace';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Stand-ins for what must never reach a trace: a person's details, a key, text a validator quoted.
const NAME = 'Ada Examplesmith';
const EMAIL = 'ada.examplesmith@example.invalid';
// Assembled at run time: a key-shaped literal in source would (rightly) stop `pnpm export-skill`.
const KEY = ['sk-ant', 'api03', 'EXAMPLEEXAMPLEEXAMPLE'].join('-');
const CV_LINE = 'Led the Zephyrquartz migration for 40 engineers at Fictional GmbH';
const PRIVATE_PATH = '/Users/someone/Projects/private-skills/reference/cv.md';
const SECRETS = [NAME, EMAIL, KEY, CV_LINE, PRIVATE_PATH, 'Zephyrquartz'];

const leaks = (value: unknown) => SECRETS.filter((s) => JSON.stringify(value).includes(s));

describe('traces hold no text from the run', () => {
  const input = `${NAME} <${EMAIL}>\n${CV_LINE}`;

  it('leaves out input, drafts, validator messages, issue codes that are prose, and tool results', async () => {
    const sink = new MemoryTraceSink();
    const skill = scriptedSkill({
      tools: { required: ['docs.read'] },
      generate: async (step) => {
        await step.tools.call('docs.read', () => `${PRIVATE_PATH} says ${CV_LINE}`);
        const r = await step.roles.generator.provider.generate({ userPrompt: step.input, model: step.roles.generator.model });
        return r.text;
      },
      validate: async () => ({
        detail: CV_LINE,
        decision: {
          status: 'revise',
          issues: [{ source: 'semantic', code: `unsupported claim: "${CV_LINE}"`, message: `${NAME} never did this` }],
        },
      }),
      revise: async () => `${NAME} revised draft`,
    });
    const provider = new QueuedResponseProvider([{ text: `Draft for ${NAME}, ${EMAIL}`, cost: 0.01, usage: { totalTokens: 10 } }]);
    const runtime = createRuntime({
      skills: [skill],
      roles: makeUniformRoles(provider),
      toolPolicy: { allow: ['docs.read'] },
      traceSink: sink,
    });

    const result = await runtime.execute({ skill: 'scripted', input, options: { settings: { execution: { maxRevisions: 1 } } } });

    expect(result.status).toBe('failed'); // the fake validator never passes, so this also covers the failure path
    expect(leaks(result.trace)).toEqual([]);
    expect(leaks(sink.traces)).toEqual([]);
    expect(result.trace.validationResults[0].issues).toEqual([{ source: 'semantic', code: 'unspecified' }]);
    // The run itself did carry the text, so the trace is what is being kept clean, not the whole result.
    expect(JSON.stringify(result.output)).toContain(NAME);
  });

  it('leaves out the message of an error thrown by a provider or by skill code', async () => {
    const leaky: ModelProvider = {
      generate: async () => {
        throw Object.assign(new Error(`401 invalid x-api-key ${KEY} for ${EMAIL}`), { status: 401 });
      },
    };
    const providerFailure = await createRuntime({ skills: [scriptedSkill()], roles: makeUniformRoles(leaky) }).execute({
      skill: 'scripted',
      input,
    });
    expect(providerFailure.status).toBe('failed');
    expect(leaks(providerFailure.trace)).toEqual([]);
    expect(providerFailure.trace.failure).toMatchObject({ kind: 'MODEL_ERROR', causeName: 'Error' });

    const skillFailure = await createRuntime({
      skills: [scriptedSkill({ generate: async () => { throw new Error(`could not read ${PRIVATE_PATH}: ${CV_LINE}`); } })],
      roles: makeUniformRoles(new QueuedResponseProvider([])),
    }).execute({ skill: 'scripted', input });
    expect(leaks(skillFailure.trace)).toEqual([]);

    const prepareFailure = await createRuntime({
      skills: [scriptedSkill({ prepare: () => { throw new Error(`ENOENT ${PRIVATE_PATH}`); } })],
      roles: makeUniformRoles(new QueuedResponseProvider([])),
    }).execute({ skill: 'scripted', input });
    expect(prepareFailure.trace.failure?.kind).toBe('CONTEXT_ERROR');
    expect(leaks(prepareFailure.trace)).toEqual([]);
  });

  it('does not put the request\'s own text in the call record, only character counts', async () => {
    const provider = new QueuedResponseProvider([{ text: 'd' }, { text: 'PASS' }]);
    const runtime = createRuntime({ skills: [scriptedSkill()], roles: makeUniformRoles(provider) });
    const result = await runtime.execute({ skill: 'scripted', input });
    expect(leaks(result.trace)).toEqual([]);
    expect(provider.requests[0].userPrompt).toContain(NAME); // the model saw it; the trace did not
  });

  it('has exactly the fields it is documented to have, so a new one is a deliberate change', async () => {
    const provider = new QueuedResponseProvider([{ text: 'd' }, { text: 'PASS' }]);
    const { trace } = await createRuntime({ skills: [scriptedSkill()], roles: makeUniformRoles(provider) }).execute({ skill: 'scripted', input });
    expect(Object.keys(trace).sort()).toEqual(
      ['attempts', 'cost', 'failure', 'finalStatus', 'finishedAt', 'modelCalls', 'models', 'runId', 'settings', 'skill', 'startedAt', 'states', 'toolCalls', 'tokenUsage', 'validationResults'].sort()
    );
    const allowedCallFields = ['components', 'cost', 'failureKind', 'latencyMs', 'model', 'ok', 'provider', 'requestType', 'role', 'usage', 'usedFallback'];
    for (const call of trace.modelCalls) expect(allowedCallFields).toEqual(expect.arrayContaining(Object.keys(call)));
  });

  it('writes a file that contains none of it either', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-privacy-'));
    const file = path.join(dir, 'runs.jsonl');
    const runtime = createRuntime({
      skills: [scriptedSkill()],
      roles: makeUniformRoles(new QueuedResponseProvider([{ text: `${NAME} draft` }, { text: `${CV_LINE}` }, { text: 'r' }, { text: 'PASS' }])),
      traceSink: new JsonlTraceSink(file),
    });
    await runtime.execute({ skill: 'scripted', input });
    const written = fs.readFileSync(file, 'utf-8');
    expect(SECRETS.filter((s) => written.includes(s))).toEqual([]);
    fs.rmSync(dir, { recursive: true });
  });
});
