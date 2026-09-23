import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RequestLogEntry } from '../provider/instrumentation';
import type { RunMetadata } from './run-metadata';
import { appendRunSummary, readRunHistory, summarizeRun } from './run-summary';

const PRIVATE = 'Jane Example, 12 Private Road, jane@example.com';

const metadata: RunMetadata = {
  schemaVersion: 5,
  timestamp: '2026-09-22T10:00:00.000Z',
  gitCommit: 'abc123',
  gitDirty: false,
  runId: 'run-1',
  skillName: 'demo-skill',
  skillVersion: '1.0.0',
  dataset: 'golden',
  benchmarkVersion: 'golden-v1',
  versions: {
    skill: { name: 'demo-skill', version: '1.0.0', hash: 'h-skill' },
    prompts: { evaluator: { version: '1', hash: 'h-eval' } },
    datasets: { golden: { version: '1', hash: 'h-golden', caseCount: 2 } },
  },
  skillHash: 'h-skill',
  caseInputHash: 'h-cases',
  configHash: 'h-config',
  provider: 'anthropic',
};

// Shaped like a real saved run: case results carry the model's output and the case's own text.
const run = {
  ...metadata,
  modelRoles: { generator: { provider: 'anthropic', model: 'm' } } as never,
  caseResults: [{ caseId: 'c1', output: { text: `Dear team, ${PRIVATE}` }, quality: { justification: PRIVATE } }],
  aggregates: [{ variant: 'B', cases: 2, avgOverall: 4.5, deterministicPassRate: 1, note: PRIVATE, problems: [PRIVATE] }],
  totals: { requestCount: 6, totalUsage: { inputTokens: 900, outputTokens: 300 }, label: PRIVATE },
};

const requests: RequestLogEntry[] = [
  {
    requestType: 'initial-generation',
    caseId: 'c1',
    usage: { inputTokens: 500, outputTokens: 100, totalTokens: 600 },
    components: [{ component: 'skill', chars: 20000 }, { component: 'case-input', chars: 4000 }],
  },
];

describe('summarizeRun', () => {
  const summary = summarizeRun({ run, config: { runtime: { skillContext: 'by-task' } }, requests, now: () => new Date('2026-09-23T00:00:00Z') });

  it('keeps what identifies the run: versions, hashes, roles, config', () => {
    expect(summary).toMatchObject({
      approvedAt: '2026-09-23T00:00:00.000Z',
      skillVersion: '1.0.0',
      benchmarkVersion: 'golden-v1',
      gitCommit: 'abc123',
      caseInputHash: 'h-cases',
      configHash: 'h-config',
      versions: metadata.versions,
      config: { runtime: { skillContext: 'by-task' } },
    });
  });

  it('keeps scores and totals as numbers, with the variant label', () => {
    expect(summary.aggregates).toEqual([{ variant: 'B', cases: 2, avgOverall: 4.5, deterministicPassRate: 1 }]);
    expect(summary.totals).toEqual({ requestCount: 6, totalUsage: { inputTokens: 900, outputTokens: 300 } });
  });

  it('keeps tokens per request type and prompt-part sizes', () => {
    expect(summary.requests?.byRequestType[0]).toMatchObject({ requestType: 'initial-generation', totalTokens: 600 });
    expect(summary.requests?.promptParts).toEqual([
      { requestType: 'initial-generation', component: 'skill', requestCount: 1, avgChars: 20000, maxChars: 20000 },
      { requestType: 'initial-generation', component: 'case-input', requestCount: 1, avgChars: 4000, maxChars: 4000 },
    ]);
  });

  it('never carries output, case or free text, whatever the run holds', () => {
    const json = JSON.stringify(summary);
    expect(json).not.toContain('Jane Example');
    expect(json).not.toContain('Dear team');
    expect(json).not.toContain('caseResults');
  });
});

describe('appendRunSummary / readRunHistory', () => {
  it('appends one line per approved run and reads them back in order', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'run-history-')), 'history.jsonl');
    expect(readRunHistory(file)).toEqual([]);
    appendRunSummary(file, summarizeRun({ run }));
    appendRunSummary(file, summarizeRun({ run: { ...run, skillVersion: '1.1.0' } }));
    expect(fs.readFileSync(file, 'utf-8').trim().split('\n')).toHaveLength(2);
    expect(readRunHistory(file).map((s) => s.skillVersion)).toEqual(['1.0.0', '1.1.0']);
  });
});
