import { describe, expect, it } from 'vitest';
import { QueuedResponseProvider } from '../testing/queued-response-provider';
import { makeUniformRoles } from '../testing/uniform-roles';
import { InstrumentingProvider, RequestLog, instrumentRoles } from './instrumentation';
import { MODEL_ROLES } from './model-roles';

describe('InstrumentingProvider', () => {
  it('passes the request and result through unchanged', async () => {
    const inner = new QueuedResponseProvider([{ text: 'the actual output', usage: { totalTokens: 123 } }]);
    const log = new RequestLog();
    const wrapped = new InstrumentingProvider(inner, log);

    const result = await wrapped.generate({
      systemPrompt: 'sys',
      userPrompt: 'user',
      model: 'fake-model',
      metadata: { requestType: 'initial-generation' },
    });

    expect(result.text).toBe('the actual output');
    expect(result.usage?.totalTokens).toBe(123);
    expect(inner.requests[0]).toMatchObject({ systemPrompt: 'sys', userPrompt: 'user', model: 'fake-model' });
  });

  it('records the request type and usage from the call', async () => {
    const inner = new QueuedResponseProvider([{ text: 'x', usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 } }]);
    const log = new RequestLog();
    const wrapped = new InstrumentingProvider(inner, log);

    await wrapped.generate({ userPrompt: 'u', model: 'm', metadata: { requestType: 'evaluator' } });

    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]).toMatchObject({ requestType: 'evaluator', usage: { totalTokens: 100 } });
  });

  it('records unclassified for a request with no metadata, rather than dropping it', async () => {
    const inner = new QueuedResponseProvider([{ text: 'x' }]);
    const log = new RequestLog();
    const wrapped = new InstrumentingProvider(inner, log);

    await wrapped.generate({ userPrompt: 'u', model: 'm' });

    expect(log.entries[0].requestType).toBe('unclassified');
  });

  it('carries prompt component sizes through to the log', async () => {
    const inner = new QueuedResponseProvider([{ text: 'x' }]);
    const log = new RequestLog();
    const wrapped = new InstrumentingProvider(inner, log);

    await wrapped.generate({
      userPrompt: 'u',
      model: 'm',
      metadata: { requestType: 'revision', components: [{ component: 'skill', chars: 500 }] },
    });

    expect(log.entries[0].components).toEqual([{ component: 'skill', chars: 500 }]);
  });

  it('attributes recorded entries to whatever case is current at record time', async () => {
    const inner = new QueuedResponseProvider([{ text: 'a' }, { text: 'b' }, { text: 'c' }]);
    const log = new RequestLog();
    const wrapped = new InstrumentingProvider(inner, log);

    log.setCurrentCase('golden-001');
    await wrapped.generate({ userPrompt: 'u', model: 'm', metadata: { requestType: 'initial-generation' } });
    log.setCurrentCase('golden-002');
    await wrapped.generate({ userPrompt: 'u', model: 'm', metadata: { requestType: 'initial-generation' } });
    log.setCurrentCase(undefined);
    await wrapped.generate({ userPrompt: 'u', model: 'm', metadata: { requestType: 'evaluator' } });

    expect(log.entries.map((e) => e.caseId)).toEqual(['golden-001', 'golden-002', undefined]);
  });
});

describe('RequestLog', () => {
  it('clears all recorded entries', () => {
    const log = new RequestLog();
    log.record({ requestType: 'evaluator' });
    expect(log.entries).toHaveLength(1);

    log.clear();
    expect(log.entries).toHaveLength(0);
  });

  it('records exactly the entry passed to it, with the current case id attached', () => {
    const log = new RequestLog();
    log.setCurrentCase('golden-001');
    log.record({ requestType: 'evaluator', usage: { totalTokens: 100 } });

    expect(log.entries[0]).toEqual({ requestType: 'evaluator', usage: { totalTokens: 100 }, caseId: 'golden-001' });
  });
});

describe('instrumentRoles', () => {
  it('wraps every role and shares one RequestLog across all of them', async () => {
    const inner = new QueuedResponseProvider([{ text: 'a' }, { text: 'b' }]);
    const roles = makeUniformRoles(inner);
    const log = new RequestLog();
    const instrumented = instrumentRoles(roles, log);

    await instrumented.generator.provider.generate({ userPrompt: 'u', model: 'm', metadata: { requestType: 'initial-generation' } });
    await instrumented.evaluator.provider.generate({ userPrompt: 'u', model: 'm', metadata: { requestType: 'evaluator' } });

    expect(log.entries.map((e) => e.requestType)).toEqual(['initial-generation', 'evaluator']);
  });

  it('leaves each role\'s model and provider name untouched', () => {
    const inner = new QueuedResponseProvider([]);
    const roles = makeUniformRoles(inner, 'claude-sonnet-5', 'anthropic');
    const instrumented = instrumentRoles(roles, new RequestLog());

    for (const role of MODEL_ROLES) {
      expect(instrumented[role].model).toBe('claude-sonnet-5');
      expect(instrumented[role].providerName).toBe('anthropic');
    }
  });

  it('does not mutate the roles object passed in', () => {
    const inner = new QueuedResponseProvider([]);
    const roles = makeUniformRoles(inner);
    const originalProvider = roles.generator.provider;

    instrumentRoles(roles, new RequestLog());

    expect(roles.generator.provider).toBe(originalProvider);
  });
});
