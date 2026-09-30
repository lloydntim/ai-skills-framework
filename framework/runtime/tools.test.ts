import { describe, expect, it, vi } from 'vitest';
import { RuntimeFailure } from './failure';
import { decideTool, ToolBroker } from './tools';

describe('decideTool', () => {
  it('denies whatever no rule mentions', () => {
    expect(decideTool({}, 'jira.read')).toBe('denied');
    expect(decideTool({ allow: ['confluence.read'] }, 'jira.read')).toBe('denied');
  });

  it('matches exact names, prefixes ending in .* and *', () => {
    expect(decideTool({ allow: ['jira.read'] }, 'jira.read')).toBe('allowed');
    expect(decideTool({ allow: ['jira.read'] }, 'jira.readAll')).toBe('denied');
    expect(decideTool({ allow: ['jira.*'] }, 'jira.search')).toBe('allowed');
    expect(decideTool({ allow: ['jira.*'] }, 'jiraX.search')).toBe('denied');
    expect(decideTool({ allow: ['*'] }, 'anything.at.all')).toBe('allowed');
  });

  it('lets deny beat confirm and confirm beat allow', () => {
    const policy = { allow: ['jira.*'], confirm: ['jira.write'], deny: ['jira.delete'] };
    expect(decideTool(policy, 'jira.read')).toBe('allowed');
    expect(decideTool(policy, 'jira.write')).toBe('requires-confirmation');
    expect(decideTool(policy, 'jira.delete')).toBe('denied');
    expect(decideTool({ allow: ['*'], deny: ['jira.delete'] }, 'jira.delete')).toBe('denied');
  });
});

describe('ToolBroker', () => {
  it('runs an allowed call and records only its name, decision and outcome', async () => {
    const broker = new ToolBroker({ allow: ['jira.read'] });
    await expect(broker.call('jira.read', () => ({ secret: 'result' }))).resolves.toEqual({ secret: 'result' });
    expect(broker.calls).toEqual([{ capability: 'jira.read', decision: 'allowed', ok: true }]);
  });

  it('refuses a denied capability with a TOOL_ERROR and does not run it', async () => {
    const fn = vi.fn();
    const broker = new ToolBroker({});
    await expect(broker.call('jira.write', fn)).rejects.toMatchObject({ kind: 'TOOL_ERROR', retryable: false });
    expect(fn).not.toHaveBeenCalled();
  });

  it('fails closed when confirmation is required but there is nobody to ask', async () => {
    const broker = new ToolBroker({ confirm: ['jira.write'] });
    await expect(broker.call('jira.write', () => 1)).rejects.toMatchObject({ kind: 'TOOL_ERROR' });
  });

  it('asks once per capability and remembers a yes', async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const broker = new ToolBroker({ confirm: ['jira.write'] }, confirm);
    await broker.call('jira.write', () => 1);
    await broker.call('jira.write', () => 2);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('does not run the call when confirmation is declined', async () => {
    const fn = vi.fn();
    const broker = new ToolBroker({ confirm: ['x'] }, () => false);
    await expect(broker.call('x', fn)).rejects.toBeInstanceOf(RuntimeFailure);
    expect(fn).not.toHaveBeenCalled();
  });

  it('wraps a failing call as TOOL_ERROR, retryable only if the tool said so', async () => {
    const broker = new ToolBroker({ allow: ['*'] });
    await expect(broker.call('a', () => { throw Object.assign(new Error('rate limited'), { retryable: true }); })).rejects.toMatchObject({ kind: 'TOOL_ERROR', retryable: true });
    await expect(broker.call('b', () => { throw new Error('bad request'); })).rejects.toMatchObject({ kind: 'TOOL_ERROR', retryable: false });
    expect(broker.calls.map((c) => c.ok)).toEqual([false, false]);
  });

  it('checks every required capability up front', async () => {
    const broker = new ToolBroker({ allow: ['jira.read'] });
    await expect(broker.requireAll(['jira.read'])).resolves.toBeUndefined();
    await expect(broker.requireAll(['jira.read', 'jira.search'])).rejects.toMatchObject({ kind: 'TOOL_ERROR' });
  });
});
