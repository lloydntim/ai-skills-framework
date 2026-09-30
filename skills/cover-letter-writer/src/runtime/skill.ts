import { loadManifest } from '@skills/framework/manifest/skill-manifest';
import type { RuntimeSkill } from '@skills/framework/runtime/skill';
import type { ValidationDecision, ValidationIssue } from '@skills/framework/runtime/validation';
import { SKILL_DIR } from '../skill-dir';
import { generateDraft, skillSystemPrompt } from './generate';
import { DIMENSION_LABELS, deterministicIssues, reviseDraft } from './revise';
import type { CoverLetterTaskInput, RuntimeConfig, ValidationResult } from './types';
import { validateDraft } from './validate';

export const SKILL_NAME = 'cover-letter-writer';

/**
 * Reduces this skill's validation to what the runtime acts on. The codes are fixed identifiers (a
 * deterministic rule's name, or a score dimension); the messages are the sentences the reviser is
 * given and can quote the CV or the letter, so they stay out of traces (see framework/runtime/trace.ts).
 *
 * The deterministic layer keeps its findings in structured fields, so which layer raised what is
 * read straight from the result: the skill's domain result needed nothing added for this.
 */
export function toDecision(validation: ValidationResult): ValidationDecision {
  if (validation.pass) return { status: 'pass' };

  const deterministic: ValidationIssue[] = deterministicIssues(validation.deterministic).map((issue) => ({ source: 'deterministic', ...issue }));
  const judged: ValidationIssue[] = validation.judgeHardGuardrailFailures.map((message) => ({ source: 'semantic', code: 'guardrail', message }));
  const scores: ValidationIssue[] = validation.failingCriteria.map((dimension) => ({ source: 'semantic', code: dimension, message: DIMENSION_LABELS[dimension] }));

  // Everything this skill can fail on is fixable by another draft, so it always asks for a revision.
  return { status: 'revise', issues: [...deterministic, ...judged, ...scores] };
}

/**
 * Cover Letter Writer as the runtime sees it: the generate, validate and revise steps the skill has
 * always had, handed the runtime's roles instead of looping over them itself. The loop, the retry
 * cap, usage accounting and tracing are the runtime's; the prompts, the checks and the thresholds
 * stay here.
 *
 * `config` is the skill's own runtime-config.json (temperature, thresholds, skill context). The
 * revision cap is not read from it here: the caller passes it as a per-run option, so it takes
 * precedence over skill.json and the runtime defaults like any other per-run setting.
 */
export function coverLetterSkill(config: RuntimeConfig, skillPath?: string): RuntimeSkill<CoverLetterTaskInput, undefined, ValidationResult> {
  const manifest = loadManifest(SKILL_DIR);

  return {
    name: SKILL_NAME,
    settings: manifest.runtime,
    tools: manifest.tools,

    // SKILL.md, with the candidate profile filled in, is what every generation and revision call
    // sends as its system prompt. Assembling it here means a missing skill file or an unfilled
    // profile is a CONTEXT_ERROR before any model is called.
    prepare(input) {
      skillSystemPrompt(input, config, skillPath);
      return undefined;
    },

    async generate({ input, roles }) {
      const { provider, model } = roles.generator;
      return (await generateDraft(input, provider, model, config, 'skill', skillPath)).text;
    },

    async validate({ input, roles }, draft, phase) {
      const { provider, model } = roles.validator;
      const detail = await validateDraft(input, draft, provider, model, config, phase === 'initial' ? 'semantic-validation' : 'revalidation');
      return { detail, decision: toDecision(detail) };
    },

    async revise({ input, roles }, draft, previous) {
      const { provider, model } = roles.reviser;
      return (await reviseDraft(input, draft, previous.detail, provider, model, config, skillPath)).text;
    },
  };
}
