import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MODEL_ROLES } from '../provider/model-roles';

/** Writes a file inside a skill folder, creating folders as needed. */
export function writeSkillFile(skillDir: string, rel: string, content: string): void {
  const file = path.join(skillDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Creates a small temporary skill that follows the standard, and returns its folder. */
export function makeSkillDir(name = 'demo-skill'): string {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skill-')), name);
  const write = (rel: string, content: string) => writeSkillFile(dir, rel, content);
  write('SKILL.md', '# Demo\nRules.');
  write('README.md', '# Demo');
  write(
    'skill.json',
    JSON.stringify({
      name,
      version: '1.0.0',
      description: 'A demo',
      domain: 'test',
      prompts: {
        validator: { file: 'prompts/validator.md', version: '1' },
        evaluator: { file: 'prompts/evaluator.md', version: '1' },
      },
      datasets: { golden: { dir: 'evals/cases/golden', version: '1' } },
    })
  );
  write('prompts/validator.md', '## System\nBe strict.\n\n## Task\nCheck {{OUTPUT}}\n');
  write('prompts/evaluator.md', 'Score {{OUTPUT}}\n');
  write('evals/cases/golden/a.json', JSON.stringify([{ id: 'c1', input: 'x' }]));
  write(
    'config/models.json',
    JSON.stringify(Object.fromEntries(MODEL_ROLES.map((r) => [r, { provider: 'anthropic', model: 'm' }])))
  );
  write('src/thing.test.ts', "import { it } from 'vitest'; it('x', () => {});");
  return dir;
}
