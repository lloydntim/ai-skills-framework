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
 * Model/provider selection lives in per-role configuration (config/models.json), not here — this
 * only holds the knobs that are about the run itself. That now includes the output-token budget and
 * how hard each role thinks: both are properties of the role and its model, both have to be decided
 * together (reasoning is spent out of the same budget as the answer), and both are read from
 * config/models.json by the framework. See docs/ARCHITECTURE.md, "Runtime configuration".
 */
export interface RuntimeConfig {
  temperature: number;
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
