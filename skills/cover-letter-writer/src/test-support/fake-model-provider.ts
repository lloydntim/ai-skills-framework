import type { GenerationRequest, GenerationResult, ModelProvider } from '@skills/framework/provider/types';

type QueuedItem = { kind: 'response'; result: GenerationResult } | { kind: 'error'; error: Error };

/**
 * A ModelProvider that makes no external requests. Responses and errors are queued in advance and
 * returned/thrown in order, one per call to generate(), so a test can script an exact multi-call
 * pipeline (generate, validate, revise, revalidate, ...) including a failure partway through it.
 */
export class FakeModelProvider implements ModelProvider {
  private readonly queue: QueuedItem[] = [];
  public readonly requests: GenerationRequest[] = [];

  /** Queues a successful result for the next call to generate(). Returns `this` for chaining. */
  queueResponse(result: GenerationResult): this {
    this.queue.push({ kind: 'response', result });
    return this;
  }

  /** Queues an error to be thrown from the next call to generate(). Returns `this` for chaining. */
  queueError(error: Error): this {
    this.queue.push({ kind: 'error', error });
    return this;
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    this.requests.push(request);
    const next = this.queue.shift();
    if (!next) {
      throw new Error(`FakeModelProvider: no response queued for call #${this.requests.length}`);
    }
    if (next.kind === 'error') {
      throw next.error;
    }
    return next.result;
  }

  get callCount(): number {
    return this.requests.length;
  }
}
