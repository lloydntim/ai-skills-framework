import type { TokenUsage } from '@skills/framework/provider/types';

export interface CvTaskInput {
  sourceLanguage: string;
  targetLanguage: string;
  input: string;
  instructions: string;
  targetMarket?: string;
  requiredExactStrings?: string[];
  requiredTerms?: string[];
  forbiddenClaims?: string[];
  maxLengthRatio?: number;
}

export interface RuntimeThresholds {
  faithfulness: number;
  unsupportedClaims: number;
  naturalness: number;
  cvQuality: number;
  terminology: number;
}

/**
 * Model/provider selection was moved out of this config and into per-role configuration (see
 * ../provider/model-roles.ts, config/models.json) — generate/validate/revise are now told which
 * model to use by their caller rather than all sharing one `model` field here.
 */
export interface RuntimeConfig {
  temperature: number;
  maxOutputTokens: number;
  maxRevisionAttempts: number;
  maxLengthRatio: number;
  forbiddenCharacters: string[];
  thresholds: RuntimeThresholds;
}

export interface ValidationResult {
  pass: boolean;
  hardGuardrailFailures: string[];
  scores: {
    faithfulness: number;
    naturalness: number;
    cvQuality: number;
    terminology: number;
  };
  unsupportedClaims: string[];
  failingCriteria: string[];
  /** Actual usage/latency/cost from the validator's own model call, not an estimate. */
  usage?: TokenUsage;
  latencyMs?: number;
  cost?: number;
}

/** One role's share of a production run: how many requests it made and what they cost. */
export interface RoleUsageSummary {
  requestCount: number;
  usage: TokenUsage;
  /** Undefined only if none of this role's calls reported latency. */
  latencyMs?: number;
  /** Undefined only if none of this role's calls reported a cost. */
  cost?: number;
}

export interface ProductionResult {
  finalText: string;
  validation: ValidationResult;
  revisionAttempts: number;
  /** Sum of every model call in the pipeline: generation, every validation, every revision. */
  totalUsage: TokenUsage;
  /** Count of every model request made: 1 generation + 1 validation per attempt, plus 1 revision per retry. */
  requestCount: number;
  /** Sum of every call's latencyMs; undefined only if no call reported latency. */
  totalLatencyMs?: number;
  /** Sum of every call's cost; undefined only if no call reported a cost. */
  totalCost?: number;
  /** Same totals as above, broken down by which role made the call. */
  usageByRole: {
    generator: RoleUsageSummary;
    validator: RoleUsageSummary;
    reviser: RoleUsageSummary;
  };
}
