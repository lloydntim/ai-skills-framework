import fs from 'node:fs';
import path from 'node:path';

const TEMPLATE_PATH = path.join(__dirname, '..', 'SKILL.md');
const BLUEPRINT_PATH = path.join(__dirname, '..', 'docs', 'skill-framework-blueprint.md');

export type FrameworkVariant = 'A' | 'B';

/**
 * Variant A: a plain model with no access to the skill-framework skill at all, the baseline that
 * proves whether the skill is earning its keep (blueprint 7.7). Variant B: the same model with the
 * canonical, portable skill-framework instructions plus its blueprint loaded as system context,
 * exactly what any Agent-Skills-compatible host would hand the model after loading this skill.
 */
export function buildSystemPrompt(variant: FrameworkVariant): string {
  if (variant === 'A') {
    return (
      'You are a general-purpose assistant. You do not have access to any specialized skill, ' +
      'plugin, or reference document for structuring or evaluating model skills. Answer the ' +
      "user's question using only general judgement."
    );
  }

  if (!fs.existsSync(TEMPLATE_PATH) || !fs.existsSync(BLUEPRINT_PATH)) {
    throw new Error('Canonical skill-framework template or blueprint not found; cannot build variant B.');
  }

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  const blueprint = fs.readFileSync(BLUEPRINT_PATH, 'utf-8');

  return [
    template,
    '',
    '--- reference/blueprint.md ---',
    '',
    blueprint,
  ].join('\n');
}
