import type { CDPSession, Frame, Page } from 'playwright-core';
import type { AgentBundle } from '../agent-bundle';

/** Playwright binding names. The agent itself talks to `__ifdyBridgeSend` (see src/agent/transport.ts). */
const BRIDGE_RAW = '__ifdyBridgeRaw';
const AXE_RAW = '__ifdyAxeRaw';
const MAX_ENVELOPE = 48 * 1024 * 1024;

/**
 * Document-start script for controlled pages (top frame only):
 *  - `__IFDY_REMOTE__` hands the agent its session nonce + flags,
 *  - `__ifdyBridgeSend` forwards agent envelopes to the companion through a Playwright binding
 *    (queued until the binding is installed, so script order never matters),
 *  - `__ifdyLoadAxe` loads axe-core through the companion (CDP, or Playwright's evaluate on engines
 *    without CDP), which works on any origin and under strict Content-Security-Policies,
 *  - followed by the agent bundle itself.
 */
export function buildInitScript(opts: { session: string; flags: string[]; agent: string }): string {
  const cfg = JSON.stringify({ session: opts.session, flags: opts.flags });
  return `(function () {
  if (window.top !== window) return;
  try {
    Object.defineProperty(window, '__IFDY_REMOTE__', { value: Object.freeze(${cfg}), configurable: false, enumerable: false, writable: false });
  } catch (e) { return; }
  var queue = [], timer = 0;
  function raw() { return window[${JSON.stringify(BRIDGE_RAW)}]; }
  function flush() {
    var f = raw();
    if (typeof f !== 'function') return false;
    while (queue.length) { try { f(queue.shift()); } catch (e) {} }
    return true;
  }
  window.__ifdyBridgeSend = function (json) {
    var f = raw();
    if (typeof f === 'function' && !queue.length) { f(json); return; }
    queue.push(json);
    if (!flush() && !timer) timer = setInterval(function () { if (flush()) { clearInterval(timer); timer = 0; } }, 10);
  };
  window.__ifdyLoadAxe = function () {
    if (window.axe) return Promise.resolve();
    var f = window[${JSON.stringify(AXE_RAW)}];
    if (typeof f !== 'function') return Promise.reject(new Error('axe-core loader is unavailable in this page.'));
    return f().then(function (r) {
      if (!window.axe) throw new Error((r && r.error) || 'axe-core could not be loaded into this page.');
    });
  };
})();
if (window.top === window) (function () {
${opts.agent}
})();
`;
}

export type EnvelopeLike = { kind?: string; event?: string; id?: number; payload?: unknown; error?: string; session?: string };

/**
 * Installs the IFDY agent into a Playwright page and relays envelopes.
 * Agent -> companion: Playwright binding (main frame only).
 * Companion -> agent: `window.__ifdyReceive(env)` evaluated in the main frame.
 */
export class AgentChannel {
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private helloWaiters: (() => void)[] = [];
  private seq = 1;
  helloCount = 0;

  constructor(
    private readonly page: Page,
    /** Chromium only; engines without CDP (WebKit) evaluate through Playwright instead. */
    private readonly cdp: CDPSession | null,
    private readonly opts: {
      session: string;
      flags: string[];
      agent: AgentBundle;
      /** Raw JSON (already validated) plus the parsed envelope when small enough to inspect. */
      onEnvelope?: (json: string, env: EnvelopeLike | null) => void;
    },
  ) {}

  async install() {
    const { page } = this;
    await page.exposeBinding(BRIDGE_RAW, (source: { frame: Frame }, json: unknown) => {
      if (source.frame !== page.mainFrame()) return;
      if (typeof json !== 'string' || json.length > MAX_ENVELOPE) return;
      let env: EnvelopeLike | null = null;
      try {
        // Always parse: validates that page-controlled input is well-formed JSON before it is
        // spliced into a websocket message.
        env = JSON.parse(json) as EnvelopeLike;
      } catch {
        return;
      }
      if (!env || typeof env !== 'object' || env.session !== this.opts.session) return;
      this.onAgentEnvelope(env);
      this.opts.onEnvelope?.(json, env);
    });
    await page.exposeBinding(AXE_RAW, async (source: { frame: Frame }) => {
      if (source.frame !== page.mainFrame()) return { ok: false, error: 'axe-core can only be loaded into the top document.' };
      try {
        const code = await this.opts.agent.getAxe();
        const expression = `${code}\n;typeof window.axe === 'object' || typeof window.axe === 'function'`;
        if (!this.cdp) {
          // Playwright evaluates through the engine's inspector protocol, so page CSP does not apply.
          const ok = await page.mainFrame().evaluate(expression);
          return ok ? { ok: true } : { ok: false, error: 'axe-core did not register on window (the page may redefine "axe" or "module").' };
        }
        const r = (await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true })) as {
          result?: { value?: unknown };
          exceptionDetails?: { text?: string; exception?: { description?: string } };
        };
        if (r.exceptionDetails) return { ok: false, error: `axe-core failed to initialise: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'unknown error'}` };
        return r.result?.value ? { ok: true } : { ok: false, error: 'axe-core did not register on window (the page may redefine "axe" or "module").' };
      } catch (err) {
        return { ok: false, error: `Could not load axe-core into this page: ${(err as Error).message}` };
      }
    });
    const agent = await this.opts.agent.get();
    await page.addInitScript({ content: buildInitScript({ session: this.opts.session, flags: this.opts.flags, agent }) });
  }

  /** Deliver a studio -> agent envelope. */
  async deliver(env: unknown): Promise<void> {
    try {
      await this.page.mainFrame().evaluate((e) => {
        const w = window as unknown as { __ifdyReceive?: (x: unknown) => void };
        if (typeof w.__ifdyReceive === 'function') w.__ifdyReceive(e);
      }, env as never);
    } catch {
      /* navigating or closed: the studio's request times out and is retried after hello */
    }
  }

  /* ---------------- server-side RPC (deterministic captures) ---------------- */

  private onAgentEnvelope(env: EnvelopeLike) {
    if (env.kind === 'event' && env.event === 'hello') {
      this.helloCount++;
      const w = this.helloWaiters;
      this.helloWaiters = [];
      w.forEach((f) => f());
    }
    if (env.kind === 'response' && typeof env.id === 'number') {
      const p = this.pending.get(env.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(env.id);
      if (env.error) p.reject(new Error(env.error));
      else p.resolve(env.payload);
    }
  }

  waitForHello(timeoutMs: number): Promise<boolean> {
    if (this.helloCount > 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      this.helloWaiters.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  call<T = unknown>(method: string, payload?: unknown, timeoutMs = 10_000): Promise<T> {
    const id = this.seq++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Agent did not answer ${method} within ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      void this.deliver({ __ifdy: 1, session: this.opts.session, kind: 'request', id, method, payload });
    });
  }

  dispose() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Page closed'));
    }
    this.pending.clear();
    this.helloWaiters = [];
  }
}
