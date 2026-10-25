import { ENVELOPE_TAG, PROTOCOL_VERSION, isEnvelope, type AgentEvent, type AgentEvents, type AgentMethod, type AgentMethods, type Envelope } from '@shared/protocol';

/**
 * Studio side of the agent protocol. One PreviewConnection exists per preview
 * instance (canvas device, compare partner, wall tile, background worker).
 */
export interface StudioTransport {
  send(env: Envelope): void;
  /** Called by the connection to receive envelopes. */
  listen(handler: (env: Envelope) => void): () => void;
  dispose(): void;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export class PreviewConnection {
  private seq = 1;
  private pending = new Map<number, Pending>();
  private handlers = new Map<string, Set<(payload: unknown) => void>>();
  private unlisten: () => void;
  ready = false;

  constructor(
    public readonly id: string,
    public readonly session: string,
    private transport: StudioTransport,
  ) {
    this.unlisten = transport.listen((env) => this.receive(env));
  }

  call<M extends AgentMethod>(method: M, params?: AgentMethods[M][0], timeoutMs = 10_000): Promise<AgentMethods[M][1]> {
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Preview did not answer ${method} within ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.transport.send({ [ENVELOPE_TAG]: PROTOCOL_VERSION, session: this.session, kind: 'request', id, method, payload: params });
    });
  }

  /** Fire-and-forget call that swallows errors (used for broadcast state sync). */
  tell<M extends AgentMethod>(method: M, params?: AgentMethods[M][0]) {
    this.call(method, params).catch(() => {});
  }

  on<E extends AgentEvent>(event: E, handler: (payload: AgentEvents[E]) => void): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as (p: unknown) => void);
    this.handlers.set(event, set);
    return () => set.delete(handler as (p: unknown) => void);
  }

  private receive(env: Envelope) {
    if (!isEnvelope(env) || env.session !== this.session) return;
    if (env.kind === 'response' && env.id !== undefined) {
      const p = this.pending.get(env.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(env.id);
      if (env.error) p.reject(new Error(env.error));
      else p.resolve(env.payload);
      return;
    }
    if (env.kind === 'event' && env.event) {
      if (env.event === 'hello') this.ready = true;
      this.handlers.get(env.event)?.forEach((h) => {
        try {
          h(env.payload);
        } catch (err) {
          console.error('[ifdy] handler for', env.event, err);
        }
      });
    }
  }

  /** Reject in-flight calls, e.g. when the page navigates or reloads. */
  resetPending(reason: string) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
      this.pending.delete(id);
    }
    this.ready = false;
  }

  dispose() {
    this.resetPending('Preview closed');
    this.unlisten();
    this.transport.dispose();
    this.handlers.clear();
  }
}

/* ------------------------------------------------------------------ */
/* iframe transport                                                    */
/* ------------------------------------------------------------------ */

type FrameListener = { session: string; frame: () => HTMLIFrameElement | null; origin: () => string; handler: (env: Envelope) => void };
const frameListeners = new Map<string, FrameListener>();
let globalInstalled = false;

function installGlobalListener() {
  if (globalInstalled) return;
  globalInstalled = true;
  window.addEventListener('message', (e: MessageEvent) => {
    const data = e.data;
    if (!isEnvelope(data)) return;
    const l = frameListeners.get(data.session);
    if (!l) return;
    const frame = l.frame();
    // Only accept messages from the exact iframe window and expected origin.
    if (!frame || e.source !== frame.contentWindow) return;
    const origin = l.origin();
    if (origin !== '*' && e.origin !== origin) return;
    l.handler(data);
  });
}

export function createFrameTransport(session: string, frame: () => HTMLIFrameElement | null, origin: () => string): StudioTransport {
  installGlobalListener();
  return {
    send(env) {
      const win = frame()?.contentWindow;
      const target = origin();
      // Opaque-origin (sandboxed without allow-same-origin) frames can only be addressed with '*'.
      if (win) win.postMessage(env, target === '*' || target === 'null' ? '*' : target);
    },
    listen(handler) {
      frameListeners.set(session, { session, frame, origin, handler });
      return () => frameListeners.delete(session);
    },
    dispose() {
      frameListeners.delete(session);
    },
  };
}

export function newSession(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
