import type { BrowserContext } from 'playwright-core';
import type { WebSocket } from 'ws';
import {
  BROWSER_PROTOCOL_VERSION,
  encodeFrame,
  isAllowedRemoteUrl,
  type ClientMessage,
  type FrameHeader,
  type OpenMessage,
  type ServerMessage,
} from '../../src/modules/preview-runtime/remote/protocol';
import type { BrowserManager } from './manager';
import { RemotePage, type PageHost } from './remote-page';

const PAGE_ID = /^[\w.:~-]{1,96}$/;
/** Frame-rate budget shared by every streaming page of one studio tab. */
const TOTAL_FPS = 150;
const MAX_FPS_PER_PAGE = 40;
/** Pause acknowledgements while this much screencast data is still queued on the socket. */
const MAX_BUFFERED = 3 * 1024 * 1024;

/**
 * One studio websocket = one isolated BrowserContext (fresh profile, no
 * persistent storage) holding up to `maxPages` pages, multiplexed by pageId.
 */
export class BrowserSession implements PageHost {
  private context: BrowserContext | null = null;
  private contextPromise: Promise<BrowserContext> | null = null;
  private pages = new Map<string, RemotePage>();
  /** Lifecycle messages for a pageId are applied strictly in order. */
  private chains = new Map<string, Promise<void>>();
  private nextAck = new WeakMap<RemotePage, number>();
  private disposed = false;
  private alive = true;
  private heartbeat: ReturnType<typeof setInterval>;
  browserVersion = '';

