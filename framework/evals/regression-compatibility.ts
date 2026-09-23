import type { RoleModelConfig } from '../provider/model-roles';
import type { RunVersions } from '../manifest/versions';

/**
 * The fields of a saved eval run that decide whether two runs can be compared. Each skill's own
 * result type (which also carries its own scores) satisfies this shape, so nothing here knows what
 * a score means. Every field is optional because a run saved before a field existed must still load;
 * a missing field is reported as "unverifiable", never assumed to match.
 */
export interface ComparableRun {
  schemaVersion?: number;
  gitDirty?: boolean | null;
  skillHash?: string;
  caseInputHash?: string;
  configHash?: string;
  evaluatorPromptHash?: string;
  /** Names the dataset this run used, such as "golden-v1". */
  benchmarkVersion?: string;
  /** Which dataset ran: "benchmark" or "golden". */
  dataset?: string;
  versions?: RunVersions;
  modelRoles?: Partial<Record<string, RoleModelConfig>>;
  /** Older runs record only these two model names. */
  model?: string;
  evaluatorModel?: string;
  caseResults: { caseId: string; variant?: string; caseHash?: string }[];
}
type EvalRunResult = ComparableRun;

/** Whether two runs may be compared at all, and how loudly to say so. */
export type CompatibilityLevel = 'COMPATIBLE' | 'WARNING' | 'INCOMPATIBLE';

/**
 * INFO states something true and expected (the skill changed, which is why you ran this) and never
 * escalates the overall level. WARNING means compare with care. INCOMPATIBLE means the two runs are
 * not measuring the same thing.
 */
export type FindingLevel = 'INFO' | 'WARNING' | 'INCOMPATIBLE';

export interface CompatibilityFinding {
  level: FindingLevel;
  /** Stable identifier, safe to match on in scripts or tests. */
  code: string;
  message: string;
  previous?: string;
  current?: string;
}

export interface RenamedCase {
  previousId: string;
  currentId: string;
}

export interface CaseSetDiff {
  /** Ids present in both runs. */
  shared: string[];
  /** Ids only in the current run. No baseline exists for these, so they cannot be compared. */
  added: string[];
  /** Ids only in the baseline. Coverage has shrunk; these are never dropped silently. */
  removed: string[];
  /** Same content under a new id. The case still exists, so it counts as neither added nor removed. */
  renamed: RenamedCase[];
  /** Same id, different content. Scores for these measure different inputs and are not comparable. */
  edited: string[];
  /**
   * False when either run predates per-case content hashes. Renames and edits then cannot be
   * detected: a rename shows up as one removal plus one addition, which is reported as such rather
   * than guessed at.
   */
  contentComparable: boolean;
}

export interface CompatibilityReport {
  level: CompatibilityLevel;
  findings: CompatibilityFinding[];
  caseSet: CaseSetDiff;
  /**
   * False when something changed that makes *every* score incomparable — a different evaluator
   * model, provider, or rubric. Individually-affected cases (edited ones) are listed in
   * `caseSet.edited` instead, so the rest of the suite can still be compared.
   */
  scoresComparable: boolean;
  /**
   * False when the pairwise judge or its prompt changed. Pairwise results from the two runs then
   * measure different things. Single-output scores are unaffected.
   */
  pairwiseComparable: boolean;
}

function uniqueCaseIds(run: EvalRunResult, variant?: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const result of run.caseResults) {
    if (variant !== undefined && result.variant !== variant) continue;
    if (!seen.has(result.caseId)) {
      seen.add(result.caseId);
      ids.push(result.caseId);
    }
  }
  return ids;
}

/** caseId -> content hash. A case whose results carry no hash maps to undefined. */
function caseHashes(run: EvalRunResult, variant?: string): Map<string, string | undefined> {
  const hashes = new Map<string, string | undefined>();
  for (const result of run.caseResults) {
    if (variant !== undefined && result.variant !== variant) continue;
    if (!hashes.has(result.caseId) || hashes.get(result.caseId) === undefined) {
      hashes.set(result.caseId, result.caseHash);
    }
  }
  return hashes;
}

