import type { AgentEvents } from '@shared/protocol';

/** Tiny typed event bus for cross-module notifications that should not live in the store. */
export type BusEvents = {
  'agent-key': AgentEvents['key'] & { instanceId: string };
  'agent-wheel': AgentEvents['wheel'] & { instanceId: string };
  'agent-scroll': AgentEvents['scroll'] & { instanceId: string };
  'preview-hello': { instanceId: string };
  'selection-changed': { instanceId: string | null; nodeId: number | null };
  'run-tests': void;
  'run-audits': void;
  'capture': { kind: 'raster' | 'chromium' };
  'reveal-in-editor': { file: string; line?: number };
  'ai-diagnose': { nodeId?: number };
  toast: { message: string; tone?: 'info' | 'success' | 'warning' | 'error' };
};

type Handler<T> = (payload: T) => void;
const handlers = new Map<keyof BusEvents, Set<Handler<unknown>>>();

export const bus = {
  on<K extends keyof BusEvents>(event: K, h: Handler<BusEvents[K]>): () => void {
    const set = handlers.get(event) ?? new Set();
    set.add(h as Handler<unknown>);
    handlers.set(event, set);
    return () => set.delete(h as Handler<unknown>);
  },
  emit<K extends keyof BusEvents>(event: K, ...payload: BusEvents[K] extends void ? [] : [BusEvents[K]]) {
    handlers.get(event)?.forEach((h) => {
      try {
        h(payload[0]);
      } catch (err) {
        console.error('[ifdy] bus handler', event, err);
      }
    });
  },
};
