import fs from 'node:fs';
import path from 'node:path';

/**
 * Loads every *.json file in a directory. Each file holds an array of cases. A case is whatever
 * the skill needs, as long as it has an `id`. Files are read in name order so the result (and any
 * hash of it) does not depend on how the operating system lists a folder.
 */
export function loadCases<T extends { id: string }>(dir: string): T[] {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const cases: T[] = [];
  // caseId -> the file it was first seen in, so a duplicate can be reported instead of silently
  // corrupting every downstream lookup keyed by case id (hashing, regression comparison, per-case
  // token aggregation all assume ids are unique within a directory).
  const seenIn = new Map<string, string>();
  for (const file of files) {
    const content: T[] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
    for (const kase of content) {
      const existingFile = seenIn.get(kase.id);
      if (existingFile) {
        throw new Error(
          `Duplicate case id "${kase.id}" in ${file} (already defined in ${existingFile}). Case ids must be unique within ${dir}.`
        );
      }
      seenIn.set(kase.id, file);
    }
    cases.push(...content);
  }
  return cases;
}
