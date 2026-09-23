import { describe, expect, it } from 'vitest';
import { hashObject, sha256 } from './hash';

describe('sha256', () => {
  it('is deterministic', () => {
    expect(sha256('hello')).toBe(sha256('hello'));
  });

  it('differs for different input', () => {
    expect(sha256('hello')).not.toBe(sha256('hello!'));
  });

  it('returns a 64-character hex digest', () => {
    expect(sha256('hello')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hashObject', () => {
  it('is independent of key order', () => {
    expect(hashObject({ a: 1, b: 2 })).toBe(hashObject({ b: 2, a: 1 }));
  });

  it('is independent of nested key order', () => {
    expect(hashObject({ a: { x: 1, y: 2 }, b: [1, 2] })).toBe(
      hashObject({ b: [1, 2], a: { y: 2, x: 1 } }),
    );
  });

  it('differs when a value differs', () => {
    expect(hashObject({ a: 1 })).not.toBe(hashObject({ a: 2 }));
  });

  it('treats arrays positionally, not as sets', () => {
    expect(hashObject([1, 2])).not.toBe(hashObject([2, 1]));
  });
});