  constructor(
    private readonly manager: BrowserManager,
    private readonly ws: WebSocket,
  ) {
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data)) as ClientMessage;
      } catch {
        return this.send({ t: 'error', code: 'invalid', message: 'Malformed message' });
      }
      this.onMessage(msg);
    });
    ws.on('pong', () => (this.alive = true));
    ws.on('close', () => void this.dispose());
    ws.on('error', () => void this.dispose());
    this.heartbeat = setInterval(() => {
      if (!this.alive) {
        ws.terminate();
        return;
      }
      this.alive = false;
      try {
        ws.ping();
      } catch {
        /* closing */
      }
    }, 20_000);
    void this.greet();
  }

  get agent() {
    return this.manager.agent;
  }

  get pageCount() {
    return this.pages.size;
  }

  private async greet() {
    try {
      const browser = await this.manager.browser();
      this.browserVersion = browser.version();
      const df = await this.manager.displayFeatureSupport();
      this.send({
        t: 'hello',
        version: BROWSER_PROTOCOL_VERSION,
        browser: `Chromium ${this.browserVersion}`,
        maxPages: this.manager.maxPages,
        capabilities: {
          engine: 'chromium',
          displayFeatures: { supported: df.method !== 'none', method: df.method, detail: df.detail },
          touch: true,
          screencast: true,
          userAgentOverride: true,
        },
      });
    } catch (err) {
      this.send({ t: 'error', code: 'launch-failed', message: `Could not start Chromium: ${(err as Error).message.split('\n')[0]}` });
      setTimeout(() => this.ws.close(1011, 'launch failed'), 50);
    }
  }

  /* ------------------------------------------------------------------ */

  private onMessage(msg: ClientMessage) {
    if (this.disposed || !msg || typeof msg !== 'object') return;
    if (msg.t === 'ping') return this.send({ t: 'pong', ts: msg.ts });
    const pageId = (msg as { pageId?: unknown }).pageId;
    if (typeof pageId !== 'string' || !PAGE_ID.test(pageId)) return this.send({ t: 'error', code: 'invalid', message: 'Missing or invalid pageId' });

    // High-frequency messages bypass the lifecycle chain.
    if (msg.t === 'input' || msg.t === 'agent' || msg.t === 'screencast' || msg.t === 'emulate') {
      const page = this.pages.get(pageId);
      if (!page) {
        // The page may still be opening: queue behind it.
        if (this.chains.has(pageId)) return this.enqueue(pageId, async () => this.dispatchLive(pageId, msg));
        if (msg.t !== 'input' && msg.t !== 'screencast') this.send({ t: 'error', pageId, code: 'no-page', message: 'Unknown page' });
        return;
      }
      return void this.dispatchLive(pageId, msg);
    }
    this.enqueue(pageId, () => this.lifecycle(pageId, msg));
  }

  private enqueue(pageId: string, fn: () => Promise<void>) {
    const prev = this.chains.get(pageId) ?? Promise.resolve();
    const next = prev.then(fn).catch((err) => {
      this.send({ t: 'error', pageId, code: 'internal', message: (err as Error).message.split('\n')[0] });
    });
    this.chains.set(pageId, next);
    void next.finally(() => {
      if (this.chains.get(pageId) === next) this.chains.delete(pageId);
    });
  }

  private async dispatchLive(pageId: string, msg: ClientMessage) {
    const page = this.pages.get(pageId);
    if (!page) return;
    switch (msg.t) {
      case 'input':
        return page.input(msg.event);
      case 'agent':
        return page.toAgent(msg.env);
      case 'screencast':
        return page.setScreencast(msg);
      case 'emulate':
        return page.emulate(msg);
    }
  }

  private async lifecycle(pageId: string, msg: ClientMessage) {
    switch (msg.t) {
      case 'open':
        return this.openPage(pageId, msg);
      case 'close': {
        const page = this.pages.get(pageId);
        this.pages.delete(pageId);
        await page?.close();
        this.manager.touch();
        return;
      }
      case 'navigate': {
        const page = this.pages.get(pageId);
        if (!page) return this.send({ t: 'error', pageId, code: 'no-page', message: 'Unknown page' });
        if (typeof msg.url !== 'string' || !isAllowedRemoteUrl(msg.url)) return this.send({ t: 'error', pageId, code: 'forbidden', message: 'Only http(s) URLs can be opened.' });
        void page.navigate(msg.url);
        return;
      }
      case 'reload': {
        const page = this.pages.get(pageId);
        if (!page) return this.send({ t: 'error', pageId, code: 'no-page', message: 'Unknown page' });
        void page.reload();
        return;
      }
      case 'history': {
        const page = this.pages.get(pageId);
        if (page) void page.history(msg.direction === 'forward' ? 'forward' : 'back');
        return;
      }
    }
  }

  private async openPage(pageId: string, msg: OpenMessage) {
    if (this.pages.has(pageId)) await this.pages.get(pageId)!.close();
    this.pages.delete(pageId);
    if (typeof msg.url !== 'string' || !isAllowedRemoteUrl(msg.url)) {
      return this.send({ t: 'status', pageId, status: 'error', error: 'Only http(s) URLs can be opened in the controlled browser.' });
    }
    if (this.manager.totalPages() >= this.manager.maxPages * 4 || this.pages.size >= this.manager.maxPages) {
      return this.send({
        t: 'error',
        pageId,
        code: 'page-limit',
        message: `Chromium page budget reached (${this.manager.maxPages} pages per studio tab). Close other previews or wall tiles first.`,
      });
    }
    this.send({ t: 'status', pageId, status: 'opening', url: msg.url });
    const page = new RemotePage(pageId, this, msg);
    try {
      const context = await this.ensureContext();
      if (this.disposed) return;
      await page.start(context);
    } catch (err) {
      await page.close();
      this.send({ t: 'status', pageId, status: 'error', url: msg.url, error: `Chromium could not open the page: ${(err as Error).message.split('\n')[0]}` });
      return;
    }
    // Registered only once started: live messages sent meanwhile were queued behind the open.
    if (this.disposed) return void page.close();
    this.pages.set(pageId, page);
    this.manager.touch();
  }

  private ensureContext(): Promise<BrowserContext> {
    if (this.context) return Promise.resolve(this.context);
    if (!this.contextPromise) {
      this.contextPromise = (async () => {
        const browser = await this.manager.browser();
        this.browserVersion = browser.version();
        // Fresh, isolated, in-memory profile per studio tab. Emulation is applied per page via CDP
        // (viewport: null) so it can change in place without reloading.
        const ctx = await browser.newContext({
          viewport: null,
          acceptDownloads: false,
          ignoreHTTPSErrors: false,
          bypassCSP: false,
          serviceWorkers: 'allow',
        });
        ctx.on('close', () => {
          if (this.context === ctx) {
            this.context = null;
            this.contextPromise = null;
            for (const [id, p] of this.pages) {
              void p.close();
              this.send({ t: 'status', pageId: id, status: 'closed', error: 'Chromium closed this page (the browser restarted).' });
            }
            this.pages.clear();
          }
        });
        this.context = ctx;
        return ctx;
      })().catch((err) => {
        this.contextPromise = null;
        throw err;
      });
    }
    return this.contextPromise;
  }

  /* ------------------------------------------------------------------ */
  /* PageHost                                                            */
  /* ------------------------------------------------------------------ */

  send(msg: ServerMessage) {
    if (this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify(msg));
  }

  sendRaw(json: string) {
    if (this.ws.readyState === 1) this.ws.send(json);
  }

  sendFrame(header: FrameHeader, jpeg: Buffer) {
    if (this.ws.readyState !== 1) return;
    this.ws.send(encodeFrame(header, jpeg), { binary: true });
  }

  /**
   * Chromium sends the next screencast frame only after the previous one is acknowledged,
   * so delaying acks is the throttle: each page gets an equal share of the session's
   * frame budget, and acks pause while the socket is backed up (slow client / many tiles).
   */
  scheduleAck(page: RemotePage, ack: () => void) {
    const streams = Math.max(1, [...this.pages.values()].filter((p) => p.isStreaming).length);
    const minInterval = 1000 / Math.min(MAX_FPS_PER_PAGE, TOTAL_FPS / streams);
    const now = Date.now();
    const at = Math.max(now, this.nextAck.get(page) ?? 0);
    this.nextAck.set(page, at + minInterval);
    const fire = () => {
      if (this.disposed) return;
      if (this.ws.bufferedAmount > MAX_BUFFERED) {
        setTimeout(fire, 20);
        return;
      }
      ack();
    };
    setTimeout(fire, at - now);
  }

  displayFeatureMethod() {
    return this.manager.displayFeatureSupport();
  }

  isForbiddenUrl(url: string): string | null {
    return this.manager.isForbiddenUrl(url);
  }

  /** The browser went away (crash or idle shutdown). */
  onBrowserGone() {
    this.context = null;
    this.contextPromise = null;
    for (const [id, p] of this.pages) {
      void p.close();
      this.send({ t: 'status', pageId: id, status: 'closed', error: 'Chromium exited. Reload to start it again.' });
    }
    this.pages.clear();
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.heartbeat);
    // Companion shutting down / restarting: tell the studio so it reconnects to the new instance.
    if (this.ws.readyState === 1) this.ws.close(1001, 'Companion restarting');
    const pages = [...this.pages.values()];
    this.pages.clear();
    await Promise.all(pages.map((p) => p.close()));
    const ctx = this.context;
    this.context = null;
    await ctx?.close().catch(() => {});
    this.manager.detach(this);
  }
}
