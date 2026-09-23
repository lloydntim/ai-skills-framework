import type { GenerationRequest, GenerationResult, ModelProvider } from '../provider/types';

/**
 * Returns one queued GenerationResult per call, in order, so a test can script an exact multi-call
 * pipeline (generate, validate, revise, revalidate, ...) without ever making a real network/API call.
 */
export class QueuedResponseProvider implements ModelProvider {
  private nextCall = 0;
  public readonly requests: GenerationRequest[] = [];

  constructor(private readonly responses: GenerationResult[]) {}

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    this.requests.push(request);
    const response = this.responses[this.nextCall];
    if (!response) {
      throw new Error(`QueuedResponseProvider: no response queued for call #${this.nextCall + 1}`);
    }
    this.nextCall += 1;
    return response;
  }

  get callCount(): number {
    return this.nextCall;
  }
}
