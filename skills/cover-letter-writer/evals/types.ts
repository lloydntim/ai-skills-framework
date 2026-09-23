import type { RunVersions } from '@skills/framework/manifest/versions';
import type { DeterministicCheckResult } from '../src/deterministic-checks';
import type { ModelRolesConfig } from '@skills/framework/provider/model-roles';
import type { TokenUsage } from '@skills/framework/provider/types';
import type { Market } from '../src/markets';

/**
 * A single evaluation case. Golden cases (reference/evals/golden) each exist because of one specific
 * failure that must never come back; benchmark cases (reference/evals/benchmark) measure broad quality
 * across varied roles, in both languages; experimental cases are a holding area and are loaded by
 * nothing, so a half-formed case cannot quietly move the numbers.
 */
export interface EvalCase {
  id: string;
  category: string;
  /** Language the finished letter must be written in. */
  language: 'en' | 'de';
  /**
   * Determines the contact block and right-to-work wording required in the letter, when named —
   * mirrors CoverLetterTaskInput's field of the same name (src/runtime/types.ts). Absent means the
   * case exercises the unspecified-market path, same as production when the user names none. The
   * 'by-task' skill-context selector (src/skill-sections.ts) also keys on this: it drops the UK and
   * Ireland section only when market is 'dach'.
   */
  market?: Market;
  /** The CV excerpt the letter must be grounded in. Nothing outside this is available to claim. */
  cvText: string;
  /** The job advert the letter is answering. */
  roleDescription: string;
  instructions: string;
  /** Optional letter template whose structure and slots the letter must follow. */
  template?: string;
  /** Prose descriptions of what a correct letter conveys. For a judge to assess, not a check. */
  expectedFacts?: string[];
  forbiddenClaims?: string[];
  requiredExactStrings?: string[];
  requiredTerms?: string[];
  /** Technologies the advert names, which the letter may mention as the employer's, not its own. */
  allowedTechnologies?: string[];
  /** Numbers the letter may quote from the advert rather than the CV. */
  allowedNumbers?: string[];
  /** Opt in to the house-format structural check for this case. */
  templateLanguage?: 'en' | 'de';
  minWords?: number;
  maxWords?: number;
}

/**
 * A = plain model, no SKILL.md.
 * B = SKILL.md, single generation pass, no runtime self-review.
 * C = the real production pipeline (src/runtime — generate -> validate -> revise -> revalidate).
 */
export type Variant = 'A' | 'B' | 'C';

export interface VariantOutput {
  variant: Variant;
  caseId: string;
  text: string;
  usage?: TokenUsage;
  latencyMs?: number;
  cost?: number;
  revisionAttempts?: number;
  /** Total model requests this variant made for this case: always 1 for A/B, the pipeline's own count for C. */
  requestCount: number;
  /**
   * Variant C only: true if the first draft passed validation with no revision needed. Undefined
   * for A/B, which never self-validate.
   */
  initialGenerationPassed?: boolean;
}

/** The offline, single-output evaluator's cover-letter-specific rubric — see prompts/evaluator.md. */
export interface QualityScore {
  factualGrounding: number;
  jobRelevance: number;
  professionalTone: number;
  specificity: number;
  naturalness: number;
  conciseness: number;
  overall: number;
  justification: string;
  problems: string[];
  missingExpectedFacts: string[];
  unsupportedClaims: string[];
  /** A claim that upgrades the CV's stated ownership level (e.g. "helped" read back as "led"). */
  ownershipInflationNotes: string[];
  /** A benefit credited to the employer that the advert never actually offered. */
  unofferedBenefitNotes: string[];
}

export interface CaseResult {
  caseId: string;
  category: string;
  variant: Variant;
  output: VariantOutput;
  deterministic: DeterministicCheckResult;
  quality: QualityScore;
  /** Actual usage/latency/cost from the evaluator's own judge call, never estimated. */
  evaluatorUsage?: TokenUsage;
  evaluatorLatencyMs?: number;
  evaluatorCost?: number;
  /**
   * SHA-256 of the case's content excluding its id (see evals/case-hash.ts). Lets a later
   * comparison distinguish a renamed case from an edited one from a genuinely removed one.
   */
  caseHash: string;
}

