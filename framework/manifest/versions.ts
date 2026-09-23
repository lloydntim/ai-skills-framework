import path from 'node:path';
import { sha256, hashObject } from '../hash';
import { loadCases } from '../evals/cases-loader';
import { SKILL_FILE, loadManifest } from './skill-manifest';
import { resolveDatasetDir, type DatasetSource } from './dataset-resolver';
import fs from 'node:fs';

export interface VersionedFile {
  version: string;
  hash: string;
}

export interface VersionedDataset extends VersionedFile {
  caseCount: number;
  /**
   * Which manifest field the hash was actually computed from. Optional so a run saved before this
   * field existed still loads. Two runs of the same declared dataset name/version can still have
   * legitimately different content -- one against private reference cases, the other against the
   * public fallback -- and this is what keeps them from looking like the same measurement.
   */
  source?: DatasetSource;
}

/**
 * Everything about a skill that a person versions, with the hash computed from the file itself.
 * Saved in every eval run so a later reader can tell exactly what ran. The version says what the
 * author intended; the hash says what the bytes were.
 */
export interface RunVersions {
  skill: VersionedFile & { name: string };
  prompts: Record<string, VersionedFile>;
  datasets: Record<string, VersionedDataset>;
}

export function snapshotVersions(skillDir: string): RunVersions {
  const manifest = loadManifest(skillDir);

  const prompts: RunVersions['prompts'] = {};
  for (const [name, entry] of Object.entries(manifest.prompts)) {
    if (!entry) continue;
    prompts[name] = { version: entry.version, hash: sha256(fs.readFileSync(path.join(skillDir, entry.file), 'utf-8')) };
  }

  const datasets: RunVersions['datasets'] = {};
  for (const [name, entry] of Object.entries(manifest.datasets)) {
    if (!entry) continue;
    const resolved = resolveDatasetDir(skillDir, entry);
    const cases = loadCases<{ id: string }>(resolved.dir);
    datasets[name] = { version: entry.version, hash: hashObject(cases), caseCount: cases.length, source: resolved.source };
  }

  return {
    skill: {
      name: manifest.name,
      version: manifest.version,
      hash: sha256(fs.readFileSync(path.join(skillDir, SKILL_FILE), 'utf-8')),
    },
    prompts,
    datasets,
  };
}
