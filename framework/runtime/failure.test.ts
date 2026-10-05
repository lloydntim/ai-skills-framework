import { describe, expect, it } from 'vitest';
import { LlmResponseValidationError } from '../llm-json-response';
import { classifyError, RuntimeFailure, summariseFailure } from './failure';

describe('classifyError', () => {
  it('leaves a RuntimeFailure as it is', () => {
    const original = new RuntimeFailure('BUDGET_EXCEEDED', 'stop');
    expect(classifyError(original, 'execute')).toBe(original);
  });

  it.each(['UnsupportedRuntimeConfigError', 'RoleRuntimeConfigError', 'ModelConfigError'])('treats %s as a configuration problem', (name) => {
    const err = Object.assign(new Error('x'), { name });
    expect(classifyError(err, 'execute').kind).toBe('CONFIGURATION_ERROR');
  });

  it('treats an empty model reply and an unparseable validator reply as MODEL_ERROR', () => {
    expect(classifyError(Object.assign(new Error('x'), { name: 'EmptyModelResponseError' }), 'execute').kind).toBe('MODEL_ERROR');
    expect(classifyError(new LlmResponseValidationError('Judge', [], '{}'), 'validate').kind).toBe('MODEL_ERROR');
  });

  it.each([
    [429, true], [500, true], [503, true], [408, true], [400, false], [401, false], [404, false],
  ])('treats HTTP status %s as retryable=%s', (status, retryable) => {
    const failure = classifyError(Object.assign(new Error('x'), { status }), 'model');
    expect(failure).toMatchObject({ kind: 'MODEL_ERROR', retryable });
  });

  it('treats a connection error as a retryable MODEL_ERROR', () => {
    const failure = classifyError(Object.assign(new Error('x'), { name: 'APIConnectionTimeoutError' }), 'model');
    expect(failure).toMatchObject({ kind: 'MODEL_ERROR', retryable: true });
  });

  it('reads an unknown error by where it happened', () => {
    expect(classifyError(new Error('x'), 'prepare').kind).toBe('CONTEXT_ERROR');
    expect(classifyError(new Error('x'), 'model').kind).toBe('MODEL_ERROR');
    for (const phase of ['execute', 'validate', 'revise'] as const) expect(classifyError(new Error('x'), phase).kind).toBe('EXECUTION_ERROR');
  });

  it('copies nothing from the cause into the message', () => {
    const failure = classifyError(new Error('the candidate is Ada Example, key sk-ant-abc123'), 'execute');
    expect(failure.message).not.toMatch(/Ada|sk-ant/);
    expect(JSON.stringify(summariseFailure(failure))).not.toMatch(/Ada|sk-ant/);
    expect(summariseFailure(failure).causeName).toBe('Error');
  });
});
