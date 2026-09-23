import type { RequestMetadata } from './request-metadata';
import type { ReasoningEffort } from './role-runtime';

export interface GenerationRequest {
  systemPrompt?: string;
  userPrompt: string;
  model: string;
  temperature?: number;
  /**
   * Ceiling for one call's output, covering the model's reasoning as well as its visible answer.
   * Normally supplied by the calling role's runtime configuration rather than by the call site —
   * see role-runtime.ts.
   */
  maxOutputTokens?: number;
  /**
   * How hard this call should think, on the provider-neutral ladder in role-runtime.ts. Set by the
   * role, not by the call site. Absent means "say nothing about reasoning", leaving whatever the
   * provider does by default — which for current Claude models is adaptive thinking.
   */
  reasoning?: ReasoningEffort;
  /**
   * What this request is for. Purely descriptive: providers ignore it, and attaching it does not
   * change the call. Absent metadata is recorded as "unclassified" rather than dropped.
   */
  metadata?: RequestMetadata;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}

export interface GenerationResult {
  text: string;
  usage?: TokenUsage;
  latencyMs?: number;
  cost?: number;
}

export interface ModelProvider {
  generate(request: GenerationRequest): Promise<GenerationResult>;
}
