import { loadManifest } from '@skills/framework/manifest/skill-manifest';
import type { RuntimeSkill } from '@skills/framework/runtime/skill';
import type { ValidationDecision, ValidationIssue } from '@skills/framework/runtime/validation';
import { SKILL_DIR } from '../skill-dir';
import { loadSkillPrompt } from '../skill-loader';
import { generateDraft } from './generate';
import { reviseDraft } from './revise';
import type { CvTaskInput, RuntimeConfig, ValidationResult } from './types';
import { validateDraftWithSources, type GuardrailSources } from './validator';

export const SKILL_NAME = 'cv-translator';

/** Criteria the deterministic checks raise; every other failing criterion is a score from the model judge. */
const DETERMINISTIC_CRITERIA = new Set(['length', 'repetition']);

/**
 * Reduces this skill's validation to what the runtime acts on. The codes are fixed identifiers (the
 * criterion's name); the messages are the same sentences the reviser is given and may quote the CV,
 * so they stay out of traces (see framework/runtime/trace.ts). `sources` says which layer raised
 * each guardrail failure; it exists for this labelling and is not part of the skill's own result.
 */
export function toDecision(validation: ValidationResult, sources: GuardrailSources): ValidationDecision {
  if (validation.pass) return { status: 'pass' };

  const guardrails: ValidationIssue[] = [
    ...sources.deterministic.map((message): ValidationIssue => ({ source: 'deterministic', code: 'guardrail', message })),
    ...sources.judge.map((message): ValidationIssue => ({ source: 'semantic', code: 'guardrail', message })),
  ];
  const criteria: ValidationIssue[] = validation.failingCriteria.map((criterion) => ({
    source: DETERMINISTIC_CRITERIA.has(criterion) ? 'deterministic' : 'semantic',
    code: criterion,
    message: `failing criterion: ${criterion}`,
  }));

  // Everything this skill can fail on is fixable by another draft, so it always asks for a revision.
  return { status: 'revise', issues: [...guardrails, ...criteria] };
}

/**
 * CV Translator as the runtime sees it: the same generate, validate and revise steps the skill has
 * always had, handed the runtime's roles instead of looping over them itself. The loop, the retry
 * cap, usage accounting and tracing are the runtime's; the prompts, the checks and the thresholds
 * stay here.
 *
 * `config` is the skill's own runtime-config.json (temperature, thresholds, length ratio). The
 * revision cap is not read from it here: the caller passes it as a per-run option, so it takes
 * precedence over skill.json and the runtime defaults like any other per-run setting.
 */
export function cvTranslatorSkill(config: RuntimeConfig, skillPath?: string): RuntimeSkill<CvTaskInput, undefined, ValidationResult> {
  const manifest = loadManifest(SKILL_DIR);

  return {
    name: SKILL_NAME,
    settings: manifest.runtime,
    tools: manifest.tools,

    // SKILL.md is what every generation and revision call sends as its system prompt. Reading it
    // here means a missing file is a CONTEXT_ERROR before any model is called.
    prepare() {
      loadSkillPrompt(skillPath);
      return undefined;
    },

    async generate({ input, roles }) {
      const { provider, model } = roles.generator;
      return (await generateDraft(input, provider, model, config, 'skill', skillPath)).text;
    },

    async validate({ input, roles }, draft, phase) {
      const { provider, model } = roles.validator;
      const { result, sources } = await validateDraftWithSources(
        input,
        draft,
        provider,
        model,
        config,
        phase === 'initial' ? 'semantic-validation' : 'revalidation'
      );
      return { detail: result, decision: toDecision(result, sources) };
    },

    async revise({ input, roles }, draft, previous) {
      const { provider, model } = roles.reviser;
      return (await reviseDraft(input, draft, previous.detail, provider, model, config, skillPath)).text;
    },
  };
}
