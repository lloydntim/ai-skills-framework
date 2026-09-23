/**
 * One place for SHA-256 hashing, so eval-run reproducibility metadata (and anything else that
 * needs a content fingerprint) never reimplements it slightly differently.
 */
import { createHash } from 'node:crypto';

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Sorts object keys recursively before stringifying, so two objects with the same data in a
 * different key order hash identically. Arrays are hashed positionally (not sorted): order in an
 * array is data, not incidental.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, sortKeysDeep((value as Record<string, unknown>)[key])] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

/**
 * Hashes a JSON-serialisable value, independent of key order. Values outside JSON's data model
 * (Date, Map, Set, undefined, circular references) are not supported: JSON.stringify would drop
 * or mangle them silently, which defeats the point of a fingerprint.
 */
export function hashObject(value: unknown): string {
  return sha256(JSON.stringify(sortKeysDeep(value)));
}
