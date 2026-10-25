import { DIAGNOSIS_JSON_SCHEMA, extractJson, validateDiagnosis, type DiagnoseRequest } from '../../src/modules/ai-debugger/schema';
import { buildConversation, SYSTEM_PROMPT } from './prompt';
import { ProviderError, type Emit, type ProviderResult } from './types';

/**
 * Local provider: an explicitly configured OpenAI-compatible /chat/completions
 * endpoint (llama.cpp, Ollama, LM Studio, vLLM…). JSON output is requested with a
 * JSON schema (falling back to json_object for servers that do not support
 * schemas) and validated with the same validator as the Anthropic path.
 */

export type LocalConfig = { url: string; model: string };
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export const LOCAL_TIMEOUT_MS = 180_000;

/** IFDY_LOCAL_AI_URL is the OpenAI base URL (e.g. http://localhost:11434/v1) or the full /chat/completions URL. */
export function localEndpoint(url: string): string {
  const u = url.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(u) ? u : `${u}/chat/completions`;
}

/** Host shown in the UI (never includes credentials or query strings). */
export function localEndpointLabel(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return 'configured endpoint';
  }
}

export function buildLocalBody(req: DiagnoseRequest, model: string, mode: 'json_schema' | 'json_object', extra: { role: 'user' | 'assistant'; content: string }[] = []) {
  return {
    model,
    temperature: 0,
    stream: false,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...buildConversation(req), ...extra],
    response_format:
      mode === 'json_schema'
        ? { type: 'json_schema', json_schema: { name: 'ifdy_diagnosis', strict: true, schema: DIAGNOSIS_JSON_SCHEMA } }
        : { type: 'json_object' },
  };
}

async function post(fetchImpl: FetchLike, endpoint: string, body: unknown, signal: AbortSignal): Promise<{ status: number; json: unknown; text: string }> {
  let res: Response;
  try {
    res = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError' || (err as Error).name === 'TimeoutError') throw new ProviderError('timeout', 'The local model did not answer in time.', 504);
    throw new ProviderError('network', 'Could not reach the local model endpoint (IFDY_LOCAL_AI_URL).', 502);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text };
}

function contentOf(json: unknown): string | null {
  const choice = (json as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0];
  const c = choice?.message?.content;
  return typeof c === 'string' ? c : null;
}

export async function runLocal(fetchImpl: FetchLike, cfg: LocalConfig, req: DiagnoseRequest, emit: Emit, signal?: AbortSignal): Promise<ProviderResult> {
  const endpoint = localEndpoint(cfg.url);
  const timeout = AbortSignal.timeout(LOCAL_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  emit({ type: 'progress', stage: 'sending', message: `Sending to local model ${cfg.model}` });
  let mode: 'json_schema' | 'json_object' = 'json_schema';
  let r = await post(fetchImpl, endpoint, buildLocalBody(req, cfg.model, mode), combined);
  if (r.status === 400 || r.status === 422) {
    // Older OpenAI-compatible servers reject json_schema; retry with plain JSON mode.
    mode = 'json_object';
    r = await post(fetchImpl, endpoint, buildLocalBody(req, cfg.model, mode), combined);
  }
  if (r.status >= 400) throw new ProviderError('upstream', `The local model endpoint returned HTTP ${r.status}.`, 502);
  let content = contentOf(r.json);
  if (content === null) throw new ProviderError('invalid_output', 'The local model response had no message content.');
  emit({ type: 'progress', stage: 'validating', message: 'Validating against the diagnosis schema', chars: content.length });
  let result = validateDiagnosis(extractJson(content));
  if (!result.ok) {
    // One repair round-trip: show the model its validation errors.
    emit({ type: 'progress', stage: 'repairing', message: 'Output failed validation; asking the model to repair it' });
    const extra = [
      { role: 'assistant' as const, content: content.slice(0, 20000) },
      { role: 'user' as const, content: `Your previous output failed validation: ${result.errors.join('; ')}. Return only the corrected JSON object that matches the schema.` },
    ];
    r = await post(fetchImpl, endpoint, buildLocalBody(req, cfg.model, mode, extra), combined);
    if (r.status >= 400) throw new ProviderError('upstream', `The local model endpoint returned HTTP ${r.status}.`, 502);
    content = contentOf(r.json);
    if (content === null) throw new ProviderError('invalid_output', 'The local model response had no message content.');
    result = validateDiagnosis(extractJson(content));
    if (!result.ok) throw new ProviderError('invalid_output', `The local model output failed validation: ${result.errors.join('; ')}`);
    result.repairs.unshift('repaired by a second model round-trip');
  }
  const model = (r.json as { model?: unknown } | null)?.model;
  return { diagnosis: result.value, repairs: result.repairs, model: cfg.model, servedBy: typeof model === 'string' ? model : undefined };
}
