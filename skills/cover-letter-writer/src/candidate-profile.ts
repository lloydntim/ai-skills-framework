import fs from 'node:fs';
import path from 'node:path';

/**
 * Everything about the candidate the skill writes for, kept out of the skill itself.
 *
 * SKILL.md holds the rules and marks each candidate-specific piece as a {{PLACEHOLDER}}: their
 * name, contact details, right-to-work status, evidence from their CV, their voice and their
 * preferences. The profile is a Markdown file with one `## KEY` section per placeholder, and the
 * skill loader fills them with the same renderTemplate the prompt files use. A few keys are read
 * by code as well (see CODE_PROFILE_KEYS).
 *
 * The real profile is private: it lives in reference/, which the export never includes.
 * candidate-profile.example.md is a synthetic one that documents every key and backs the tests.
 */
export type CandidateProfile = Record<string, string>;

/** The candidate's own profile. Private, never exported. */
export const PRIVATE_PROFILE_PATH = path.join(__dirname, '..', 'reference', 'candidate-profile.md');

/** A fictional candidate, public, used by the tests and as a starting point for a new profile. */
export const EXAMPLE_PROFILE_PATH = path.join(__dirname, '..', 'candidate-profile.example.md');

/**
 * Where the profile is read from when no path is given. COVER_LETTER_PROFILE lets it live outside
 * the repository; the tests point it at the example so they never depend on private data.
 */
export function defaultProfilePath(): string {
  return process.env.COVER_LETTER_PROFILE || PRIVATE_PROFILE_PATH;
}

/** Keys read by code rather than filled into SKILL.md. Every profile must carry them. */
export const CODE_PROFILE_KEYS = [
  'CANDIDATE_NAME',
  'EMAIL',
  'UK_LOCATION',
  'UK_PHONE',
  'DACH_LOCATION',
  'DACH_PHONE',
  'UK_RIGHT_TO_WORK_WORDINGS',
  'IE_RIGHT_TO_WORK_WORDINGS',
] as const;

const SECTION = /^## ([A-Z][A-Z0-9_]*)[ \t]*$/gm;

/**
 * Splits a profile into its sections. Text before the first `## KEY` heading is a description of
 * the file and is ignored. Blank lines around a value are dropped; everything inside it is kept
 * exactly, since most values are pasted into the skill as they stand.
 */
export function parseCandidateProfile(raw: string): CandidateProfile {
  const headings = [...raw.matchAll(SECTION)];
  const profile: CandidateProfile = {};
  headings.forEach((heading, i) => {
    const key = heading[1];
    if (key in profile) throw new Error(`Candidate profile has two "## ${key}" sections`);
    const start = heading.index! + heading[0].length;
    const end = i + 1 < headings.length ? headings[i + 1].index! : raw.length;
    profile[key] = raw.slice(start, end).replace(/^\n+|\n+$/g, '');
  });
  return profile;
}

export function loadCandidateProfile(file: string = defaultProfilePath()): CandidateProfile {
  if (!fs.existsSync(file)) {
    throw new Error(
      `Candidate profile not found at ${file}. Copy candidate-profile.example.md to ` +
        'reference/candidate-profile.md (or point COVER_LETTER_PROFILE at a copy) and fill it in ' +
        "with the candidate's own details.",
    );
  }
  const profile = parseCandidateProfile(fs.readFileSync(file, 'utf-8'));
  const missing = CODE_PROFILE_KEYS.filter((key) => !profile[key]);
  if (missing.length > 0) throw new Error(`Candidate profile ${file} has no value for: ${missing.join(', ')}`);
  return profile;
}
