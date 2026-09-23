import path from 'node:path';
import { loadCases as loadCasesFrom } from '@skills/framework/evals/cases-loader';
import { resolveDatasetDir } from '@skills/framework/manifest/dataset-resolver';
import { loadManifest } from '@skills/framework/manifest/skill-manifest';
import { SKILL_DIR } from '../src/skill-dir';
import type { EvalCase } from './types';
import type { DeterministicCheckInput } from '../src/deterministic-checks';
import { parsePhraseBank, type StandardPhrase } from '../src/phrase-bank';
import { parsePreferenceBank } from '../src/preference-bank';

/**
 * The private golden and benchmark cases are built from the candidate's real CV, so they are
 * private regression inputs and live in reference/, which the export never includes and which a
 * public checkout never has mounted. Where they exist, they are what real regression work runs
 * against. Where they do not, each directory falls back to the public, synthetic case set in
 * evals/cases/ (built on candidate-profile.example.md), so a public checkout is never left with
 * zero cases: `pnpm eval` and `pnpm eval:regression` still have something real to run, and the
 * structural properties the private cases exist to protect are still exercised. skill.json is the
 * one place that declares both dirs; `resolveDatasetDir` (shared with `snapshotVersions` and
 * `checkSkillPackage`) is what actually chooses between them, so this file does not re-implement
 * the fallback.
 */
const PUBLIC_CASES_DIR = path.join(__dirname, 'cases');

function resolveCasesDir(name: 'golden' | 'benchmark'): string {
  const entry = loadManifest(SKILL_DIR).datasets[name];
  if (!entry) throw new Error(`skill.json does not declare a "${name}" dataset`);
  return resolveDatasetDir(SKILL_DIR, entry).dir;
}

export const GOLDEN_DIR = resolveCasesDir('golden');
export const BENCHMARK_DIR = resolveCasesDir('benchmark');

/** The public, synthetic case directories specifically, regardless of whether reference/ exists. */
export const PUBLIC_GOLDEN_DIR = path.join(PUBLIC_CASES_DIR, 'golden');
export const PUBLIC_BENCHMARK_DIR = path.join(PUBLIC_CASES_DIR, 'benchmark');

export const loadCases = (dir: string): EvalCase[] => loadCasesFrom<EvalCase>(dir);

/**
 * Turns a case plus a drafted letter into the input for the mechanical checks. Keeping this in one
 * place means a case's expectations and the checks that enforce them cannot drift apart.
 */
export function toCheckInput(
  evalCase: EvalCase,
  output: string,
  standardPhrases: StandardPhrase[] = parsePhraseBank(),
): DeterministicCheckInput {
  return {
    output,
    cvText: evalCase.cvText,
    roleDescription: evalCase.roleDescription,
    standardPhrases,
    preferences: parsePreferenceBank(),
    requiredExactStrings: evalCase.requiredExactStrings,
    requiredTerms: evalCase.requiredTerms,
    forbiddenClaims: evalCase.forbiddenClaims,
    allowedTechnologies: evalCase.allowedTechnologies,
    allowedNumbers: evalCase.allowedNumbers,
    templateLanguage: evalCase.templateLanguage,
    minWords: evalCase.minWords,
    maxWords: evalCase.maxWords,
  };
}
