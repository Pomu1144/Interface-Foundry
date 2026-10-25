import {
  inferIntent,
  MAX_HISTORY_TURNS,
  MAX_QUESTION_CHARS,
  MAX_REQUEST_BYTES,
  type AiStatus,
  type DiagnoseIntent,
  type DiagnoseRequest,
  type HistoryTurn,
} from '../../src/modules/ai-debugger/schema';
import type { IfdyServerConfig } from '../config';
import { createAnthropicClient, describeAnthropicError, runAnthropic, type AnthropicClientLike } from './anthropic';
import { RateLimiter } from './limits';
import { localEndpointLabel, runLocal } from './local';
import { ProviderError, type Emit, type ProviderResult } from './types';

export const PER_MINUTE = 10;
export const MAX_CONCURRENT = 2;

export const NOT_CONFIGURED = {
  anthropic: 'Anthropic is not configured: set ANTHROPIC_API_KEY and IFDY_AI_MODEL for the companion and restart.',
  local: 'No local model is configured: set IFDY_LOCAL_AI_URL (and IFDY_LOCAL_AI_MODEL) and restart.',
};

const INTENTS: DiagnoseIntent[] = ['overflow', 'posture', 'a11y', 'layout', 'general'];

export function aiStatus(config: IfdyServerConfig): AiStatus {
  return {
    providers: {
      heuristic: { available: true },
      anthropic: { configured: Boolean(config.ai.anthropicKey && config.ai.model), model: config.ai.model },
      local: { configured: Boolean(config.ai.localUrl), model: config.ai.localUrl ? config.ai.localModel ?? 'default' : null, endpoint: localEndpointLabel(config.ai.localUrl) },
    },
    limits: { maxBodyBytes: MAX_REQUEST_BYTES, perMinute: PER_MINUTE },
  };
}

/** Validate the shape of an incoming request; throws ProviderError(400) with a safe message. */
export function parseDiagnoseRequest(body: unknown): DiagnoseRequest {
  const bad = (m: string) => new ProviderError('bad_request', m, 400);
  if (!body || typeof body !== 'object') throw bad('Expected a JSON object.');
  const b = body as Record<string, unknown>;
  if (b.provider !== 'anthropic' && b.provider !== 'local') throw bad('provider must be "anthropic" or "local" (the offline engine runs in the studio).');
  const question = typeof b.question === 'string' ? b.question.trim() : '';
  if (!question) throw bad('question is required.');
  if (question.length > MAX_QUESTION_CHARS) throw bad(`question is longer than ${MAX_QUESTION_CHARS} characters.`);
  const ctx = b.context as Record<string, unknown> | undefined;
  if (!ctx || typeof ctx !== 'object' || ctx.schemaVersion !== 1 || !ctx.element || typeof ctx.element !== 'object' || !ctx.viewport) throw bad('context must be an IFDY diagnosis context (schemaVersion 1).');
  const intent = INTENTS.includes(b.intent as DiagnoseIntent) ? (b.intent as DiagnoseIntent) : inferIntent(question);
  const history: HistoryTurn[] = [];
  if (b.history !== undefined) {
    if (!Array.isArray(b.history)) throw bad('history must be a list.');
    for (const h of b.history.slice(-MAX_HISTORY_TURNS)) {
      const r = (h ?? {}) as Record<string, unknown>;
      if (typeof r.question !== 'string' || typeof r.summary !== 'string') continue;
      history.push({
        question: r.question.slice(0, MAX_QUESTION_CHARS),
        summary: r.summary.slice(0, 2000),
        fixes: Array.isArray(r.fixes) ? r.fixes.filter((x): x is string => typeof x === 'string').slice(0, 12).map((x) => x.slice(0, 200)) : [],
      });
    }
  }
  return { provider: b.provider, question, intent, context: ctx as unknown as DiagnoseRequest['context'], history };
}

export type AiServiceDeps = {
  config: IfdyServerConfig;
  /** Injected for tests; created lazily from the configured key otherwise. */
  anthropic?: AnthropicClientLike;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  limiter?: RateLimiter;
};

export function createAiService(deps: AiServiceDeps) {
  const limiter = deps.limiter ?? new RateLimiter(PER_MINUTE, MAX_CONCURRENT);
  let client = deps.anthropic ?? null;
  const fetchImpl = deps.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));

  return {
    limiter,
    status: () => aiStatus(deps.config),
    /** Why a provider cannot run (null when it is configured). */
    unconfigured(provider: DiagnoseRequest['provider']): string | null {
      const { ai } = deps.config;
      if (provider === 'anthropic' && !(ai.anthropicKey && ai.model) && !deps.anthropic) return NOT_CONFIGURED.anthropic;
      if (provider === 'local' && !ai.localUrl) return NOT_CONFIGURED.local;
      return null;
    },
    /** Run one diagnosis; progress and the result are reported through `emit`. Never logs the context. */
    async diagnose(req: DiagnoseRequest, emit: Emit, signal?: AbortSignal): Promise<ProviderResult> {
      const { ai } = deps.config;
      if (req.provider === 'anthropic') {
        if (!(ai.anthropicKey && ai.model) && !deps.anthropic) throw new ProviderError('not_configured', NOT_CONFIGURED.anthropic, 412);
        client ??= createAnthropicClient(ai.anthropicKey!);
        try {
          return await runAnthropic(client, req, ai.model, emit, signal);
        } catch (err) {
          throw describeAnthropicError(err);
        }
      }
      if (!ai.localUrl) throw new ProviderError('not_configured', NOT_CONFIGURED.local, 412);
      try {
        return await runLocal(fetchImpl, { url: ai.localUrl, model: ai.localModel ?? 'default' }, req, emit, signal);
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        throw new ProviderError('internal', 'The local provider failed unexpectedly.', 500);
      }
    },
  };
}

export type AiService = ReturnType<typeof createAiService>;
