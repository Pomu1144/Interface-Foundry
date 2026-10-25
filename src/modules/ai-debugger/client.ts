import { studio } from '@/store';
import { api } from '@/modules/project-adapter/server-api';
import type { AiStatus, DiagnoseEvent, DiagnoseRequest } from './schema';

/** Companion AI endpoints. The API key never reaches the browser; only provider status does. */

export async function fetchAiStatus(): Promise<AiStatus> {
  return api<AiStatus>('/api/ai/status');
}

async function token(): Promise<string | null> {
  const t = studio().server.token;
  if (t) return t;
  try {
    const r = await fetch('/api/bootstrap', { cache: 'no-store' });
    return r.ok ? ((await r.json()) as { token: string }).token : null;
  } catch {
    return null;
  }
}

/** Parse a Server-Sent Events text buffer; returns parsed events and the unconsumed remainder. */
export function parseSse(buffer: string): { events: DiagnoseEvent[]; rest: string } {
  const events: DiagnoseEvent[] = [];
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? '';
  for (const block of parts) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    try {
      events.push(JSON.parse(data) as DiagnoseEvent);
    } catch {
      /* ignore malformed frames */
    }
  }
  return { events, rest };
}

/** POST a diagnosis and stream its events. Resolves when the stream ends. */
export async function streamDiagnose(req: DiagnoseRequest, onEvent: (e: DiagnoseEvent) => void, signal: AbortSignal): Promise<void> {
  const t = await token();
  if (!t) throw new Error('The IFDY companion is not running, so Claude and local models are unavailable. The offline engine still works.');
  const res = await fetch('/api/ai/diagnose', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'x-ifdy-token': t },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok || !res.body) {
    let message = `${res.status} ${res.statusText}`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* not json */
    }
    throw new Error(message);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSse(buffer);
    buffer = rest;
    events.forEach(onEvent);
  }
  const { events } = parseSse(buffer + '\n\n');
  events.forEach(onEvent);
}
