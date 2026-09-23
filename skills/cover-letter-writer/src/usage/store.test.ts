import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordUsage } from './store';

let dir: string;
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-store-'));
  process.env.MODEL_USAGE_DIR = dir;
  delete process.env.MODEL_RUN_ID;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  fs.rmSync(dir, { recursive: true, force: true });
});

function readDayFile(): string[] {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  expect(files).toHaveLength(1);
  return fs
    .readFileSync(path.join(dir, files[0]), 'utf-8')
    .trim()
    .split('\n');
}

describe('recordUsage', () => {
  it('appends one JSON line per call to a UTC-day file under MODEL_USAGE_DIR', () => {
    recordUsage({ source: 'writer', tool: 'initial-generation', provider: 'anthropic', model: 'claude-sonnet-5', status: 'success' });
    recordUsage({ source: 'writer', tool: 'initial-generation', provider: 'anthropic', model: 'claude-sonnet-5', status: 'success' });

    const lines = readDayFile();
    expect(lines).toHaveLength(2);
    const files = fs.readdirSync(dir);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.jsonl$/);
  });

  it('fills in attemptId, timestamp, and a null runId when none is set', () => {
    const record = recordUsage({ source: 'writer', tool: 'evaluator', provider: 'anthropic', model: 'claude-opus-5', status: 'success' });

    expect(record.attemptId).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.runId).toBeNull();
    expect(new Date(record.timestamp).toISOString()).toBe(record.timestamp);
  });

  it('reads the parent run ID from MODEL_RUN_ID when set', () => {
    process.env.MODEL_RUN_ID = 'run-123';

    const record = recordUsage({ source: 'writer', tool: 'evaluator', provider: 'anthropic', model: 'claude-opus-5', status: 'success' });

    expect(record.runId).toBe('run-123');
  });

  it('marks usage unavailable rather than zero when none is given', () => {
    const record = recordUsage({ source: 'writer', tool: 'evaluator', provider: 'anthropic', model: 'claude-opus-5', status: 'success' });

    expect(record.usage).toBeUndefined();
    expect(record.usageUnavailable).toBe(true);
  });

  it('marks cost unavailable when neither estimated nor provider-reported cost is given', () => {
    const record = recordUsage({ source: 'writer', tool: 'evaluator', provider: 'anthropic', model: 'claude-opus-5', status: 'success' });

    expect(record.costUnavailable).toBe(true);
    expect(record.estimatedCostCurrency).toBeUndefined();
  });

  it('tags an estimated cost with USD', () => {
    const record = recordUsage({
      source: 'writer', tool: 'evaluator', provider: 'anthropic', model: 'claude-opus-5', status: 'success',
      estimatedCost: 0.42,
    });

    expect(record.estimatedCostCurrency).toBe('USD');
    expect(record.costUnavailable).toBe(false);
  });

  it('records a failed attempt with its error message and no usage', () => {
    const record = recordUsage({ source: 'writer', tool: 'initial-generation', provider: 'anthropic', model: 'claude-sonnet-5', status: 'failure', errorMessage: 'boom' });

    expect(record.status).toBe('failure');
    expect(record.errorMessage).toBe('boom');
    expect(record.usageUnavailable).toBe(true);
  });

  it('does not throw when the usage directory cannot be written', () => {
    process.env.MODEL_USAGE_DIR = '/nonexistent-root-owned-path/usage';

    expect(() => recordUsage({ source: 'writer', tool: 'evaluator', provider: 'anthropic', model: 'claude-opus-5', status: 'success' })).not.toThrow();
  });
});
