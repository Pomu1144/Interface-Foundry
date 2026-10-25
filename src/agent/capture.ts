import type { AgentEvents } from '@shared/protocol';
import type { LogLevel } from '@shared/types';

type Emit = <E extends keyof AgentEvents>(event: E, payload: AgentEvents[E]) => void;

const SECRET_KV = /((?:pass(?:word)?|passwd|pwd|token|secret|authorization|api[_-]?key|session(?:id)?|ssn|cvv)["']?\s*[:=]\s*["']?)([^\s"',;&}]+)/gi;

export function redactText(s: string): string {
  return s.replace(SECRET_KV, '$1[redacted]');
}

const SENSITIVE_PARAMS = /^(token|access_token|id_token|password|pass|pwd|key|api_key|apikey|auth|session|sessionid|sid|ssn|account|acct|code|secret|signature|sig)$/i;

export function redactUrl(url: string): { url: string; redacted: boolean } {
  try {
    const u = new URL(url, location.href);
    let redacted = false;
    for (const k of [...u.searchParams.keys()]) {
      if (SENSITIVE_PARAMS.test(k)) {
        u.searchParams.set(k, 'REDACTED');
        redacted = true;
      }
    }
    if (u.username || u.password) {
      u.username = '';
      u.password = '';
      redacted = true;
    }
    return { url: u.toString(), redacted };
  } catch {
    return { url, redacted: false };
  }
}

/** Safe, bounded serialisation of console arguments. */
export function serialize(value: unknown, depth = 0, seen = new WeakSet<object>()): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const t = typeof value;
  if (t === 'string') return redactText(value as string).slice(0, 4000);
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(value);
  if (t === 'symbol') return String(value);
  if (t === 'function') return `ƒ ${(value as { name?: string }).name || 'anonymous'}()`;
  if (value instanceof Error) return redactText(`${value.name}: ${value.message}${value.stack ? '\n' + value.stack.split('\n').slice(1, 6).join('\n') : ''}`);
  if (typeof Element !== 'undefined' && value instanceof Element) {
    return `<${value.tagName.toLowerCase()}${value.id ? '#' + value.id : ''}${value.classList.length ? '.' + [...value.classList].slice(0, 3).join('.') : ''}>`;
  }
  if (depth > 2) return Array.isArray(value) ? `Array(${value.length})` : '{…}';
  const obj = value as object;
  if (seen.has(obj)) return '[Circular]';
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const items = obj.slice(0, 20).map((v) => serialize(v, depth + 1, seen));
      return `[${items.join(', ')}${obj.length > 20 ? `, … ${obj.length - 20} more` : ''}]`;
    }
    const entries = Object.entries(obj).slice(0, 20);
    const body = entries.map(([k, v]) => `${k}: ${/pass|pwd|token|secret|ssn|cvv|authorization/i.test(k) ? '[redacted]' : serialize(v, depth + 1, seen)}`);
    return `{${body.join(', ')}${Object.keys(obj).length > 20 ? ', …' : ''}}`;
  } catch {
    return Object.prototype.toString.call(obj);
  }
}

function callerSource(): string | undefined {
  const stack = new Error().stack?.split('\n') ?? [];
  const line = stack.find((l) => !/__ifdy|agent\.js|at console\.|serialize|callerSource/.test(l) && /https?:|\.js/.test(l));
  const m = line && /(https?:\/\/[^\s)]+)/.exec(line);
  if (!m) return undefined;
  try {
    const u = new URL(m[1]);
    return u.pathname.split('/').pop() + (u.hash || '');
  } catch {
    return m[1];
  }
}

/** Console capture: wraps console methods, always calling the original. */
export function installConsoleCapture(emit: Emit) {
  const levels: LogLevel[] = ['log', 'info', 'warn', 'error', 'debug'];
  for (const level of levels) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      try {
        emit('console', { level, args: args.map((a) => serialize(a)), ts: Date.now(), source: callerSource() });
      } catch {
        /* never break the app */
      }
    };
  }
}

export function installErrorCapture(emit: Emit) {
  window.addEventListener(
    'error',
    (e: Event) => {
      if (e instanceof ErrorEvent) {
        emit('error', {
          message: redactText(e.message),
          source: e.filename ? e.filename.split('/').pop() : undefined,
          line: e.lineno,
          column: e.colno,
          stack: e.error?.stack ? redactText(String(e.error.stack)) : undefined,
          ts: Date.now(),
          kind: 'runtime',
        });
      } else {
        const t = e.target as HTMLElement & { src?: string; href?: string };
        if (t && t !== (window as unknown as HTMLElement) && (t.src || t.href)) {
          emit('error', { message: `Failed to load ${t.tagName.toLowerCase()}: ${redactUrl(t.src || t.href || '').url}`, ts: Date.now(), kind: 'resource' });
        }
      }
    },
    true,
  );
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error ? `${e.reason.name}: ${e.reason.message}` : serialize(e.reason);
    emit('error', { message: `Unhandled promise rejection: ${redactText(reason)}`, stack: e.reason?.stack, ts: Date.now(), kind: 'promise' });
  });
}

