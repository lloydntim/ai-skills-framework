import fs from 'node:fs';
import path from 'node:path';
import { loadCases } from '../evals/cases-loader';
import { MODEL_ROLES } from '../provider/model-roles';
import { parsePromptFile } from '../prompts/prompt-file';
import { importSpecifiers } from './imports';
import { loadManifest, SKILL_FILE } from './skill-manifest';

const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) tsFiles(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * The same checks for every skill, so any skill can be opened and found where it should be.
 * Returns a list of problems; an empty list means the package follows the standard.
 * No model is called.
 */
export function checkSkillPackage(skillDir: string): string[] {
  const problems: string[] = [];
  const need = (condition: boolean, message: string) => {
    if (!condition) problems.push(message);
  };

  let manifest;
  try {
    manifest = loadManifest(skillDir);
  } catch (err) {
    return [err instanceof Error ? err.message : String(err)];
  }

  need(manifest.name === path.basename(skillDir), `skill.json name "${manifest.name}" must match the folder name "${path.basename(skillDir)}"`);

  for (const required of [SKILL_FILE, 'README.md']) {
    const file = path.join(skillDir, required);
    need(fs.existsSync(file) && fs.readFileSync(file, 'utf-8').trim().length > 0, `${required} is missing or empty`);
  }

  for (const [name, entry] of Object.entries(manifest.prompts)) {
    if (!entry) continue;
    const file = path.join(skillDir, entry.file);
    if (!fs.existsSync(file)) {
      problems.push(`prompt "${name}": ${entry.file} does not exist`);
      continue;
    }
    try {
      const parsed = parsePromptFile(fs.readFileSync(file, 'utf-8'));
      need(parsed.task.trim().length > 0 || !!parsed.system, `prompt "${name}": ${entry.file} is empty`);
    } catch (err) {
      problems.push(`prompt "${name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const [name, entry] of Object.entries(manifest.datasets)) {
    if (!entry) continue;
    const dir = path.join(skillDir, entry.dir);
    // A dataset under reference/ is the candidate's private regression material (see
    // scripts/export-skill.ts's PRIVATE_DIRS): it is never exported, and a public checkout never
    // has it mounted. That absence is a supported environment condition, not a structural defect
    // in the skill package, so it is skipped here rather than reported. Any other missing or
    // malformed dataset is still a real problem.
    if (entry.dir.startsWith('reference/') && !fs.existsSync(dir)) continue;
    try {
      const cases = loadCases<{ id: string }>(dir);
      need(cases.length > 0, `dataset "${name}": ${entry.dir} has no cases`);
    } catch (err) {
      problems.push(`dataset "${name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // A skill that declares prompts has a model pipeline, so every role needs a model. A skill that
  // is only instructions has no roles to configure and needs no models.json.
  const modelsFile = path.join(skillDir, 'config', 'models.json');
  const hasPipeline = Object.values(manifest.prompts).some(Boolean);
  if (!fs.existsSync(modelsFile)) {
    if (hasPipeline) problems.push('config/models.json is missing');
  } else {
    const models = JSON.parse(fs.readFileSync(modelsFile, 'utf-8')) as Record<string, { provider?: string; model?: string }>;
    for (const role of MODEL_ROLES) {
      const entry = models[role];
      need(!!entry?.provider && !!entry?.model, `config/models.json: role "${role}" needs a provider and a model`);
    }
    for (const extra of Object.keys(models).filter((k) => !(MODEL_ROLES as readonly string[]).includes(k))) {
      problems.push(`config/models.json: "${extra}" is not a known role (${MODEL_ROLES.join(', ')})`);
    }
  }

  const files = tsFiles(skillDir);
  need(files.some((f) => f.endsWith('.test.ts')), 'the skill has no tests (*.test.ts)');

  // A skill may import its own files and @skills/framework, nothing else.
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf-8');
    for (const spec of importSpecifiers(source)) {
      if (spec.startsWith('.')) {
        const target = path.resolve(path.dirname(file), spec);
        const inside = target === skillDir || target.startsWith(skillDir + path.sep);
        if (!inside) problems.push(`${path.relative(skillDir, file)} imports ${spec}, which is outside the skill folder`);
      } else if (spec.startsWith('@skills/') && !spec.startsWith('@skills/framework')) {
        problems.push(`${path.relative(skillDir, file)} imports ${spec.split('/').slice(0, 2).join('/')}; only @skills/framework is allowed`);
      }
    }
  }

  return problems;
}