function allHashesPresent(hashes: Map<string, string | undefined>): boolean {
  if (hashes.size === 0) return false;
  return [...hashes.values()].every((hash) => hash !== undefined);
}

/** Pairs removals against additions that carry the same content hash. */
function detectRenames(
  removed: string[],
  added: string[],
  previousHashes: Map<string, string | undefined>,
  currentHashes: Map<string, string | undefined>
): { renamed: RenamedCase[]; stillRemoved: string[]; stillAdded: string[] } {
  const addedByHash = new Map<string, string[]>();
  for (const id of added) {
    const hash = currentHashes.get(id);
    if (hash === undefined) continue;
    addedByHash.set(hash, [...(addedByHash.get(hash) ?? []), id]);
  }

  const renamed: RenamedCase[] = [];
  const claimed = new Set<string>();

  for (const previousId of removed) {
    const hash = previousHashes.get(previousId);
    if (hash === undefined) continue;
    const candidate = (addedByHash.get(hash) ?? []).find((id) => !claimed.has(id));
    if (candidate) {
      claimed.add(candidate);
      renamed.push({ previousId, currentId: candidate });
    }
  }

  const renamedPreviousIds = new Set(renamed.map((r) => r.previousId));
  return {
    renamed,
    stillRemoved: removed.filter((id) => !renamedPreviousIds.has(id)),
    stillAdded: added.filter((id) => !claimed.has(id)),
  };
}

/** When `variant` is given, only that variant's results are compared. */
export function diffCaseSets(previous: EvalRunResult, current: EvalRunResult, variant?: string): CaseSetDiff {
  const previousIds = uniqueCaseIds(previous, variant);
  const currentIds = uniqueCaseIds(current, variant);
  const previousHashes = caseHashes(previous, variant);
  const currentHashes = caseHashes(current, variant);

  const contentComparable = allHashesPresent(previousHashes) && allHashesPresent(currentHashes);

  const currentIdSet = new Set(currentIds);
  const previousIdSet = new Set(previousIds);

  const shared = currentIds.filter((id) => previousIdSet.has(id));
  const rawRemoved = previousIds.filter((id) => !currentIdSet.has(id));
  const rawAdded = currentIds.filter((id) => !previousIdSet.has(id));

  const { renamed, stillRemoved, stillAdded } = contentComparable
    ? detectRenames(rawRemoved, rawAdded, previousHashes, currentHashes)
    : { renamed: [], stillRemoved: rawRemoved, stillAdded: rawAdded };

  const edited = contentComparable
    ? shared.filter((id) => previousHashes.get(id) !== currentHashes.get(id))
    : [];

  return { shared, added: stillAdded, removed: stillRemoved, renamed, edited, contentComparable };
}

function roleIdentity(run: EvalRunResult, role: string): { provider?: string; model?: string } {
  const entry = run.modelRoles?.[role];
  return entry ? { provider: entry.provider, model: entry.model } : {};
}

function evaluatorIdentity(run: EvalRunResult): { provider?: string; model: string } {
  // modelRoles is the full per-role record; evaluatorModel is the long-standing field that older
  // results also have. Falling back to it means a legacy baseline can still have its evaluator
  // *model* checked — only the provider becomes unverifiable.
  if (run.modelRoles?.evaluator) {
    return { provider: run.modelRoles.evaluator.provider, model: run.modelRoles.evaluator.model };
  }
  return { model: run.evaluatorModel ?? '(not recorded)' };
}

function generatorIdentity(run: EvalRunResult): { provider?: string; model: string } {
  if (run.modelRoles?.generator) {
    return { provider: run.modelRoles.generator.provider, model: run.modelRoles.generator.model };
  }
  return { model: run.model ?? '(not recorded)' };
}

