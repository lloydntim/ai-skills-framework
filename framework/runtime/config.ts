import { z } from 'zod';
import { RuntimeFailure } from './failure';

/**
 * How a run is executed, as opposed to what the skill is doing. Written down once here as the
 * defaults; a skill or a single run states only the fields it changes.
 *
 * Precedence, lowest to highest:  DEFAULT_RUNTIME_SETTINGS -> the skill (skill.json "runtime")
 * -> the options passed to one run. Merging is per field, not per section, so a skill that sets
 * `budget.maxCostUsd` keeps the default for everything else.
 *
 * Budget limits are absent by default. A limit that is on by default would end runs that work
 * today (a full-length CV at high reasoning is not small), so a limit is something a skill or a run
 * opts into. `maxRevisions` is the one bound that is always on: it is what stops a retry loop.
 *
 * Two different things bound revisions, on purpose. `execution.maxRevisions` is what a skill (or a
 * run) *chooses*: a property of the skill's task, like its thresholds. `ABSOLUTE_MAX_REVISIONS`
 * is what the runtime *allows*: a safety policy owned by the runtime, so it is not in the manifest
 * schema and no skill.json can raise it.
 */
export interface RuntimeSettings {
  execution: {
    /** Revision rounds after the first draft. 0 means a single attempt. */
    maxRevisions: number;
  };
  budget: {
    /** Total tokens (input + output) across every model call in the run. */
    maxTokens?: number;
    /** Total US dollars across every model call in the run. */
    maxCostUsd?: number;
    /** Wall-clock milliseconds since the run started. Checked between calls, not during one. */
    maxDurationMs?: number;
  };
  validation: {
    /** False runs the skill once and returns the draft unvalidated (the single-shot variant). */
    enabled: boolean;
  };
  tracing: {
    /** Whether the finished trace is handed to the trace sink. The trace itself is always built. */
    enabled: boolean;
  };
}

/**
 * The most revision rounds any run may be configured for, whatever a skill.json or a caller asks.
 * It exists so a mistyped or copied limit cannot turn a bounded loop into an expensive one. A value
 * above it is refused (a CONFIGURATION_ERROR before any model call) rather than quietly clamped, so
 * nobody believes they are getting the number they wrote. Raising it is a change to the runtime.
 */
export const ABSOLUTE_MAX_REVISIONS = 10;

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  execution: { maxRevisions: 3 },
  budget: {},
  validation: { enabled: true },
  tracing: { enabled: true },
};

const positive = z.number().positive();

/**
 * The shape of a settings layer. Strict, so a typo in skill.json is an error rather than a limit
 * that silently never applies. It says what is well-formed, not what the runtime permits: the
 * runtime's own limits (ABSOLUTE_MAX_REVISIONS) are applied in resolveSettings.
 */
export const RuntimeOverridesSchema = z.strictObject({
  execution: z.strictObject({ maxRevisions: z.number().int().min(0) }).partial().optional(),
  budget: z
    .strictObject({
      maxTokens: positive.int(),
      maxCostUsd: positive,
      maxDurationMs: positive.int(),
    })
    .partial()
    .optional(),
  validation: z.strictObject({ enabled: z.boolean() }).partial().optional(),
  tracing: z.strictObject({ enabled: z.boolean() }).partial().optional(),
});

export type RuntimeOverrides = z.infer<typeof RuntimeOverridesSchema>;

/**
 * Applies each layer over the one before it. Throws a CONFIGURATION_ERROR naming the layer whose
 * value is wrong, so a bad skill.json and a bad per-run option are told apart.
 */
export function resolveSettings(
  layers: { defaults?: RuntimeSettings; skill?: unknown; run?: unknown } = {}
): RuntimeSettings {
  const base = layers.defaults ?? DEFAULT_RUNTIME_SETTINGS;
  const skill = parseLayer('skill', layers.skill);
  const run = parseLayer('run options', layers.run);
  refuseOverCeiling('runtime defaults', base.execution.maxRevisions);

  return {
    execution: { ...base.execution, ...skill.execution, ...run.execution },
    budget: { ...base.budget, ...skill.budget, ...run.budget },
    validation: { ...base.validation, ...skill.validation, ...run.validation },
    tracing: { ...base.tracing, ...skill.tracing, ...run.tracing },
  };
}

function parseLayer(name: string, raw: unknown): RuntimeOverrides {
  if (raw === undefined) return {};
  const parsed = RuntimeOverridesSchema.safeParse(raw);
  if (parsed.success) {
    refuseOverCeiling(name, parsed.data.execution?.maxRevisions);
    return parsed.data;
  }
  const problems = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  throw new RuntimeFailure('CONFIGURATION_ERROR', `Invalid runtime settings in ${name}: ${problems}`);
}

function refuseOverCeiling(layer: string, maxRevisions: number | undefined): void {
  if (maxRevisions === undefined || maxRevisions <= ABSOLUTE_MAX_REVISIONS) return;
  throw new RuntimeFailure(
    'CONFIGURATION_ERROR',
    `Invalid runtime settings in ${layer}: execution.maxRevisions is ${maxRevisions}, above the runtime's safety ceiling of ${ABSOLUTE_MAX_REVISIONS}.`
  );
}
