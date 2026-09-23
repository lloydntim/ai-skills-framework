import type { GenerationRequest, GenerationResult, ModelProvider } from '../provider/types';

/**
 * A ModelProvider that returns one canned response regardless of the request, for testing a
 * single judge call (semantic validator, evaluator, pairwise evaluator) with no network access.
 */
export class SingleResponseProvider implements ModelProvider {
  public lastRequest?: GenerationRequest;

  constructor(private readonly response: GenerationResult) {}

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    this.lastRequest = request;
    return this.response;
  }
}
