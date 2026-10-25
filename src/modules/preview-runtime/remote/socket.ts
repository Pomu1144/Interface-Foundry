import { wsUrl } from '@/modules/project-adapter/server-api';
import { BROWSER_WS_PATH, decodeFrame, type ClientMessage, type FrameHeader, type ServerHello, type ServerMessage } from './protocol';

export type SocketState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'failed';
export type PageEvent = ServerMessage | { t: 'frame'; header: FrameHeader; image: Uint8Array };

/**
 * One websocket per studio tab, shared by every RemoteFrame and multiplexed by
 * pageId. Connects lazily when the first page subscribes, reconnects with
 * backoff, and closes after the last page unsubscribes (the companion then
 * closes this tab's isolated browser context).
 */
class BrowserSocket {
  state: SocketState = 'idle';
  hello: ServerHello | null = null;
  lastError = '';
  /** Increments on every successful (re)connect; pages re-open when it changes. */
  generation = 0;
  private ws: WebSocket | null = null;
  private pages = new Map<string, (e: PageEvent) => void>();
  private listeners = new Set<() => void>();
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private wantOpen = false;

  subscribe(pageId: string, handler: (e: PageEvent) => void): () => void {
    this.pages.set(pageId, handler);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.wantOpen = true;
    this.ensure();
    return () => {
      if (this.pages.get(pageId) === handler) this.pages.delete(pageId);
      if (!this.pages.size) {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => this.shutdown(), 15_000);
      }
    };
  }

  onState(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Send if connected. Returns false when the message was dropped. */
  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    // Keep the socket responsive: drop transient input while a large backlog is queued.
    if (msg.t === 'input' && this.ws.bufferedAmount > 1_000_000 && msg.event.kind !== 'key') return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Manual retry after a failure (e.g. Chromium could not launch). */
  retry() {
    this.retries = 0;
    this.wantOpen = true;
    if (this.state === 'failed' || this.state === 'reconnecting' || this.state === 'idle') {
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.setState('connecting');
      void this.connect();
    }
  }

  private ensure() {
    if (this.ws || this.state === 'connecting' || this.retryTimer) return;
    this.setState(this.generation ? 'reconnecting' : 'connecting');
    void this.connect();
  }

  private async connect() {
    let url: string;
    try {
      // The companion issues a new token on every launch: after a failed attempt, fetch a fresh one.
      url = this.retries === 0 ? await wsUrl(BROWSER_WS_PATH) : await freshWsUrl();
    } catch {
      return this.scheduleRetry();
    }
    if (!this.wantOpen) return this.setState('idle');
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    let launchError = '';
    ws.onopen = () => {
      this.retries = 0;
      this.pingTimer = setInterval(() => this.send({ t: 'ping', ts: Date.now() }), 25_000);
    };
    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        const f = decodeFrame(ev.data);
        if (f) this.pages.get(f.header.pageId)?.({ t: 'frame', header: f.header, image: f.image });
        return;
      }
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.t === 'hello') {
        this.hello = msg;
        this.generation++;
        this.lastError = '';
        this.setState('open');
        return;
      }
      if (msg.t === 'error' && msg.code === 'launch-failed') {
        launchError = msg.message;
        return;
      }
      if (msg.t === 'pong') return;
      const pageId = (msg as { pageId?: string }).pageId;
      if (pageId) this.pages.get(pageId)?.(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (!this.wantOpen || !this.pages.size) return this.setState('idle');
      if (launchError) return this.fail(launchError);
      this.scheduleRetry();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleRetry() {
    this.retries++;
    if (this.retries > 6) return this.fail('Lost the connection to the controlled browser.');
    this.setState('reconnecting');
    const delay = Math.min(10_000, 400 * 2 ** (this.retries - 1));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.wantOpen && this.pages.size) void this.connect();
      else this.setState('idle');
    }, delay);
  }

  private fail(reason: string) {
    this.lastError = reason;
    this.setState('failed');
  }

  private shutdown() {
    this.idleTimer = null;
    if (this.pages.size) return;
    this.wantOpen = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, 'idle');
    this.setState('idle');
  }

  private setState(s: SocketState) {
    this.state = s;
    this.listeners.forEach((l) => l());
  }
}

async function freshWsUrl(): Promise<string> {
  const r = await fetch('/api/bootstrap', { cache: 'no-store' });
  if (!r.ok) throw new Error(`bootstrap ${r.status}`);
  const { token } = (await r.json()) as { token: string };
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${BROWSER_WS_PATH}?token=${encodeURIComponent(token)}`;
}

export const browserSocket = new BrowserSocket();
