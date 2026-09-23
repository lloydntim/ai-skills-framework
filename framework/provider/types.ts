import type { RequestMetadata } from './request-metadata';

export interface GenerationRequest {
  systemPrompt?: string;
  userPrompt: string;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
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
