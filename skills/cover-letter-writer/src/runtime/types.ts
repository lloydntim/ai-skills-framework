import type { DeterministicCheckResult } from '../deterministic-checks';
import type { ModelRole } from '@skills/framework/provider/model-roles';
import type { TokenUsage } from '@skills/framework/provider/types';
import type { Market } from '../markets';
import type { LetterLanguage } from '../templates';
import type { SkillContext } from '../skill-sections';

/**
 * Everything one production run needs to know about the letter it is writing. Mirrors
 * evals/types.ts's EvalCase for the constraint fields, so a golden/benchmark case can be fed
 * straight into the runtime without a second, drifting copy of the same shape.
 */
export interface CoverLetterTaskInput {
  cvText: string;
  /** The job advert the letter is answering. */
  roleDescription: string;
  instructions: string;
  language: LetterLanguage;
  /**
   * Opts in to the house-format structural check for this language (see templates.ts /
   * REQUIRED_STRUCTURE). Separate from `language` on purpose, mirroring evals/types.ts's
   * EvalCase: a deliberate one-off format should not be reported as broken.
   */
  templateLanguage?: LetterLanguage;
  /** Determines the contact block and right-to-work wording required in the letter, when named. */
  market?: Market;
  requiredExactStrings?: string[];
  requiredTerms?: string[];
  forbiddenClaims?: string[];
  allowedTechnologies?: string[];
  allowedNumbers?: string[];
  minWords?: number;
  maxWords?: number;
}

/** The six dimensions the semantic validator scores the draft on, 1 (worst) to 5 (best). */
export interface SemanticValidationScores {
  factualGrounding: number;
  jobRelevance: number;
  professionalTone: number;
  specificity: number;
  naturalness: number;
  overall: number;
}

export type SemanticDimension = keyof SemanticValidationScores;

export interface RuntimeThresholds extends Record<SemanticDimension, number> {}

/**
 * Model/provider selection lives in per-role configuration (../provider/model-roles.ts,
 * config/models.json), not here — this only holds the knobs that are about the run itself.
 */
export interface RuntimeConfig {
  temperature: number;
  maxOutputTokens: number;
  /** Hard cap on bounded, targeted revision attempts. Revision stops here even if still failing. */
  maxRevisionAttempts: number;
  thresholds: RuntimeThresholds;
  /**
   * How much of SKILL.md the generator and reviser see (see skill-sections.ts). Absent means
   * 'full', which is what production sends.
   */
  skillContext?: SkillContext;
}

export interface ValidationResult {
  pass: boolean;
  /** The mechanical, non-model result this validation was built on — see deterministic-checks.ts. */
  deterministic: DeterministicCheckResult;
  scores: SemanticValidationScores;
  /** Absolute failures from either layer: unmet deterministic hard rules plus judge-reported guardrail breaks. */
  hardGuardrailFailures: string[];
  /** The judge-reported subset of hardGuardrailFailures only — kept separate so callers never have to re-derive it. */
  judgeHardGuardrailFailures: string[];
  /** Score dimensions that fell below their configured threshold. */
  failingCriteria: SemanticDimension[];
  /** Actual usage/latency/cost from the semantic validator's own model call, never estimated. */
  usage?: TokenUsage;
  latencyMs?: number;
  cost?: number;
}

export interface RoleUsage {
  requestCount: number;
  usage: TokenUsage;
  latencyMs?: number;
  cost?: number;
}

export interface ProductionResult {
  finalText: string;
  /** Whether the very first validation — before any revision — passed. */
  initialPass: boolean;
  finalValidation: ValidationResult;
  revisionAttempts: number;
  /** Count of every model request made: generation, every semantic validation/revalidation, every revision. */
  requestCount: number;
  /** Sum of every model call's usage in the run. */
  totalUsage: TokenUsage;
  /** Sum of every call's latencyMs; undefined only if no call reported latency. */
  totalLatencyMs?: number;
  /** Sum of every call's cost; undefined only if no call reported a cost. */
  totalCost?: number;
  /** Same totals, broken down per role. A role never called in this run reports zeroed usage. */
  usageByRole: Record<ModelRole, RoleUsage>;
}
