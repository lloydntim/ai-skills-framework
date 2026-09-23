import fs from 'node:fs';
import path from 'node:path';

const REFERENCE_CV_PATH = path.join(__dirname, '..', 'reference', 'cv.md');

/**
 * True whenever the private reference CV is not on disk: in an exported copy of this skill (the
 * export leaves reference/ out as a whole, see scripts/export-skill.ts, because everything in it
 * is the candidate's: their CVs, their profile and the eval cases built from their CV), and
 * equally in an ordinary public checkout that never had a private reference/ mounted into it —
 * that is a supported state, not something that requires export-manifest.json to be present. The
 * tests that check against that material are skipped in both cases.
 */
export const referenceLeftOutByExport = !fs.existsSync(REFERENCE_CV_PATH);

/**
 * The reference CV is not an input to letter writing: letters are written from whatever CV is
 * pasted into the conversation. It exists so the phrase bank can be validated against a known CV,
 * because a phrase whose evidence has left the CV is a false claim waiting to be sent.
 */
export function loadReferenceCv(cvPath: string = REFERENCE_CV_PATH): string {
  if (!fs.existsSync(cvPath)) {
    throw new Error(`Reference CV not found at ${cvPath}`);
  }
  return fs.readFileSync(cvPath, 'utf-8');
}

const REFERENCE_CV_DE_PATH = path.join(__dirname, '..', 'reference', 'cv-de.md');

/**
 * Both language versions joined, for use as ground truth when checking a letter.
 *
 * They describe one career, so a claim evidenced by either is evidenced. It matters in both
 * directions: a German letter naming an English tool ("Spec-Driven Development") is supported by
 * the English CV, and an English letter naming a client that only the German CV spells out is
 * supported by that one. Checking against a single language would report the other's facts as
 * fabrications.
 */
export function loadAllReferenceCvs(): string {
  const parts = [loadReferenceCv()];
  if (fs.existsSync(REFERENCE_CV_DE_PATH)) {
    parts.push(fs.readFileSync(REFERENCE_CV_DE_PATH, 'utf-8'));
  }
  return parts.join('\n\n');
}
