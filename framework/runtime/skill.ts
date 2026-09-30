import type { ModelRole } from '../provider/model-roles';
import type { RoleHandle } from './gateway';
import type { ToolBroker } from './tools';
import type { ValidationOutcome } from './validation';

/** What one step of a skill is given. Built fresh per step, so `attempt` is always current. */
export interface Step<Input, Prepared> {
  input: Input;
  /** Whatever the skill's `prepare` returned; undefined when it has none. */
  prepared: Prepared;
  /** The run's roles. Calls made through them are budgeted, recorded and given their fallback by the runtime. */
  roles: Record<ModelRole, RoleHandle>;
  /** 0 for the first draft, 1 for the first revision, and so on. */
  attempt: number;
  /** The only way a skill reaches an external capability, so policy and recording apply. */
  tools: ToolBroker;
}

/**
 * What a skill supplies to the runtime: the domain steps, and nothing about how they are driven.
 * There is no loop here, no retry counter, no token arithmetic and no tracing; the runtime owns
 * those. A step calls its models through `step.roles`, exactly as it would call a provider.
 *
 * The runtime imports no skill. A skill exports one of these and the caller hands it to
 * `createRuntime`, so the dependency runs from the skill to the framework and never back.
 */
export interface RuntimeSkill<Input = unknown, Prepared = unknown, Detail = unknown> {
  /** Must equal the skill's name in skill.json; it is what `runtime.execute({ skill })` looks up. */
  name: string;
  /** The skill's overrides of the runtime defaults: the `runtime` block of its skill.json. */
  settings?: unknown;
  /** Capabilities the skill needs, checked against the tool policy before any model call. */
  tools?: { required?: readonly string[] };
  /**
   * Assemble what every call of this run needs, once (load the instructions, read references,
   * select what applies to this input). A throw is a CONTEXT_ERROR and no model has been called.
   */
  prepare?(input: Input): Prepared | Promise<Prepared>;
  /** Produce the first draft. */
  generate(step: Step<Input, Prepared>): Promise<string>;
  /**
   * Judge a draft: run the skill's deterministic rules and, if it has one, its semantic validator,
   * and reduce both to a decision. `phase` distinguishes the first validation from a revalidation.
   */
  validate(
    step: Step<Input, Prepared>,
    draft: string,
    phase: 'initial' | 'revalidation'
  ): Promise<ValidationOutcome<Detail>>;
  /** Produce a corrected draft. `previous` is the skill's own validation result for `draft`. */
  revise(step: Step<Input, Prepared>, draft: string, previous: ValidationOutcome<Detail>): Promise<string>;
}
