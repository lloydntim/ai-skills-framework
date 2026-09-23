import type { RunVersions } from '@skills/framework/manifest/versions';
import type { TokenUsage } from '@skills/framework/provider/types';
import type { ModelRolesConfig } from '@skills/framework/provider/model-roles';
import type { DeterministicCheckResult } from '../src/deterministic-checks';

export interface EvalCase {
  id: string;
  category: string;
  sourceLanguage: string;
  targetLanguage: string;
  input: string;
  instructions: string;
  expectedFacts?: string[];
  forbiddenClaims?: string[];
  requiredExactStrings?: string[];
  requiredTerms?: string[];
  targetMarket?: string;
  maxLengthRatio?: number;
}

export type Variant = 'A' | 'B' | 'C' | 'D';

export interface VariantOutput {
  variant: Variant;
  caseId: string;
  text: string;
  usage?: TokenUsage;
  latencyMs?: number;
  cost?: number;
  revisionAttempts?: number;
  /** Production pipeline (variant C) only: total model requests across generate/validate/revise. */
  requestCount?: number;
  /**
   * Production pipeline (variant C) only: true if the first draft passed validation with no
   * revision needed. Undefined for variants that don't self-validate (A, B).
   */
  initialGenerationPassed?: boolean;
}

export interface QualityScore {
  faithfulness: number;
  naturalness: number;
  cvQuality: number;
  terminology: number;
  conciseness: number;
  overall: number;
  justification: string;
  problems: string[];
  missingExpectedFacts: string[];
  unsupportedClaims: string[];
  seniorityInflationNotes: string[];
  terminologyProblems: string[];
  naturalnessProblems: string[];
}

export interface CaseResult {
  caseId: string;
  category: string;
  variant: Variant;
  output: VariantOutput;
  deterministic: DeterministicCheckResult;
  quality: QualityScore;
  /**
   * SHA-256 of the case's content excluding its id (see evals/case-hash.ts). Lets a regression
   * comparison distinguish a renamed case from an edited one from a genuinely removed one. Optional
   * so results saved before this field existed still load; rename/edit detection is reported as
   * unavailable for those rather than guessed at.
   */
  caseHash?: string;
}

/**
 * A pairwise judge call is blind: the judge only ever sees "Output A" / "Output B" and never knows
 * which canonical Variant ('A'|'B'|'C'|'D' — baseline/raw-skill/production/reserved) produced
 * which one. That means two unrelated "A/B" alphabets are in play here, and they must not be
 * confused: `winner`/`naturalness`/`faithfulness`/`cvProfessionalism`/`conciseness` below are all
 * already unblinded — "A" there means "variantA won", not "the judge picked display slot A".
 * `displayedWinner`, `displayedAsA` and `displayedAsB` are the raw, still-blind counterparts: they
 * record literally what slot the judge picked and which canonical variant occupied which slot for
 * this call, so `justification` (which is the judge's raw text and necessarily talks about
 * "Output A"/"Output B") can always be correctly attributed after the fact without having to
 * rewrite the text itself.
 */
export interface PairwiseResult {
  caseId: string;
  /** Canonical variant that was compared as the pipeline's "first" candidate for this case. */
  variantA: Variant;
  /** Canonical variant that was compared as the pipeline's "second" candidate for this case. */
  variantB: Variant;
  /** Unblinded: 'A' means variantA won, 'B' means variantB won. */
  winner: 'A' | 'B' | 'tie';
  naturalness: 'A' | 'B' | 'tie';
  faithfulness: 'A' | 'B' | 'tie';
  cvProfessionalism: 'A' | 'B' | 'tie';
  conciseness: 'A' | 'B' | 'tie';
  /** The judge's own raw text. Refers to "Output A"/"Output B" — the display slots, not variantA/variantB. */
  justification: string;
  /**
   * The judge's raw overall-winner answer, before unblinding: which *display slot* it picked.
   * Optional only so older persisted results (saved before this field existed) still load —
   * for those, this and the two fields below are absent and must not be assumed to be any
   * particular value; see position-bias.ts for how that absence is handled explicitly.
   */
  displayedWinner?: 'A' | 'B' | 'tie';
  /** Canonical variant that was shown to the judge as "Output A" in this call. */
  displayedAsA?: Variant;
  /** Canonical variant that was shown to the judge as "Output B" in this call. */
  displayedAsB?: Variant;
}

export interface AggregateScore {
  variant: Variant;
  cases: number;
  avgFaithfulness: number;
  avgNaturalness: number;
  avgCvQuality: number;
  avgTerminology: number;
  avgConciseness: number;
  avgOverall: number;
  avgTokens: number;
  avgLatencyMs: number;
}

/**
 * Version of a saved result's shape. Bump it when an older result would mean something different
 * (a field repurposed or removed), not when an optional field is added.
 * 2: adds skillName, dataset and versions (prompt and dataset versions and hashes).
 */
export const RESULT_SCHEMA_VERSION = 2;

export interface EvalRunResult {
  timestamp: string;
  /**
   * Version of this result's own shape (see evals/run-metadata.ts RESULT_SCHEMA_VERSION). Optional
   * so older result files (saved before this field existed) still load; for those the shape is
   * treated as unverifiable rather than assumed current.
   */
  schemaVersion?: number;
  gitCommit?: string | null;
  /** Optional so older result files (saved before this field existed) still load. */
  gitDirty?: boolean | null;
  /** SHA-256 of SKILL.md as loaded for this run. Optional for the same reason. */
  skillHash?: string;
  /** SHA-256 of the benchmark/golden cases actually loaded for this run. */
  caseInputHash?: string;
  /** SHA-256 of the eval + runtime configuration actually in effect for this run. */
  configHash?: string;
  /**
   * SHA-256 of the evaluator prompt — the scoring rubric itself — as used for this run. Scores
   * produced under different rubrics are not comparable, so a regression comparison treats a change
   * here as blocking. Optional so older result files still load; for those the rubric cannot be
   * verified and the comparison says so rather than assuming it was unchanged.
   */
  evaluatorPromptHash?: string;
  /** Name of the ModelProvider implementation used (e.g. "anthropic"). */
  provider?: string;
  skillVersion?: string;
  skillName?: string;
  /** Which dataset ran: "benchmark" or "golden". */
  dataset?: string;
  /** Version and hash of the skill, every prompt and every dataset, as of this run. */
  versions?: RunVersions;
  /** Generator model, kept for backward-compat display; see modelRoles for the full breakdown. */
  model: string;
  /** Evaluator model, kept for backward-compat display; see modelRoles for the full breakdown. */
  evaluatorModel: string;
  /**
   * The effective provider/model actually used for every role in this run (generator, validator,
   * reviser, evaluator, pairwiseJudge) — see src/provider/model-roles.ts. Optional so older result
   * files (saved before per-role model configuration existed) still load.
   */
  modelRoles?: ModelRolesConfig;
  benchmarkVersion: string;
  variants: Variant[];
  caseResults: CaseResult[];
  pairwiseResults: PairwiseResult[];
  aggregates: AggregateScore[];
}
