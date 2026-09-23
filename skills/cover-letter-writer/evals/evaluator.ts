import { parseJsonResponse } from '@skills/framework/llm-json-response';
import type { PromptComponentSize } from '@skills/framework/provider/request-metadata';
import type { ModelProvider, TokenUsage } from '@skills/framework/provider/types';
import { renderTemplate } from '@skills/framework/prompts/prompt-file';
import { evaluatorPrompt } from '../src/prompts';
import { caseInputChars } from '../src/runtime/generate';
import { EvaluatorScoreResponseSchema } from './evaluator-schema';
import type { EvalCase, QualityScore } from './types';

export interface EvaluatorConfig {
  model: string;
  temperature: number;
}

export interface EvaluationOutcome {
  quality: QualityScore;
  /** Actual usage/latency/cost from this judge call, never estimated. */
  usage?: TokenUsage;
  latencyMs?: number;
  cost?: number;
}

/**
 * The offline, single-output evaluator: scores one variant's output on the cover-letter rubric
 * in prompts/evaluator.md, blind to which configuration produced it. Distinct from the
 * production semantic validator (src/runtime/validate.ts) — that one gates pass/fail for a single
 * pipeline run; this one is a comparative quality lens across every variant in a benchmark run.
 */
export async function evaluateQuality(
  kase: EvalCase,
  outputText: string,
  provider: ModelProvider,
  config: EvaluatorConfig
): Promise<EvaluationOutcome> {
  const prompt = renderTemplate(evaluatorPrompt.task, {
    CV: kase.cvText,
    ROLE_DESCRIPTION: kase.roleDescription,
    INSTRUCTIONS: kase.instructions,
    LANGUAGE: kase.language,
    EXPECTED_FACTS: (kase.expectedFacts ?? []).join('; ') || 'none listed',
    FORBIDDEN_CLAIMS: (kase.forbiddenClaims ?? []).join('; ') || 'none listed',
    OUTPUT: outputText,
  });

  const components: PromptComponentSize[] = [
    { component: 'evaluator-rubric', chars: evaluatorPrompt.task.length },
    { component: 'case-input', chars: caseInputChars(kase) },
    { component: 'candidate-outputs', chars: outputText.length },
  ];

  const result = await provider.generate({
    systemPrompt: evaluatorPrompt.system,
    userPrompt: prompt,
    model: config.model,
    temperature: config.temperature,
    maxOutputTokens: 2000,
    metadata: { requestType: 'evaluator', components },
  });

  const parsed = parseJsonResponse(result.text, EvaluatorScoreResponseSchema, 'Evaluator');

  const quality: QualityScore = {
    factualGrounding: parsed.factualGrounding,
    jobRelevance: parsed.jobRelevance,
    professionalTone: parsed.professionalTone,
    specificity: parsed.specificity,
    naturalness: parsed.naturalness,
    conciseness: parsed.conciseness,
    overall: parsed.overall,
    justification: parsed.justification ?? '',
    problems: parsed.problems ?? [],
    missingExpectedFacts: parsed.missingExpectedFacts ?? [],
    unsupportedClaims: parsed.unsupportedClaims ?? [],
    ownershipInflationNotes: parsed.ownershipInflationNotes ?? [],
    unofferedBenefitNotes: parsed.unofferedBenefitNotes ?? [],
  };

  return { quality, usage: result.usage, latencyMs: result.latencyMs, cost: result.cost };
}