type NetEntry = AgentEvents['network']['entries'][number];

/** Passive network capture via Resource Timing. Optional fetch/XHR instrumentation is opt-in. */
export function installNetworkCapture(emit: Emit, instrument: boolean) {
  let batch: NetEntry[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const queue = (e: NetEntry) => {
    batch.push(e);
    if (!timer)
      timer = setTimeout(() => {
        emit('network', { entries: batch });
        batch = [];
        timer = null;
      }, 250);
  };
  const seenInstrumented = new Set<string>();

  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
        if (/\/__ifdy\//.test(entry.name)) continue;
        const status = (entry as PerformanceResourceTiming & { responseStatus?: number }).responseStatus;
        const { url, redacted } = redactUrl(entry.name);
        if (instrument && seenInstrumented.has(entry.name)) continue;
        queue({
          url: redacted ? url : url,
          method: entry.initiatorType === 'fetch' || entry.initiatorType === 'xmlhttprequest' ? '—' : 'GET',
          status: status && status > 0 ? status : null,
          type: entry.initiatorType || 'other',
          startTime: entry.startTime,
          duration: Math.round(entry.duration),
          transferSize: entry.transferSize || null,
          failed: Boolean(status && status >= 400),
          failureReason: status && status >= 400 ? `HTTP ${status}` : undefined,
          initiator: entry.initiatorType,
          source: 'resource-timing',
        });
      }
    });
    po.observe({ type: 'resource', buffered: true });
  } catch {
    /* Resource Timing unavailable */
  }

  if (!instrument) return;
  const origFetch = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const started = performance.now();
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const abs = new URL(rawUrl, location.href).href;
    seenInstrumented.add(abs);
    try {
      const res = await origFetch.call(this, input as RequestInfo, init);
      queue({ url: redactUrl(abs).url, method, status: res.status, type: 'fetch', startTime: started, duration: Math.round(performance.now() - started), transferSize: Number(res.headers.get('content-length')) || null, failed: !res.ok, failureReason: res.ok ? undefined : `HTTP ${res.status} ${res.statusText}`, initiator: 'fetch', source: 'instrumented' });
      return res;
    } catch (err) {
      queue({ url: redactUrl(abs).url, method, status: null, type: 'fetch', startTime: started, duration: Math.round(performance.now() - started), transferSize: null, failed: true, failureReason: (err as Error).message, initiator: 'fetch', source: 'instrumented' });
      throw err;
    }
  };
  const XHR = XMLHttpRequest.prototype;
  const open = XHR.open;
  const send = XHR.send;
  XHR.open = function (this: XMLHttpRequest & { __ifdy?: { method: string; url: string } }, method: string, url: string | URL, ...rest: unknown[]) {
    this.__ifdy = { method: method.toUpperCase(), url: new URL(String(url), location.href).href };
    seenInstrumented.add(this.__ifdy.url);
    return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XHR.open;
  XHR.send = function (this: XMLHttpRequest & { __ifdy?: { method: string; url: string } }, body?: Document | XMLHttpRequestBodyInit | null) {
    const started = performance.now();
    const meta = this.__ifdy;
    this.addEventListener('loadend', () => {
      if (!meta) return;
      queue({ url: redactUrl(meta.url).url, method: meta.method, status: this.status || null, type: 'xhr', startTime: started, duration: Math.round(performance.now() - started), transferSize: null, failed: this.status === 0 || this.status >= 400, failureReason: this.status === 0 ? 'Network error' : this.status >= 400 ? `HTTP ${this.status}` : undefined, initiator: 'xmlhttprequest', source: 'instrumented' });
    });
    return send.call(this, body);
  };
}

/** Opt-in listener instrumentation (requested explicitly by the user; installed before app code). */
type ListenerRecord = { type: string; listener: EventListenerOrEventListenerObject; capture: boolean; passive: boolean; once: boolean };
export const instrumentedListeners = new WeakMap<EventTarget, ListenerRecord[]>();

export function installListenerInstrumentation() {
  const proto = EventTarget.prototype;
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  proto.addEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    if (listener) {
      const o = typeof options === 'object' ? options : { capture: Boolean(options) };
      const list = instrumentedListeners.get(this) ?? [];
      list.push({ type, listener, capture: Boolean(o.capture), passive: Boolean(o.passive), once: Boolean(o.once) });
      instrumentedListeners.set(this, list);
    }
    return add.call(this, type, listener, options);
  };
  proto.removeEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    const list = instrumentedListeners.get(this);
    if (list) {
      const capture = typeof options === 'object' ? Boolean(options.capture) : Boolean(options);
      const i = list.findIndex((l) => l.type === type && l.listener === listener && l.capture === capture);
      if (i >= 0) list.splice(i, 1);
    }
    return remove.call(this, type, listener, options);
  };
}
