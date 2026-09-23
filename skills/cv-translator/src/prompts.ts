import path from 'node:path';
import { readPromptFile } from '@skills/framework/prompts/prompt-file';

/** Every prompt this skill sends to a model, read once from prompts/. skill.json lists their versions. */
const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');

const load = (name: string) => readPromptFile(path.join(PROMPTS_DIR, `${name}.md`));

export const validatorPrompt = load('validator');
export const reviserPrompt = load('reviser');
export const evaluatorPrompt = load('evaluator');
export const pairwiseEvaluatorPrompt = load('pairwise-evaluator');

/** The plain system prompt used for the "no skill" variant. */
export const baselineSystemPrompt = load('baseline').system ?? '';