function compareHashField(
  findings: CompatibilityFinding[],
  options: {
    previous?: string;
    current?: string;
    changedCode: string;
    changedLevel: FindingLevel;
    changedMessage: string;
    unchangedCode?: string;
    unchangedLevel?: FindingLevel;
    unchangedMessage?: string;
    unverifiableCode: string;
    unverifiableMessage: string;
  }
): void {
  if (options.previous === undefined || options.current === undefined) {
    findings.push({
      level: 'WARNING',
      code: options.unverifiableCode,
      message: options.unverifiableMessage,
      previous: options.previous ?? '(not recorded)',
      current: options.current ?? '(not recorded)',
    });
    return;
  }

  if (options.previous !== options.current) {
    findings.push({
      level: options.changedLevel,
      code: options.changedCode,
      message: options.changedMessage,
      previous: options.previous.slice(0, 12),
      current: options.current.slice(0, 12),
    });
    return;
  }

  if (options.unchangedCode && options.unchangedLevel && options.unchangedMessage) {
    findings.push({
      level: options.unchangedLevel,
      code: options.unchangedCode,
      message: options.unchangedMessage,
    });
  }
}

/**
 * Decides whether a baseline and a current run are comparable, and says exactly why not when they
 * are not. Nothing here reads scores: this runs *before* any score comparison, so an incomparable
 * pair can be rejected rather than quietly producing numbers that look meaningful.
 */
