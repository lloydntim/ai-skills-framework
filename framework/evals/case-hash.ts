import { hashObject } from '../hash';

/**
 * Fingerprints everything about a case *except* its id.
 *
 * Recorded on every persisted CaseResult so a later regression comparison can tell three situations
 * apart that otherwise all look like "the case list changed":
 *   - same id, different hash   -> the case body was edited, so its scores are not comparable
 *   - different id, same hash   -> the case was renamed, and its history should carry over
 *   - id present on one side only, with no hash match -> genuinely added or removed
 *
 * The id is excluded deliberately: including it would make every rename look like an edit, which is
 * the distinction this hash exists to draw.
 */
export function hashCase(kase: { id: string }): string {
  const { id: _id, ...content } = kase;
  return hashObject(content);
}