/**
 * A blind pairwise judge call is shown two outputs as "Output A" / "Output B" display slots and
 * never told which canonical Variant ('A'|'B'|'C') produced which. That means two unrelated "A/B"
 * alphabets are in play here, and they must not be confused: `winner` and every scored dimension
 * below are already unblinded — "A" there means "variantA won", not "the judge picked display slot
 * A". `displayedWinner`, `displayedAsA` and `displayedAsB` are the raw, still-blind counterparts:
 * they record literally what slot the judge picked and which canonical variant occupied which slot
 * for this call, so `justification` (the judge's raw text, which necessarily talks about "Output
 * A"/"Output B") can always be correctly attributed after the fact without rewriting the text
 * itself — see evals/pairwise-evaluator.ts.
 */
export interface PairwiseResult {
  caseId: string;
  /** Canonical variant compared as this pairing's "first" candidate. */
  variantA: Variant;
  /** Canonical variant compared as this pairing's "second" candidate. */
  variantB: Variant;
  /** Unblinded: 'A' means variantA won, 'B' means variantB won. */
  winner: 'A' | 'B' | 'tie';
  factualGrounding: 'A' | 'B' | 'tie';
  jobRelevance: 'A' | 'B' | 'tie';
  professionalTone: 'A' | 'B' | 'tie';
  naturalness: 'A' | 'B' | 'tie';
  /** The judge's own raw text. Refers to "Output A"/"Output B" — the display slots, not variantA/variantB. */
  justification: string;
  /**
   * The judge's raw overall-winner answer, before unblinding: which *display slot* it picked.
   * Optional only so a persisted result missing this (an older file, or one that could not record
   * it) still loads — for those, this and the two fields below are absent and must not be assumed
   * to be any particular value; see position-bias.ts for how that absence is handled explicitly.
   */
  displayedWinner?: 'A' | 'B' | 'tie';
  /** Canonical variant that was shown to the judge as "Output A" in this call. */
  displayedAsA?: Variant;
  /** Canonical variant that was shown to the judge as "Output B" in this call. */
  displayedAsB?: Variant;
}

/** Wins/losses/ties for one variant, computed from every PairwiseResult's canonical (unblinded) fields. */
export interface PairwiseAggregate {
  variant: Variant;
  wins: number;
  losses: number;
  ties: number;
  comparisons: number;
}

export interface AggregateScore {
  variant: Variant;
  cases: number;
  avgFactualGrounding: number;
  avgJobRelevance: number;
  avgProfessionalTone: number;
  avgSpecificity: number;
  avgNaturalness: number;
  avgConciseness: number;
  avgOverall: number;
  avgTokens: number;
  avgLatencyMs: number;
  /** Share of cases (0-1) whose deterministic check passed outright — the hard, non-negotiable floor. */
  deterministicPassRate: number;
}

/** Sum of every model call made anywhere in the run: every variant's generation/pipeline calls plus every evaluator call. */
export interface RunTotals {
  requestCount: number;
  totalUsage: TokenUsage;
  totalLatencyMs?: number;
  totalCost?: number;
}

/**
 * Version of a saved result's shape. Bump it when an older result would mean something different
 * (a field repurposed or removed), not when an optional field is added.
 * 5: adds skillName, skillVersion, dataset and versions (prompt and dataset versions and hashes).
 */
export const RESULT_SCHEMA_VERSION = 5;

export interface EvalRunResult {
  schemaVersion: number;
  skillName: string;
  skillVersion: string;
  /** Which dataset ran: "benchmark" or "golden". */
  dataset: string;
  /** Version and hash of the skill, every prompt and every dataset, as of this run. */
  versions: RunVersions;
  timestamp: string;
  /** null when not run inside a git checkout, or git is unavailable. */
  gitCommit: string | null;
  gitDirty: boolean | null;
  /** The MODEL_RUN_ID this run set before making any provider call — see src/usage/report.ts's --run-id filter. */
  runId: string | null;
  skillHash: string;
  caseInputHash: string;
  configHash: string;
  /** SHA-256 of the single-output evaluator's rubric prompt (prompts/evaluator.md) as used for this run. */
  evaluatorPromptHash?: string;
  /** The effective provider/model for every role used (generator, validator, reviser, evaluator). */
  modelRoles: ModelRolesConfig;
  benchmarkVersion: string;
  variants: Variant[];
  caseResults: CaseResult[];
  pairwiseResults: PairwiseResult[];
  aggregates: AggregateScore[];
  pairwiseAggregates: PairwiseAggregate[];
  totals: RunTotals;
}
