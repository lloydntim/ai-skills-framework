import { describe, expect, it } from 'vitest';
import { SkillManifestSchema } from './skill-manifest';

const base = { name: 'demo', version: '1.0.0', description: 'd', domain: 'x', prompts: {}, datasets: {} };

describe('skill.json runtime and tools', () => {
  it('are optional, so every existing skill.json stays valid', () => {
    const parsed = SkillManifestSchema.parse(base);
    expect(parsed.runtime).toBeUndefined();
    expect(parsed.tools).toBeUndefined();
  });

  it('accept only the fields the runtime knows, as overrides', () => {
    const parsed = SkillManifestSchema.parse({
      ...base,
      runtime: { execution: { maxRevisions: 4 }, budget: { maxCostUsd: 0.5 } },
      tools: { required: ['jira.read', 'jira.search'] },
    });
    expect(parsed.runtime).toEqual({ execution: { maxRevisions: 4 }, budget: { maxCostUsd: 0.5 } });
    expect(parsed.tools?.required).toEqual(['jira.read', 'jira.search']);
  });

  it('does not own the revision ceiling: any non-negative count is well-formed, the runtime decides what it allows', () => {
    expect(SkillManifestSchema.safeParse({ ...base, runtime: { execution: { maxRevisions: 50 } } }).success).toBe(true);
  });

  it.each([
    ['a misspelt runtime field', { runtime: { execution: { maxRevision: 4 } } }],
    ['an unknown runtime section', { runtime: { retries: {} } }],
    ['a negative revision count', { runtime: { execution: { maxRevisions: -1 } } }],
    ['a tool block with an unknown key', { tools: { requires: ['x'] } }],
    ['an empty capability name', { tools: { required: [''] } }],
  ])('reject %s instead of ignoring it', (_name, extra) => {
    expect(SkillManifestSchema.safeParse({ ...base, ...extra }).success).toBe(false);
  });
});
