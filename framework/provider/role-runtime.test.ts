import { describe, expect, it } from 'vitest';
import { resolveModelRoles } from './registry';
import {
  DEFAULT_ROLE_RUNTIME,
  MAX_ALLOWED_OUTPUT_TOKENS,
  MIN_ALLOWED_OUTPUT_TOKENS,
  RoleRuntimeConfigError,
  RoleRuntimeProvider,
  parseRoleRuntime,
} from './role-runtime';
import type { GenerationRequest, GenerationResult, ModelProvider } from './types';

/** Records what it was asked for and answers with a fixed string. Makes no API call. */
class RecordingProvider implements ModelProvider {
  readonly requests: GenerationRequest[] = [];
  async generate(request: GenerationRequest): Promise<GenerationResult> {
    this.requests.push(request);
    return { text: 'ok' };
  }
}

const BASE = { provider: 'fake', model: 'fake-model' };
const CONFIG = {
  generator: { ...BASE },
  validator: { ...BASE },
  reviser: { ...BASE },
  evaluator: { ...BASE },
  pairwiseJudge: { ...BASE },
};

describe('parseRoleRuntime', () => {
  const defaults = DEFAULT_ROLE_RUNTIME.validator;

  it('takes the role default for a field the config does not mention', () => {
    expect(parseRoleRuntime('validator', {}, defaults)).toEqual(defaults);
  });

  it('takes an authored value over the default, for each field independently', () => {
    expect(parseRoleRuntime('validator', { reasoning: 'max' }, defaults)).toEqual({
      reasoning: 'max',
      maxOutputTokens: defaults.maxOutputTokens,
    });
    expect(parseRoleRuntime('validator', { maxOutputTokens: 12_000 }, defaults)).toEqual({
      reasoning: defaults.reasoning,
      maxOutputTokens: 12_000,
    });
  });

  it('rejects an unknown reasoning level instead of quietly using the default', () => {
    // A typo that silently became the default is exactly what a later run would be misattributed to.
    expect(() => parseRoleRuntime('validator', { reasoning: 'hi' }, defaults)).toThrow(RoleRuntimeConfigError);
    expect(() => parseRoleRuntime('validator', { reasoning: 'hi' }, defaults)).toThrow(/unknown "reasoning" value/);
    expect(() => parseRoleRuntime('validator', { reasoning: 'hi' }, defaults)).toThrow(/none, low, medium, high, xhigh, max/);
  });

  it('rejects a budget that is not a whole number of tokens', () => {
    expect(() => parseRoleRuntime('validator', { maxOutputTokens: '8000' }, defaults)).toThrow(/non-integer/);
    expect(() => parseRoleRuntime('validator', { maxOutputTokens: 8000.5 }, defaults)).toThrow(/non-integer/);
  });

  it('rejects a budget outside the range a single non-streaming request can honour', () => {
    expect(() => parseRoleRuntime('validator', { maxOutputTokens: MIN_ALLOWED_OUTPUT_TOKENS - 1 }, defaults)).toThrow(
      /outside the allowed range/
    );
    expect(() => parseRoleRuntime('validator', { maxOutputTokens: MAX_ALLOWED_OUTPUT_TOKENS + 1 }, defaults)).toThrow(
      /needs a streaming request/
    );
    expect(() => parseRoleRuntime('validator', { maxOutputTokens: MAX_ALLOWED_OUTPUT_TOKENS }, defaults)).not.toThrow();
  });

  it('names the role in every message, so a bad entry in a five-role file is findable', () => {
    expect(() => parseRoleRuntime('pairwiseJudge', { reasoning: 'nope' }, defaults)).toThrow(/pairwiseJudge/);
  });
});

describe('DEFAULT_ROLE_RUNTIME', () => {
  it('gives every role a budget that can hold reasoning as well as an answer', () => {
    // The original failure was a 2,000-token budget that reasoning consumed entirely. Nothing here
    // may quietly drift back under that.
    for (const [role, runtime] of Object.entries(DEFAULT_ROLE_RUNTIME)) {
      expect(runtime.maxOutputTokens, role).toBeGreaterThan(2_000);
      expect(runtime.maxOutputTokens, role).toBeLessThanOrEqual(MAX_ALLOWED_OUTPUT_TOKENS);
    }
  });

  it('never disables reasoning by default for any role', () => {
    // Disabling thinking was the experiment-local workaround, not the production fix: on Claude
    // Opus 5 it leaks <thinking> tags and tool-call syntax into visible text.
    for (const [role, runtime] of Object.entries(DEFAULT_ROLE_RUNTIME)) {
      expect(runtime.reasoning, role).not.toBe('none');
    }
  });

  it('gives the roles that write the deliverable more room than the roles that score it', () => {
    expect(DEFAULT_ROLE_RUNTIME.generator.maxOutputTokens).toBeGreaterThan(DEFAULT_ROLE_RUNTIME.validator.maxOutputTokens);
    expect(DEFAULT_ROLE_RUNTIME.reviser).toEqual(DEFAULT_ROLE_RUNTIME.generator);
    expect(DEFAULT_ROLE_RUNTIME.evaluator).toEqual(DEFAULT_ROLE_RUNTIME.validator);
    expect(DEFAULT_ROLE_RUNTIME.pairwiseJudge).toEqual(DEFAULT_ROLE_RUNTIME.validator);
  });
});

