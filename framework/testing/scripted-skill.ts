import type { RequestType } from '../provider/request-metadata';
import type { ModelRole } from '../provider/model-roles';
import type { RuntimeSkill, Step } from '../runtime/skill';

async function ask(step: Step<string, undefined>, role: ModelRole, requestType: RequestType): Promise<string> {
  const handle = step.roles[role];
  const result = await handle.provider.generate({ userPrompt: step.input, model: handle.model, metadata: { requestType } });
  return result.text;
}

/**
 * A minimal skill for testing the runtime with a queued fake provider: the generator and reviser
 * return whatever the provider says, and the validator passes a draft when the provider answers
 * exactly "PASS" and asks for a revision otherwise (the reply becomes the issue message).
 * Any step can be replaced through `overrides`.
 */
export function scriptedSkill(
  overrides: Partial<RuntimeSkill<string, undefined, string>> = {}
): RuntimeSkill<string, undefined, string> {
  return {
    name: 'scripted',
    generate: (step) => ask(step, 'generator', 'initial-generation'),
    async validate(step, _draft, phase) {
      const verdict = await ask(step, 'validator', phase === 'initial' ? 'semantic-validation' : 'revalidation');
      return {
        detail: verdict,
        decision:
          verdict === 'PASS'
            ? { status: 'pass' }
            : { status: 'revise', issues: [{ source: 'semantic', code: 'not-good', message: verdict }] },
      };
    },
    revise: (step) => ask(step, 'reviser', 'revision'),
    ...overrides,
  };
}
