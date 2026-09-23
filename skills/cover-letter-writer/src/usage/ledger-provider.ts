import type { GenerationRequest, GenerationResult, ModelProvider } from '@skills/framework/provider/types';
import { recordUsage } from './store';

/**
 * Wraps any ModelProvider and records every call (success or failure) to the usage ledger in
 * data/usage/*.jsonl. This is Cover Letter Writer's own record of spend; it sits outside the
 * framework provider on purpose, so the framework has no knowledge of it.
 */
export class LedgerProvider implements ModelProvider {
  constructor(
    private readonly inner: ModelProvider,
    private readonly providerName: string
  ) {}

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const start = Date.now();
    const tool = request.metadata?.requestType ?? 'unclassified';
    try {
      const result = await this.inner.generate(request);
      recordUsage({
        source: 'writer',
        tool,
        provider: this.providerName,
        model: request.model,
        status: 'success',
        durationMs: result.latencyMs ?? Date.now() - start,
        usage: result.usage
          ? {
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              totalTokens: result.usage.totalTokens,
            }
          : undefined,
        estimatedCost: result.cost,
      });
      return result;
    } catch (err) {
      recordUsage({
        source: 'writer',
        tool,
        provider: this.providerName,
        model: request.model,
        status: 'failure',
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
