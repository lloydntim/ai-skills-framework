/**
 * The lifecycle of one run. A run only ever moves along the edges below; a move that is not listed
 * is a bug in the runtime, so it throws instead of being tolerated.
 *
 *   INITIALISING -> PREPARING -> EXECUTING -> VALIDATING -> COMPLETED
 *                                                 |  ^
 *                                                 v  |
 *                                              REVISING
 *   (any non-terminal state) -> FAILED
 *
 * EXECUTING -> COMPLETED exists only for a run with validation switched off (single shot).
 */
export type RunState =
  | 'INITIALISING'
  | 'PREPARING'
  | 'EXECUTING'
  | 'VALIDATING'
  | 'REVISING'
  | 'COMPLETED'
  | 'FAILED';

const TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  INITIALISING: ['PREPARING', 'FAILED'],
  PREPARING: ['EXECUTING', 'FAILED'],
  EXECUTING: ['VALIDATING', 'COMPLETED', 'FAILED'],
  VALIDATING: ['REVISING', 'COMPLETED', 'FAILED'],
  REVISING: ['VALIDATING', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
};

export function isTerminal(state: RunState): state is 'COMPLETED' | 'FAILED' {
  return state === 'COMPLETED' || state === 'FAILED';
}

export class InvalidTransitionError extends Error {
  constructor(from: RunState, to: RunState) {
    super(`Invalid run state transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export interface StateChange {
  state: RunState;
  /** Milliseconds since epoch, from the runtime's injected clock. */
  at: number;
}

/**
 * Holds the current state and the history of how it got there. The state is only reachable through
 * `transition`, so an illegal move cannot be made by assigning to a field. Listeners see every
 * change, which is how a caller observes a run without the machine knowing who is watching.
 */
export class RunStateMachine {
  private current: RunState = 'INITIALISING';
  private readonly changes: StateChange[];
  private readonly listeners: Array<(change: StateChange, from: RunState) => void> = [];

  constructor(private readonly now: () => number) {
    this.changes = [{ state: this.current, at: now() }];
  }

  get state(): RunState {
    return this.current;
  }

  get history(): readonly StateChange[] {
    return this.changes;
  }

  onTransition(listener: (change: StateChange, from: RunState) => void): void {
    this.listeners.push(listener);
  }

  transition(to: RunState): void {
    if (!TRANSITIONS[this.current].includes(to)) throw new InvalidTransitionError(this.current, to);
    const from = this.current;
    this.current = to;
    const change = { state: to, at: this.now() };
    this.changes.push(change);
    for (const listener of this.listeners) listener(change, from);
  }
}