export function checkCompatibility(
  previous: EvalRunResult,
  current: EvalRunResult,
  /** When given, also checks that both runs actually hold results for the variant being compared. */
  comparedVariant?: string
): CompatibilityReport {
  const findings: CompatibilityFinding[] = [];
  const caseSet = diffCaseSets(previous, current, comparedVariant);

  /* ---- the shape of the persisted result itself ---- */

  if (previous.schemaVersion === undefined || current.schemaVersion === undefined) {
    findings.push({
      level: 'WARNING',
      code: 'SCHEMA_VERSION_UNVERIFIABLE',
      message: 'One run does not record a result schema version, so it cannot be confirmed both runs use the same result shape.',
      previous: previous.schemaVersion !== undefined ? String(previous.schemaVersion) : '(not recorded)',
      current: current.schemaVersion !== undefined ? String(current.schemaVersion) : '(not recorded)',
    });
  } else if (previous.schemaVersion !== current.schemaVersion) {
    findings.push({
      level: 'WARNING',
      code: 'SCHEMA_VERSION_CHANGED',
      message: 'The two runs were saved under different result schema versions. Fields specific to one version may be missing or mean something different in the other.',
      previous: String(previous.schemaVersion),
      current: String(current.schemaVersion),
    });
  }

  if (comparedVariant !== undefined) {
    const inPrevious = previous.caseResults.some((r) => r.variant === comparedVariant);
    const inCurrent = current.caseResults.some((r) => r.variant === comparedVariant);
    if (!inPrevious && inCurrent) {
      findings.push({
        level: 'WARNING',
        code: 'VARIANT_MISSING_FROM_BASELINE',
        message:
          `The baseline holds no variant ${comparedVariant} results, so there is nothing to compare this ` +
          `variant against. Approve a new baseline to start tracking it.`,
      });
    } else if (!inCurrent) {
      findings.push({
        level: 'INCOMPATIBLE',
        code: 'VARIANT_MISSING_FROM_RUN',
        message: `This run holds no variant ${comparedVariant} results, so the variant was not checked at all.`,
      });
    }
  }

  /* ---- the scoring rubric and the judge that applied it ---- */

  const previousEvaluator = evaluatorIdentity(previous);
  const currentEvaluator = evaluatorIdentity(current);

  if (previousEvaluator.model !== currentEvaluator.model) {
    findings.push({
      level: 'INCOMPATIBLE',
      code: 'EVALUATOR_MODEL_CHANGED',
      message: 'Scores were produced by different evaluator models, so they are not the same measurement.',
      previous: previousEvaluator.model,
      current: currentEvaluator.model,
    });
  }

  if (previousEvaluator.provider === undefined || currentEvaluator.provider === undefined) {
    findings.push({
      level: 'WARNING',
      code: 'EVALUATOR_PROVIDER_UNVERIFIABLE',
      message: 'One run does not record which provider served the evaluator, so that cannot be checked.',
      previous: previousEvaluator.provider ?? '(not recorded)',
      current: currentEvaluator.provider ?? '(not recorded)',
    });
  } else if (previousEvaluator.provider !== currentEvaluator.provider) {
    findings.push({
      level: 'INCOMPATIBLE',
      code: 'EVALUATOR_PROVIDER_CHANGED',
      message: 'The evaluator ran on a different provider, so scores are not the same measurement.',
      previous: previousEvaluator.provider,
      current: currentEvaluator.provider,
    });
  }

  compareHashField(findings, {
    previous: previous.evaluatorPromptHash,
    current: current.evaluatorPromptHash,
    changedCode: 'RUBRIC_CHANGED',
    changedLevel: 'INCOMPATIBLE',
    changedMessage: 'The scoring rubric (evaluator prompt) changed, so scores are not the same measurement.',
    unverifiableCode: 'RUBRIC_UNVERIFIABLE',
    unverifiableMessage:
      'One run does not record a rubric fingerprint, so it cannot be confirmed that both were scored ' +
      'under the same rubric.',
  });

  /* ---- the system under test ---- */

  // The system under test is the skill's instructions plus the prompts that shape what production
  // returns. A change to any of them is an expected reason to run a comparison.
  const previousPrompts = previous.versions?.prompts ?? {};
  const currentPrompts = current.versions?.prompts ?? {};
  const SYSTEM_PROMPTS = ['validator', 'reviser', 'baseline'] as const;
  const changedSystemPrompts = SYSTEM_PROMPTS.filter(
    (name) => previousPrompts[name] && currentPrompts[name] && previousPrompts[name].hash !== currentPrompts[name].hash
  );

  compareHashField(findings, {
    previous: previous.skillHash,
    current: current.skillHash,
    changedCode: 'SKILL_CHANGED',
    changedLevel: 'INFO',
    changedMessage: 'The skill changed, which is the expected reason to run a regression comparison.',
    unchangedCode: changedSystemPrompts.length === 0 ? 'SKILL_UNCHANGED' : undefined,
    unchangedLevel: 'WARNING',
    unchangedMessage:
      'The skill is identical to the baseline, so any score movement is evaluator noise rather than a ' +
      'regression.',
    unverifiableCode: 'SKILL_UNVERIFIABLE',
    unverifiableMessage: 'One run does not record a skill fingerprint, so the skill change cannot be confirmed.',
  });

  for (const name of changedSystemPrompts) {
    findings.push({
      level: 'INFO',
      code: `${name.toUpperCase()}_PROMPT_CHANGED`,
      message: `The ${name} prompt changed, which changes what the production pipeline returns. This is an expected reason to compare.`,
      previous: previousPrompts[name].hash.slice(0, 12),
      current: currentPrompts[name].hash.slice(0, 12),
    });
  }

  /* ---- the pairwise judge (affects pairwise results only) ---- */

  let pairwiseComparable = true;
  if (previousPrompts.pairwiseEvaluator && currentPrompts.pairwiseEvaluator) {
    if (previousPrompts.pairwiseEvaluator.hash !== currentPrompts.pairwiseEvaluator.hash) {
      pairwiseComparable = false;
      findings.push({
        level: 'WARNING',
        code: 'PAIRWISE_RUBRIC_CHANGED',
        message: 'The pairwise judge prompt changed, so pairwise results are not the same measurement.',
        previous: previousPrompts.pairwiseEvaluator.hash.slice(0, 12),
        current: currentPrompts.pairwiseEvaluator.hash.slice(0, 12),
      });
    }
  }
  const previousJudge = roleIdentity(previous, 'pairwiseJudge');
  const currentJudge = roleIdentity(current, 'pairwiseJudge');
  if (previousJudge.model && currentJudge.model && previousJudge.model !== currentJudge.model) {
    pairwiseComparable = false;
    findings.push({
      level: 'WARNING',
      code: 'PAIRWISE_JUDGE_MODEL_CHANGED',
      message: 'A different model judged the pairwise comparisons, so pairwise results are not the same measurement.',
      previous: previousJudge.model,
      current: currentJudge.model,
    });
  }
  if (previousJudge.provider && currentJudge.provider && previousJudge.provider !== currentJudge.provider) {
    pairwiseComparable = false;
    findings.push({
      level: 'WARNING',
      code: 'PAIRWISE_JUDGE_PROVIDER_CHANGED',
      message: 'The pairwise judge ran on a different provider, so pairwise results are not the same measurement.',
      previous: previousJudge.provider,
      current: currentJudge.provider,
    });
  }

  /* ---- versions written by a person against hashes computed from the files ---- */

  const previousVersions = previous.versions;
  const currentVersions = current.versions;
  if (previousVersions === undefined || currentVersions === undefined) {
    findings.push({
      level: 'WARNING',
      code: 'VERSIONS_UNVERIFIABLE',
      message:
        'One run does not record prompt and dataset versions, so a changed validator, reviser or pairwise ' +
        'prompt cannot be detected. Approve a fresh baseline to restore that check.',
    });
  } else {
    const named: { label: string; previous?: { version: string; hash: string }; current?: { version: string; hash: string } }[] = [
      { label: 'skill', previous: previousVersions.skill, current: currentVersions.skill },
      ...Object.keys({ ...previousPrompts, ...currentPrompts }).map((name) => ({
        label: `${name} prompt`,
        previous: previousPrompts[name],
        current: currentPrompts[name],
      })),
      ...Object.keys({ ...previousVersions.datasets, ...currentVersions.datasets }).map((name) => ({
        label: `${name} dataset`,
        previous: previousVersions.datasets[name],
        current: currentVersions.datasets[name],
      })),
    ];
    for (const item of named) {
      if (!item.previous || !item.current) continue;
      const hashChanged = item.previous.hash !== item.current.hash;
      const versionChanged = item.previous.version !== item.current.version;
      if (hashChanged && !versionChanged) {
        findings.push({
          level: 'WARNING',
          code: 'VERSION_NOT_BUMPED',
          message: `The ${item.label} changed but still says version ${item.current.version}. Bump the version in skill.json so the two runs can be told apart by name.`,
          previous: item.previous.version,
          current: item.current.version,
        });
      } else if (!hashChanged && versionChanged) {
        findings.push({
          level: 'INFO',
          code: 'VERSION_BUMPED_WITHOUT_CHANGE',
          message: `The ${item.label} version changed from ${item.previous.version} to ${item.current.version} but its content is identical.`,
          previous: item.previous.version,
          current: item.current.version,
        });
      }
    }
  }

  if (previous.dataset !== undefined && current.dataset !== undefined && previous.dataset !== current.dataset) {
    findings.push({
      level: 'INCOMPATIBLE',
      code: 'DATASET_CHANGED',
      message: 'The two runs used different datasets, so their scores are not the same measurement.',
      previous: previous.dataset,
      current: current.dataset,
    });
  }

  if (previous.gitDirty === true || current.gitDirty === true) {
    findings.push({
      level: 'INFO',
      code: 'WORKING_TREE_DIRTY',
      message:
        'At least one run was made with uncommitted changes, so its git commit does not fully describe what ran. ' +
        'The skill, prompt and dataset hashes still do.',
    });
  }

  const previousGenerator = generatorIdentity(previous);
  const currentGenerator = generatorIdentity(current);
  if (previousGenerator.model !== currentGenerator.model) {
    findings.push({
      level: 'WARNING',
      code: 'GENERATOR_MODEL_CHANGED',
      message: 'A different model produced the output, so a score difference need not come from the skill.',
      previous: previousGenerator.model,
      current: currentGenerator.model,
    });
  }
  for (const role of ['validator', 'reviser'] as const) {
    const before = roleIdentity(previous, role);
    const after = roleIdentity(current, role);
    if (before.model && after.model && before.model !== after.model) {
      findings.push({
        level: 'WARNING',
        code: `${role.toUpperCase()}_MODEL_CHANGED`,
        message: `A different model acted as the ${role}, which changes what the production pipeline returns.`,
        previous: before.model,
        current: after.model,
      });
    }
  }

  compareHashField(findings, {
    previous: previous.configHash,
    current: current.configHash,
    changedCode: 'CONFIG_CHANGED',
    changedLevel: 'WARNING',
    changedMessage:
      'The eval or runtime configuration changed. Check whether a threshold, length limit or ' +
      'forbidden-character list moved before reading the deltas.',
    unverifiableCode: 'CONFIG_UNVERIFIABLE',
    unverifiableMessage: 'One run does not record a configuration fingerprint, so config drift cannot be checked.',
  });

  /* ---- the dataset ---- */

  if (caseSet.removed.length > 0) {
    findings.push({
      level: 'INCOMPATIBLE',
      code: 'CASES_REMOVED',
      message:
        `${caseSet.removed.length} case(s) in the baseline are absent from this run, so this comparison ` +
        `covers less than the baseline did: ${caseSet.removed.join(', ')}.`,
    });
  }

  if (caseSet.added.length > 0) {
    findings.push({
      level: 'WARNING',
      code: 'CASES_ADDED',
      message:
        `${caseSet.added.length} new case(s) have no baseline to compare against and are checked on their ` +
        `own merits only: ${caseSet.added.join(', ')}.`,
    });
  }

  if (caseSet.edited.length > 0) {
    findings.push({
      level: 'INCOMPATIBLE',
      code: 'CASES_EDITED',
      message:
        `${caseSet.edited.length} case(s) kept their id but changed content, so their scores measure ` +
        `different inputs: ${caseSet.edited.join(', ')}.`,
    });
  }

  if (caseSet.renamed.length > 0) {
    findings.push({
      level: 'WARNING',
      code: 'CASES_RENAMED',
      message:
        `${caseSet.renamed.length} case(s) changed id but kept identical content, so their history is ` +
        `carried across: ${caseSet.renamed.map((r) => `${r.previousId} -> ${r.currentId}`).join(', ')}.`,
    });
  }

  if (!caseSet.contentComparable) {
    findings.push({
      level: 'WARNING',
      code: 'CASE_CONTENT_UNVERIFIABLE',
      message:
        'One run does not record per-case content fingerprints, so an edited or renamed case cannot be ' +
        'told apart from a removed and added one. Re-approve a baseline to restore that detection.',
    });
  }

  const datasetHashKnown = previous.caseInputHash !== undefined && current.caseInputHash !== undefined;
  const caseLevelDifference =
    caseSet.added.length > 0 || caseSet.removed.length > 0 || caseSet.edited.length > 0 || caseSet.renamed.length > 0;

  if (datasetHashKnown && previous.caseInputHash !== current.caseInputHash && !caseLevelDifference) {
    findings.push({
      level: 'WARNING',
      code: 'DATASET_HASH_CHANGED_WITHOUT_CASE_DIFF',
      message:
        'The dataset fingerprint differs but no case was added, removed, renamed or edited. The case ' +
        'order probably changed, which is harmless — but confirm that before trusting the deltas.',
      previous: previous.caseInputHash!.slice(0, 12),
      current: current.caseInputHash!.slice(0, 12),
    });
  } else if (!datasetHashKnown) {
    findings.push({
      level: 'WARNING',
      code: 'DATASET_HASH_UNVERIFIABLE',
      message: 'One run does not record a dataset fingerprint, so dataset drift cannot be checked directly.',
    });
  }

  if (previous.benchmarkVersion !== current.benchmarkVersion) {
    findings.push({
      level: 'WARNING',
      code: 'BENCHMARK_VERSION_CHANGED',
      message: 'The runs declare different benchmark versions, so they may not be the same suite.',
      previous: previous.benchmarkVersion,
      current: current.benchmarkVersion,
    });
  }

  const scoresComparable = !findings.some(
    (f) => f.code === 'EVALUATOR_MODEL_CHANGED' || f.code === 'EVALUATOR_PROVIDER_CHANGED' || f.code === 'RUBRIC_CHANGED'
  );

  const level: CompatibilityLevel = findings.some((f) => f.level === 'INCOMPATIBLE')
    ? 'INCOMPATIBLE'
    : findings.some((f) => f.level === 'WARNING')
    ? 'WARNING'
    : 'COMPATIBLE';

  return { level, findings, caseSet, scoresComparable, pairwiseComparable };
}