describe('RoleRuntimeProvider', () => {
  it("attaches the role's reasoning level to a request that says nothing about reasoning", async () => {
    const inner = new RecordingProvider();
    const provider = new RoleRuntimeProvider(inner, { reasoning: 'low', maxOutputTokens: 8_000 });

    await provider.generate({ userPrompt: 'hi', model: 'm' });

    expect(inner.requests[0].reasoning).toBe('low');
    expect(inner.requests[0].maxOutputTokens).toBe(8_000);
  });

  it("raises a call site's budget up to the role's, since the role is what knows about reasoning", async () => {
    const inner = new RecordingProvider();
    const provider = new RoleRuntimeProvider(inner, { reasoning: 'medium', maxOutputTokens: 8_000 });

    // 2,000 is the kind of number written before reasoning existed — the one that caused the failure.
    await provider.generate({ userPrompt: 'hi', model: 'm', maxOutputTokens: 2_000 });

    expect(inner.requests[0].maxOutputTokens).toBe(8_000);
  });

  it("leaves a call site's larger budget alone: it is asking for a longer answer, not a smaller one", async () => {
    const inner = new RecordingProvider();
    const provider = new RoleRuntimeProvider(inner, { reasoning: 'medium', maxOutputTokens: 8_000 });

    await provider.generate({ userPrompt: 'hi', model: 'm', maxOutputTokens: 20_000 });

    expect(inner.requests[0].maxOutputTokens).toBe(20_000);
  });

  it('passes everything else through untouched', async () => {
    const inner = new RecordingProvider();
    const provider = new RoleRuntimeProvider(inner, { reasoning: 'high', maxOutputTokens: 16_000 });

    await provider.generate({
      systemPrompt: 'sys',
      userPrompt: 'hi',
      model: 'm',
      temperature: 0.3,
      metadata: { requestType: 'revision' },
    });

    expect(inner.requests[0]).toMatchObject({
      systemPrompt: 'sys',
      userPrompt: 'hi',
      model: 'm',
      temperature: 0.3,
      metadata: { requestType: 'revision' },
    });
  });
});

describe('role-specific runtime configuration, end to end through the registry', () => {
  it('sends a different reasoning level and budget for a writing role than for a scoring role', async () => {
    const inner = new RecordingProvider();
    const roles = resolveModelRoles(
      {
        ...CONFIG,
        generator: { ...BASE, reasoning: 'max', maxOutputTokens: 24_000 },
        validator: { ...BASE, reasoning: 'low', maxOutputTokens: 4_000 },
      },
      { fake: () => inner }
    );

    await roles.generator.provider.generate({ userPrompt: 'write', model: 'fake-model' });
    await roles.validator.provider.generate({ userPrompt: 'score', model: 'fake-model' });

    expect(inner.requests[0]).toMatchObject({ reasoning: 'max', maxOutputTokens: 24_000 });
    expect(inner.requests[1]).toMatchObject({ reasoning: 'low', maxOutputTokens: 4_000 });
  });

  it('applies the framework defaults per role when the config names no runtime settings', async () => {
    const inner = new RecordingProvider();
    const roles = resolveModelRoles(CONFIG, { fake: () => inner });

    await roles.reviser.provider.generate({ userPrompt: 'revise', model: 'fake-model' });
    await roles.pairwiseJudge.provider.generate({ userPrompt: 'judge', model: 'fake-model' });

    expect(inner.requests[0]).toMatchObject(DEFAULT_ROLE_RUNTIME.reviser);
    expect(inner.requests[1]).toMatchObject(DEFAULT_ROLE_RUNTIME.pairwiseJudge);
  });

  it('reports an unusable runtime setting as a configuration error, before any provider is called', () => {
    const inner = new RecordingProvider();

    expect(() =>
      resolveModelRoles({ ...CONFIG, evaluator: { ...BASE, reasoning: 'highest' } }, { fake: () => inner })
    ).toThrow(/evaluator/);
    expect(inner.requests).toHaveLength(0);
  });
});
