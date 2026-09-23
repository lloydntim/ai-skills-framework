import { parseJsonResponse } from '@skills/framework/llm-json-response';
import type { PromptComponentSize } from '@skills/framework/provider/request-metadata';
import type { ModelProvider } from '@skills/framework/provider/types';
import { renderTemplate } from '@skills/framework/prompts/prompt-file';
import { evaluatorPrompt } from '../src/prompts';
import { EvaluatorScoreResponseSchema } from './evaluator-schema';
import type { EvalCase, QualityScore } from './types';

export interface EvaluatorConfig {
  model: string;
  temperature: number;
}

export async function evaluateQuality(
  kase: EvalCase,
  outputText: string,
  provider: ModelProvider,
  config: EvaluatorConfig
): Promise<QualityScore> {
  const prompt = renderTemplate(evaluatorPrompt.task, {
    SOURCE: kase.input,
    INSTRUCTIONS: kase.instructions,
    OUTPUT: outputText,
    TARGET_LANGUAGE: kase.targetLanguage,
    TARGET_MARKET: kase.targetMarket ?? 'not specified',
    EXPECTED_FACTS: (kase.expectedFacts ?? []).join('; ') || 'none listed',
    FORBIDDEN_CLAIMS: (kase.forbiddenClaims ?? []).join('; ') || 'none listed',
  });

  const components: PromptComponentSize[] = [
    { component: 'evaluator-rubric', chars: evaluatorPrompt.task.length },
    { component: 'case-input', chars: kase.input.length },
    { component: 'candidate-outputs', chars: outputText.length },
  ];

  const result = await provider.generate({
    systemPrompt: evaluatorPrompt.system,
    userPrompt: prompt,
    model: config.model,
    temperature: config.temperature,
    metadata: { requestType: 'evaluator', components },
  });

  const parsed = parseJsonResponse(result.text, EvaluatorScoreResponseSchema, 'Evaluator');

  return {
    faithfulness: parsed.faithfulness,
    naturalness: parsed.naturalness,
    cvQuality: parsed.cvQuality,
    terminology: parsed.terminology,
    conciseness: parsed.conciseness,
    overall: parsed.overall,
    justification: parsed.justification ?? '',
    problems: parsed.problems ?? [],
    missingExpectedFacts: parsed.missingExpectedFacts ?? [],
    unsupportedClaims: parsed.unsupportedClaims ?? [],
    seniorityInflationNotes: parsed.seniorityInflationNotes ?? [],
    terminologyProblems: parsed.terminologyProblems ?? [],
    naturalnessProblems: parsed.naturalnessProblems ?? [],
  };
}
