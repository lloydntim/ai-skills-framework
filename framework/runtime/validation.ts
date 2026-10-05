/** Which layer of validation raised an issue. The order is the order they run in. */
export type IssueSource = 'schema' | 'deterministic' | 'semantic';

export interface ValidationIssue {
  source: IssueSource;
  /** A fixed identifier for the kind of problem (`missing-term`, `low-faithfulness`). Recorded in traces. */
  code: string;
  /** For a person or a reviser. Can quote the text being checked, so it is never recorded in a trace. */
  message: string;
}

/**
 * What validation concluded, in terms the runtime can act on without understanding the skill:
 * `pass` completes the run, `revise` asks for another draft if any revision is left, `fail` stops
 * because another draft would not help.
 */
export type ValidationDecision =
  | { status: 'pass' }
  | { status: 'revise'; issues: ValidationIssue[] }
  | { status: 'fail'; issues: ValidationIssue[] };

/**
 * What a skill's validate step returns: the decision for the runtime and the skill's own richer
 * result (`detail`), which the runtime passes back to the skill's revise step without reading it.
 * The runtime coordinates validation; what a rule means stays in the skill.
 */
export interface ValidationOutcome<Detail> {
  decision: ValidationDecision;
  detail: Detail;
}
