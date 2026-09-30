import { describe, expect, it } from 'vitest';
import { QueuedResponseProvider } from '../testing/queued-response-provider';
import { scriptedSkill } from '../testing/scripted-skill';
import { makeUniformRoles } from '../testing/uniform-roles';
import { createRuntime } from './controller';
import { settle } from './result';

function run(responses: Array<{ text: string }>, options = {}, skill = scriptedSkill()) {
  const runtime = createRuntime({ skills: [skill], roles: makeUniformRoles(new QueuedResponseProvider(responses)) });
  return runtime.execute<string, string>({ skill: 'scripted', input: 'x', options });
}

describe('settle', () => {
  it('hands back the draft, the skill\'s own validation result and the trace for a completed run', async () => {
    const result = await run([{ text: 'draft' }, { text: 'PASS' }]);
    const settled = settle(result);
    expect(settled).toEqual({ output: 'draft', detail: 'PASS', trace: result.trace });
  });

  it('treats running out of revisions as an outcome: the last draft and its failing validation come back, not an error', async () => {
    const result = await run([{ text: 'd0' }, { text: 'no' }, { text: 'd1' }, { text: 'still no' }], { settings: { execution: { maxRevisions: 1 } } });
    expect(result.status).toBe('failed');
    expect(settle(result)).toMatchObject({ output: 'd1', detail: 'still no' });
    expect(settle(result).trace.failure?.kind).toBe('VALIDATION_ERROR'); // the trace still says it failed
  });

  it('rethrows the error a provider threw, as that same object, for any other failure', async () => {
    const original = new Error('provider down');
    const runtime = createRuntime({ skills: [scriptedSkill()], roles: makeUniformRoles({ generate: async () => { throw original; } }) });
    const result = await runtime.execute<string>({ skill: 'scripted', input: 'x' });
    expect(() => settle(result)).toThrow(original);
    try {
      settle(result);
    } catch (err) {
      expect(err).toBe(original);
    }
  });

  it('rethrows the runtime\'s own failure when there was no underlying error, such as a budget stop', async () => {
    const result = await run([{ text: 'd0' }], { settings: { budget: { maxTokens: 1 } } });
    expect(() => settle(result)).toThrow(/Budget/);
  });

  it('does not return a draft that never reached validation as if it had been validated', async () => {
    const result = await run([{ text: 'd0' }], { settings: { budget: { maxTokens: 1 } } });
    expect(result.output).toBe('d0');
    expect(() => settle(result)).toThrow();
  });
});
