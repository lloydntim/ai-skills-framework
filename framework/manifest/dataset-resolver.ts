import fs from 'node:fs';
import path from 'node:path';

/** Which manifest field a resolved dataset directory came from. */
export type DatasetSource = 'declared' | 'fallback';

export interface ResolvedDataset {
  /** Absolute path to the directory that should actually be loaded. */
  dir: string;
  source: DatasetSource;
}

export interface DatasetEntry {
  dir: string;
  publicDir?: string;
}

/**
 * The single place that turns a `skill.json` dataset entry into the directory to actually load.
 * Most skills only ever get `declared` back, since their one dataset dir always exists. A skill
 * that splits private regression material (under `reference/`, never mounted in a public checkout)
 * from a synthetic public set declares `publicDir` too, and resolution falls back to it when the
 * declared `dir` is absent -- the same fallback cover-letter-writer's evals already relied on, now
 * shared with anything that snapshots or checks a skill's datasets.
 */
export function resolveDatasetDir(skillDir: string, entry: DatasetEntry): ResolvedDataset {
  const declaredDir = path.join(skillDir, entry.dir);
  if (fs.existsSync(declaredDir)) return { dir: declaredDir, source: 'declared' };

  if (entry.publicDir) {
    const fallbackDir = path.join(skillDir, entry.publicDir);
    if (fs.existsSync(fallbackDir)) return { dir: fallbackDir, source: 'fallback' };
    throw new Error(
      `Neither the declared dataset dir "${entry.dir}" nor its fallback "${entry.publicDir}" exists under ${skillDir}.`
    );
  }

  throw new Error(`The declared dataset dir "${entry.dir}" does not exist under ${skillDir}.`);
}
