import type { ServerResponse } from 'node:http';
import { MAX_REQUEST_BYTES, type DiagnoseEvent } from '../../src/modules/ai-debugger/schema';
import { createAiService, parseDiagnoseRequest, type AiService } from '../ai/service';
import { ProviderError } from '../ai/types';
import { HttpError, readJson } from '../http';
import type { Router } from '../router';
import type { IfdyServices } from '../services';

/**
 * AI layout debugger routes.
 *
 *   GET  /api/ai/status    providers configured + model (never the key)
 *   POST /api/ai/diagnose  Server-Sent Events: progress… then result | error
 *
 * Request bodies (page context) are never logged or persisted.
 */
export function registerAiRoutes(router: Router, services: IfdyServices) {
  const ai = createAiService({ config: services.config });
  services.registry.set('ai', ai);

  router.get('/api/ai/status', () => ai.status());

  router.post('/api/ai/diagnose', async ({ req, res }) => {
    const slot = ai.limiter.tryAcquire();
    if (!slot.ok) {
      res.setHeader('Retry-After', String(slot.retryAfterSec));
      throw new HttpError(429, slot.reason);
    }
    try {
      let body: unknown;
      try {
        body = await readJson(req, MAX_REQUEST_BYTES);
      } catch (err) {
        if (err instanceof HttpError && err.status === 413) throw new HttpError(413, `Diagnosis context is larger than ${Math.round(MAX_REQUEST_BYTES / 1024)} KB.`);
        throw err;
      }
      let parsed;
      try {
        parsed = parseDiagnoseRequest(body);
      } catch (err) {
        throw new HttpError(err instanceof ProviderError ? err.status : 400, (err as Error).message);
      }
      await streamDiagnosis(ai, parsed, res);
    } finally {
      slot.release();
    }
    return undefined;
  });
}

async function streamDiagnosis(ai: AiService, parsed: ReturnType<typeof parseDiagnoseRequest>, res: ServerResponse) {
  const controller = new AbortController();
  const started = Date.now();
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = (e: DiagnoseEvent) => {
    if (!res.writableEnded) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  };
  const ping = setInterval(() => !res.writableEnded && res.write(': ping\n\n'), 15_000);
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  send({ type: 'progress', stage: 'queued', message: 'Request accepted' });
  try {
    const result = await ai.diagnose(parsed, send, controller.signal);
    send({ type: 'result', diagnosis: result.diagnosis, provider: parsed.provider, model: result.model, servedBy: result.servedBy, repairs: result.repairs, durationMs: Date.now() - started, usage: result.usage });
  } catch (err) {
    const pe = err instanceof ProviderError ? err : new ProviderError('internal', 'The AI provider failed unexpectedly.', 500);
    send({ type: 'error', message: pe.message, code: pe.code });
  } finally {
    clearInterval(ping);
    res.end();
  }
}
