import { RuntimeFailure } from './failure';

/**
 * What a run is allowed to do with external capabilities. A capability is a name a skill declares
 * it needs (for example `jira.read`); this file knows names and policy, nothing about what a
 * capability does. Patterns are an exact name, a prefix ending in `.*` (`jira.*`), or `*`.
 *
 * Precedence: deny, then confirm, then allow. A capability matched by nothing is denied, so a
 * skill gains no reach because nobody wrote a rule.
 */
export interface ToolPolicy {
  allow?: string[];
  deny?: string[];
  confirm?: string[];
}

export type ToolDecision = 'allowed' | 'denied' | 'requires-confirmation';

/** Asks a person (or a test) whether one capability may be used. Absent or false means no. */
export type ConfirmTool = (capability: string) => boolean | Promise<boolean>;

export interface ToolCallRecord {
  capability: string;
  decision: ToolDecision;
  /** Whether the call ran to completion. Arguments and results are never recorded. */
  ok: boolean;
}

function matches(pattern: string, capability: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('.*')) return capability.startsWith(pattern.slice(0, -1));
  return pattern === capability;
}

const anyMatch = (patterns: string[] | undefined, capability: string) =>
  (patterns ?? []).some((pattern) => matches(pattern, capability));

export function decideTool(policy: ToolPolicy, capability: string): ToolDecision {
  if (anyMatch(policy.deny, capability)) return 'denied';
  if (anyMatch(policy.confirm, capability)) return 'requires-confirmation';
  if (anyMatch(policy.allow, capability)) return 'allowed';
  return 'denied';
}

/**
 * The one door to external capabilities during a run. It checks the policy, asks for confirmation
 * when the policy says to, runs the call, and records that it happened. A failure is a TOOL_ERROR;
 * whether it is retryable is the tool's to say (an error carrying `retryable: true`).
 */
export class ToolBroker {
  private readonly confirmed = new Set<string>();
  readonly calls: ToolCallRecord[] = [];

  constructor(
    private readonly policy: ToolPolicy = {},
    private readonly confirm?: ConfirmTool
  ) {}

  /** Refuses the run up front if a capability the skill requires cannot be granted. */
  async requireAll(capabilities: readonly string[]): Promise<void> {
    for (const capability of capabilities) await this.authorise(capability);
  }

  async call<T>(capability: string, fn: () => Promise<T> | T): Promise<T> {
    const decision = await this.authorise(capability);
    try {
      const result = await fn();
      this.calls.push({ capability, decision, ok: true });
      return result;
    } catch (err) {
      this.calls.push({ capability, decision, ok: false });
      if (err instanceof RuntimeFailure) throw err;
      throw new RuntimeFailure('TOOL_ERROR', `Tool call failed: ${capability}.`, {
        retryable: (err as { retryable?: unknown } | null)?.retryable === true,
        cause: err,
      });
    }
  }

  private async authorise(capability: string): Promise<ToolDecision> {
    const decision = decideTool(this.policy, capability);
    if (decision === 'denied') {
      throw new RuntimeFailure('TOOL_ERROR', `Capability "${capability}" is not permitted by the tool policy.`);
    }
    if (decision === 'requires-confirmation' && !this.confirmed.has(capability)) {
      if (!this.confirm || !(await this.confirm(capability))) {
        throw new RuntimeFailure('TOOL_ERROR', `Capability "${capability}" needs confirmation and was not confirmed.`);
      }
      this.confirmed.add(capability);
    }
    return decision;
  }
}
