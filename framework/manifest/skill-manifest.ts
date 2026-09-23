import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const Prompt = z.strictObject({ file: z.string().min(1), version: z.string().min(1) });
const Dataset = z.strictObject({ dir: z.string().min(1), version: z.string().min(1) });

/**
 * skill.json: the one file that says what a skill is and which of its parts are versioned.
 * Versions are written by a person. Hashes are computed from the files (see versions.ts).
 * Unknown keys are errors, so a typo cannot silently drop a prompt from version tracking.
 */
export const SkillManifestSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'use lower-case words joined by hyphens'),
  version: z.string().min(1),
  description: z.string().min(1),
  /** A free label for grouping skills, e.g. "cv", "job-search", "code". */
  domain: z.string().min(1),
  prompts: z.strictObject({
    baseline: Prompt.optional(),
    validator: Prompt.optional(),
    reviser: Prompt.optional(),
    evaluator: Prompt.optional(),
    pairwiseEvaluator: Prompt.optional(),
  }),
  datasets: z.strictObject({
    benchmark: Dataset.optional(),
    golden: Dataset.optional(),
  }),
  export: z.strictObject({ exclude: z.array(z.string()) }).default({ exclude: [] }),
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;
export type PromptName = keyof SkillManifest['prompts'];
export type DatasetName = keyof SkillManifest['datasets'];

export const MANIFEST_FILE = 'skill.json';
export const SKILL_FILE = 'SKILL.md';

export function loadManifest(skillDir: string): SkillManifest {
  const file = path.join(skillDir, MANIFEST_FILE);
  if (!fs.existsSync(file)) throw new Error(`No ${MANIFEST_FILE} in ${skillDir}`);
  const parsed = SkillManifestSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf-8')));
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid ${file}:\n  ${problems.join('\n  ')}`);
  }
  return parsed.data;
}
