import { describe, expect, it } from 'vitest';
import { InvalidTransitionError, isTerminal, RunStateMachine, type RunState } from './state';

function machine() {
  let t = 0;
  return new RunStateMachine(() => ++t);
}

describe('RunStateMachine', () => {
  it('starts in INITIALISING and records it', () => {
    const m = machine();
    expect(m.state).toBe('INITIALISING');
    expect(m.history).toEqual([{ state: 'INITIALISING', at: 1 }]);
  });

  it('follows the revise loop and records every step with its time', () => {
    const m = machine();
    for (const s of ['PREPARING', 'EXECUTING', 'VALIDATING', 'REVISING', 'VALIDATING', 'COMPLETED'] as RunState[]) m.transition(s);
    expect(m.history.map((c) => c.state)).toEqual([
      'INITIALISING', 'PREPARING', 'EXECUTING', 'VALIDATING', 'REVISING', 'VALIDATING', 'COMPLETED',
    ]);
    expect(m.history.map((c) => c.at)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('rejects moves that skip a stage or run backwards', () => {
    const m = machine();
    expect(() => m.transition('EXECUTING')).toThrow(InvalidTransitionError);
    m.transition('PREPARING');
    expect(() => m.transition('INITIALISING')).toThrow(/PREPARING -> INITIALISING/);
    expect(() => m.transition('REVISING')).toThrow(InvalidTransitionError);
    expect(m.state).toBe('PREPARING'); // a rejected move changes nothing
  });

  it.each(['COMPLETED', 'FAILED'] as const)('%s is terminal: nothing leaves it', (terminal) => {
    const m = machine();
    for (const s of ['PREPARING', 'EXECUTING'] as RunState[]) m.transition(s);
    if (terminal === 'COMPLETED') m.transition('COMPLETED');
    else m.transition('FAILED');
    expect(isTerminal(m.state)).toBe(true);
    for (const to of ['PREPARING', 'EXECUTING', 'VALIDATING', 'REVISING', 'COMPLETED', 'FAILED'] as RunState[]) {
      expect(() => m.transition(to)).toThrow(InvalidTransitionError);
    }
  });

  it('can fail from every non-terminal state', () => {
    for (const path of [[], ['PREPARING'], ['PREPARING', 'EXECUTING'], ['PREPARING', 'EXECUTING', 'VALIDATING'], ['PREPARING', 'EXECUTING', 'VALIDATING', 'REVISING']] as RunState[][]) {
      const m = machine();
      path.forEach((s) => m.transition(s));
      expect(() => m.transition('FAILED')).not.toThrow();
    }
  });

  it('tells listeners about each change, with the state it came from', () => {
    const m = machine();
    const seen: string[] = [];
    m.onTransition((change, from) => seen.push(`${from}->${change.state}`));
    m.transition('PREPARING');
    m.transition('FAILED');
    expect(seen).toEqual(['INITIALISING->PREPARING', 'PREPARING->FAILED']);
  });
});
