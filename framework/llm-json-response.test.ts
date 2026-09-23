import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LlmResponseValidationError, parseJsonResponse } from './llm-json-response';

const schema = z.object({
  score: z.number().int().min(1).max(5),
  label: z.enum(['A', 'B', 'tie']),
});

describe('parseJsonResponse', () => {
  it('returns a typed value for a valid, in-schema response', () => {
    const result = parseJsonResponse('{"score": 4, "label": "A"}', schema, 'Test judge');
    expect(result).toEqual({ score: 4, label: 'A' });
  });

  it('extracts the JSON block even when the model wraps it in prose', () => {
    const result = parseJsonResponse(
      'Sure, here is my assessment:\n{"score": 3, "label": "tie"}\nHope that helps!',
      schema,
      'Test judge',
    );
    expect(result).toEqual({ score: 3, label: 'tie' });
  });

  it('throws a plain error when the reply contains no JSON at all', () => {
    expect(() => parseJsonResponse('I think A is better.', schema, 'Test judge')).toThrow(/did not return JSON/);
  });

  it('throws a plain error for JSON that fails to parse', () => {
    expect(() => parseJsonResponse('{"score": 4,}', schema, 'Test judge')).toThrow(/invalid JSON/);
  });

  it('throws LlmResponseValidationError for a missing required field', () => {
    expect(() => parseJsonResponse('{"label": "A"}', schema, 'Test judge')).toThrow(LlmResponseValidationError);
  });

  it('throws LlmResponseValidationError for a value outside the declared range', () => {
    expect(() => parseJsonResponse('{"score": 9, "label": "A"}', schema, 'Test judge')).toThrow(
      LlmResponseValidationError,
    );
  });

  it('throws LlmResponseValidationError for a non-integer score, without rounding it', () => {
    expect(() => parseJsonResponse('{"score": 4.5, "label": "A"}', schema, 'Test judge')).toThrow(
      LlmResponseValidationError,
    );
  });

  it('throws LlmResponseValidationError for a value outside the declared enum', () => {
    expect(() => parseJsonResponse('{"score": 4, "label": "C"}', schema, 'Test judge')).toThrow(
      LlmResponseValidationError,
    );
  });

  it('throws LlmResponseValidationError for a field of the wrong type, without coercing it', () => {
    expect(() => parseJsonResponse('{"score": "4", "label": "A"}', schema, 'Test judge')).toThrow(
      LlmResponseValidationError,
    );
  });

  it('carries structured issues and the failing context on the thrown error', () => {
    try {
      parseJsonResponse('{"score": 9, "label": "A"}', schema, 'Test judge');
      expect.unreachable('expected parseJsonResponse to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(LlmResponseValidationError);
      const validationError = err as LlmResponseValidationError;
      expect(validationError.context).toBe('Test judge');
      expect(validationError.issues.length).toBeGreaterThan(0);
      expect(validationError.issues[0].path).toEqual(['score']);
      expect(validationError.message).toContain('Test judge');
    }
  });
});
