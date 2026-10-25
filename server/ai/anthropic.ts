import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, BetaMessageStreamParams, BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { DIAGNOSIS_JSON_SCHEMA, extractJson, validateDiagnosis, type DiagnoseRequest } from '../../src/modules/ai-debugger/schema';
import { buildConversation, SYSTEM_PROMPT } from './prompt';
import { ProviderError, type Emit, type ProviderResult } from './types';

/**
 * Anthropic provider: Claude via the official SDK, streamed, with structured
 * outputs (output_config.format = JSON schema) and server-side validation.
 * The API key only ever lives in the companion process.
 */

/** The subset of the SDK client this provider uses (lets tests inject a mock). */
export type AnthropicStreamHandle = AsyncIterable<BetaRawMessageStreamEvent> & { finalMessage(): Promise<BetaMessage> };
export type AnthropicClientLike = {
  beta: { messages: { stream(body: BetaMessageStreamParams, options?: { signal?: AbortSignal }): AnthropicStreamHandle } };
};

export const ANTHROPIC_MAX_TOKENS = 64000;

export function createAnthropicClient(apiKey: string): AnthropicClientLike {
  // logLevel 'off': the SDK must never print request bodies (they contain page context).
  return new Anthropic({ apiKey, maxRetries: 2, logLevel: 'off' }) as unknown as AnthropicClientLike;
}

export function buildAnthropicParams(req: DiagnoseRequest, model: string): BetaMessageStreamParams {
  return {
    model,
    max_tokens: ANTHROPIC_MAX_TOKENS,
    // Server-side refusal fallback: "default" routes a declined request to the recommended model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: DIAGNOSIS_JSON_SCHEMA as unknown as Record<string, unknown> } },
    system: SYSTEM_PROMPT,
    messages: buildConversation(req).map((t) => ({ role: t.role, content: t.content })),
  };
}

export async function runAnthropic(client: AnthropicClientLike, req: DiagnoseRequest, model: string, emit: Emit, signal?: AbortSignal): Promise<ProviderResult> {
  const params = buildAnthropicParams(req, model);
  emit({ type: 'progress', stage: 'sending', message: `Sending to ${model}` });
  const stream = client.beta.messages.stream(params, { signal });
  let chars = 0;
  let thinking = '';
  let last = 0;
  const throttled = (fn: () => void) => {
    const now = Date.now();
    if (now - last > 150) {
      last = now;
      fn();
    }
  };
  for await (const event of stream) {
    if (event.type === 'content_block_start') {
      if (event.content_block.type === 'thinking') emit({ type: 'progress', stage: 'thinking', message: 'Claude is reasoning about the layout' });
      else if (event.content_block.type === 'text') emit({ type: 'progress', stage: 'writing', message: 'Writing the diagnosis', chars });
    } else if (event.type === 'content_block_delta') {
      if (event.delta.type === 'text_delta') {
        chars += event.delta.text.length;
        throttled(() => emit({ type: 'progress', stage: 'writing', message: 'Writing the diagnosis', chars }));
      } else if (event.delta.type === 'thinking_delta') {
        thinking = (thinking + event.delta.thinking).slice(-280);
        throttled(() => emit({ type: 'progress', stage: 'thinking', message: 'Claude is reasoning about the layout', thinking }));
      }
    }
  }
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') {
    const category = message.stop_details?.category;
    throw new ProviderError('refusal', `Claude declined this request${category ? ` (${category})` : ''}. Try rephrasing or use the offline engine.`);
  }
  if (message.stop_reason === 'max_tokens') throw new ProviderError('truncated', 'The response reached the output limit before the diagnosis was complete.');
  const text = message.content
    .filter((b): b is Extract<BetaMessage['content'][number], { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
  emit({ type: 'progress', stage: 'validating', message: 'Validating against the diagnosis schema', chars });
  const parsed = extractJson(text);
  const result = validateDiagnosis(parsed);
  if (!result.ok) throw new ProviderError('invalid_output', `The model output failed validation: ${result.errors.join('; ')}`);
  return {
    diagnosis: result.value,
    repairs: result.repairs,
    model,
    servedBy: message.model,
    usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
  };
}

/** Map SDK errors to messages that are safe to show (they never include the request body). */
export function describeAnthropicError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new ProviderError('aborted', 'Request cancelled.', 499);
  if (err instanceof Anthropic.AuthenticationError) return new ProviderError('auth', 'Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY on the companion.', 502);
  if (err instanceof Anthropic.PermissionDeniedError) return new ProviderError('permission', 'The API key is not allowed to use this model (403).', 502);
  if (err instanceof Anthropic.NotFoundError) return new ProviderError('model', 'Model not found (404). Check IFDY_AI_MODEL.', 502);
  if (err instanceof Anthropic.RateLimitError) return new ProviderError('rate_limit', 'Anthropic rate limit reached (429). Wait a moment and retry.', 429);
  if (err instanceof Anthropic.BadRequestError) return new ProviderError('bad_request', `Anthropic rejected the request (400): ${shortMessage(err)}`, 502);
  if (err instanceof Anthropic.InternalServerError) return new ProviderError('upstream', `Anthropic is temporarily unavailable (${err.status}). Retry shortly.`, 502);
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError('network', 'Could not reach the Anthropic API from the companion.', 502);
  if (err instanceof Anthropic.APIError) return new ProviderError('api', `Anthropic API error ${err.status ?? ''}`.trim(), 502);
  return new ProviderError('internal', 'The AI provider failed unexpectedly.', 500);
}

function shortMessage(err: { message: string }) {
  return err.message.replace(/\s+/g, ' ').slice(0, 200);
}
