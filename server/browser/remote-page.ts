import type { BrowserContext, CDPSession, ConsoleMessage, Dialog, Page, Request } from 'playwright-core';
import type { LivePage } from './live-page';
import type {
  DisplayFeatureMethod,
  EmulationParams,
  FrameHeader,
  OpenMessage,
  RemoteInput,
  ScreencastOptions,
  ServerMessage,
  WireConsoleEntry,
  WireNetworkEntry,
} from '../../src/modules/preview-runtime/remote/protocol';
import type { AgentBundle } from '../agent-bundle';
import { AgentChannel, type EnvelopeLike } from './agent-channel';
import { applyCdpEmulation, freshEmulation } from './cdp-emulation';
import { sanitizeEmulation } from './emulation';
import { redactText, redactUrl } from './redact';

/** What a page needs from its owning session. */
export type PageHost = {
  send(msg: ServerMessage): void;
  sendRaw(json: string): void;
  sendFrame(header: FrameHeader, jpeg: Buffer): void;
  /** Throttles screencast acknowledgements across every streaming page of the session. */
  scheduleAck(page: LivePage, ack: () => void): void;
  agent: AgentBundle;
  browserVersion: string;
  displayFeatureMethod(): Promise<{ method: DisplayFeatureMethod; detail: string }>;
  isForbiddenUrl(url: string): string | null;
};

type ScreencastFrameEvent = {
  data: string;
  sessionId: number;
  metadata: { deviceWidth: number; deviceHeight: number; pageScaleFactor: number; timestamp?: number; offsetTop: number };
};

/** Agent events the companion replaces with Chromium data (richer and complete). */
const AGENT_EVENTS_REPLACED = new Set(['network']);
const MAX_NETWORK_PER_DOC = 3000;
const CONSOLE_BUFFER = 200;

/**
 * One live, server-controlled Chromium page: CDP emulation (in place, never
 * reloading), screencast, input dispatch, agent relay and passive network /
 * lifecycle reporting.
 */
export class RemotePage implements LivePage {
  page!: Page;
  private cdp!: CDPSession;
  private agent!: AgentChannel;
  private closed = false;
  private emu: EmulationParams;
  private applied = freshEmulation();
  private emulating: Promise<void> | null = null;
  private pendingEmu: EmulationParams | null = null;
  private screencast: Required<ScreencastOptions> = { enabled: false, quality: 70, maxWidth: 800, maxHeight: 1600 };
  private streaming = false;
  private streamKey = '';
  private frameSeq = 0;
  lastFrameAt = 0;
  private metricsTimer: ReturnType<typeof setTimeout> | null = null;
  private metricsAt = 0;
  private metricsKey = '';
  private inputQueue: RemoteInput[] = [];
  private inputBusy = false;
  /* document tracking */
  private navSeq = 0;
  private navPending = false;
  private navRequest: Request | null = null;
  private navFailed = false;
  private navStart = Date.now();
  private doc = { agentAlive: false, flushed: false, loaded: false, buffer: [] as ServerMessage[], netCount: 0 };
  private netBatch: WireNetworkEntry[] = [];
  private netTimer: ReturnType<typeof setTimeout> | null = null;
  private requestStart = new WeakMap<Request, number>();
  lastActivity = Date.now();

  constructor(
    readonly id: string,
    private readonly host: PageHost,
    private readonly open: OpenMessage,
    private readonly getContext: () => Promise<BrowserContext>,
  ) {
    this.emu = sanitizeEmulation(open);
  }

  get isStreaming() {
    return this.streaming;
  }

  async start() {
    const context = await this.getContext();
    this.page = await context.newPage();
    this.cdp = await context.newCDPSession(this.page);
    this.agent = new AgentChannel(this.page, this.cdp, {
      session: String(this.open.session).slice(0, 64),
      flags: (Array.isArray(this.open.flags) ? this.open.flags : []).filter((f) => typeof f === 'string' && /^[a-z]{1,8}$/.test(f)),
      agent: this.host.agent,
      onEnvelope: (json, env) => this.onAgent(json, env),
    });
    await this.agent.install();
    this.attachEvents();
    this.cdp.on('Page.screencastFrame', (f: ScreencastFrameEvent) => this.onFrame(f));
    await this.applyEmulation(this.emu);
    if (this.open.screencast) await this.setScreencast(this.open.screencast);
    void this.navigate(this.open.url);
  }

  /* ------------------------------------------------------------------ */
  /* Emulation                                                           */
  /* ------------------------------------------------------------------ */

  /** Re-emulate in place. Calls are coalesced so a fold animation only applies the latest size. */
  emulate(e: Partial<EmulationParams>) {
    this.lastActivity = Date.now();
    this.pendingEmu = sanitizeEmulation(e);
    if (this.emulating) return;
    this.emulating = (async () => {
      while (this.pendingEmu && !this.closed) {
        const next = this.pendingEmu;
        this.pendingEmu = null;
        try {
          await this.applyEmulation(next);
        } catch (err) {
          if (!this.closed) this.host.send({ t: 'error', pageId: this.id, code: 'internal', message: `Emulation failed: ${(err as Error).message}` });
        }
      }
      this.emulating = null;
    })();
  }

  private async applyEmulation(e: EmulationParams) {
    const first = this.applied.metrics === '';
    this.emu = e;
    const d = e.device;
    const { method, detail } = await this.host.displayFeatureMethod();
    const fold = e.fold;
    const { touchChanged } = await applyCdpEmulation(this.cdp, e, { method, browserVersion: this.host.browserVersion }, this.applied);
    const touchNeedsReload = touchChanged;
    this.host.send({
      t: 'emulated',
      pageId: this.id,
      viewport: { width: d.width, height: d.height, dpr: d.dpr },
      displayFeature: fold ? (method === 'none' ? 'unsupported' : 'applied') : 'none',
      detail: fold ? detail : undefined,
      touchNeedsReload: touchNeedsReload && !first ? true : undefined,
    });
    this.scheduleMetrics(120);
  }

  /* ------------------------------------------------------------------ */
  /* Screencast                                                          */
  /* ------------------------------------------------------------------ */

  async setScreencast(o: ScreencastOptions) {
    this.lastActivity = Date.now();
    const q = Math.round(Math.min(95, Math.max(20, o.quality ?? this.screencast.quality)));
    const mw = Math.round(Math.min(4096, Math.max(64, o.maxWidth ?? this.screencast.maxWidth)));
    const mh = Math.round(Math.min(4096, Math.max(64, o.maxHeight ?? this.screencast.maxHeight)));
    this.screencast = { enabled: Boolean(o.enabled), quality: q, maxWidth: mw, maxHeight: mh };
    const key = `${q}|${mw}|${mh}`;
    if (this.closed) return;
    try {
      if (!this.screencast.enabled) {
        if (this.streaming) {
          this.streaming = false;
          await this.cdp.send('Page.stopScreencast');
        }
        return;
      }
      if (this.streaming && key === this.streamKey) return;
      if (this.streaming) await this.cdp.send('Page.stopScreencast');
      this.streaming = true;
      this.streamKey = key;
      await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: q, maxWidth: mw, maxHeight: mh, everyNthFrame: 1 });
    } catch {
      /* page closing */
    }
  }

  private onFrame(f: ScreencastFrameEvent) {
    const ack = () => {
      if (!this.closed) this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    };
    if (!this.streaming || this.closed) return ack();
    this.lastFrameAt = Date.now();
    const header: FrameHeader = {
      t: 'frame',
      pageId: this.id,
      width: Math.round(f.metadata.deviceWidth),
      height: Math.round(f.metadata.deviceHeight),
      ts: f.metadata.timestamp ?? 0,
      pageScale: f.metadata.pageScaleFactor,
      seq: ++this.frameSeq,
    };
    this.host.sendFrame(header, Buffer.from(f.data, 'base64'));
    this.host.scheduleAck(this, ack);
    this.scheduleMetrics();
  }

  /** Track the visual viewport (page scale / zoomed-out mobile layouts), throttled. */
  private scheduleMetrics(delay = 0) {
    if (this.metricsTimer) return;
    const wait = Math.max(delay, 300 - (Date.now() - this.metricsAt));
    this.metricsTimer = setTimeout(async () => {
      this.metricsTimer = null;
      this.metricsAt = Date.now();
      if (this.closed) return;
      try {
        const m = (await this.cdp.send('Page.getLayoutMetrics')) as { cssVisualViewport: { clientWidth: number; clientHeight: number; scale: number; offsetX: number; offsetY: number } };
        const v = m.cssVisualViewport;
        const visual = {
          width: Math.round(v.clientWidth * 100) / 100,
          height: Math.round(v.clientHeight * 100) / 100,
          scale: Math.round(v.scale * 10000) / 10000,
          offsetX: Math.round(v.offsetX * 100) / 100,
          offsetY: Math.round(v.offsetY * 100) / 100,
        };
        const key = JSON.stringify(visual);
        if (key !== this.metricsKey) {
          this.metricsKey = key;
          this.host.send({ t: 'metrics', pageId: this.id, visual });
        }
      } catch {
        /* navigating */
      }
    }, Math.max(0, wait));
  }

  /* ------------------------------------------------------------------ */
  /* Navigation                                                          */
  /* ------------------------------------------------------------------ */

  async navigate(url: string) {
    this.lastActivity = Date.now();
    const seq = ++this.navSeq;
    const forbidden = this.host.isForbiddenUrl(url);
    if (forbidden) {
      this.host.send({ t: 'status', pageId: this.id, status: 'error', url, error: forbidden });
      return;
    }
    try {
      await this.page.goto(url, { waitUntil: 'commit', timeout: 45_000 });
    } catch (err) {
      if (this.closed || seq !== this.navSeq) return;
      const msg = (err as Error).message.split('\n')[0].replace(/^page\.goto:\s*/, '');
      if (/interrupted by another navigation|frame was detached/i.test(msg)) return;
      this.navFailed = true;
      this.host.send({ t: 'status', pageId: this.id, status: 'error', url, error: friendlyNetError(msg) });
    }
  }

  async reload() {
    this.lastActivity = Date.now();
    this.navSeq++;
    try {
      await this.page.reload({ waitUntil: 'commit', timeout: 45_000 });
    } catch (err) {
      if (!this.closed && !/interrupted by another navigation/i.test((err as Error).message)) {
        this.host.send({ t: 'status', pageId: this.id, status: 'error', error: friendlyNetError((err as Error).message.split('\n')[0]) });
      }
    }
  }

  async history(direction: 'back' | 'forward') {
    try {
      if (direction === 'back') await this.page.goBack({ waitUntil: 'commit', timeout: 15_000 });
      else await this.page.goForward({ waitUntil: 'commit', timeout: 15_000 });
    } catch {
      /* no history entry */
    }
  }

  private attachEvents() {
    const page = this.page;
    page.on('request', (req) => {
      this.requestStart.set(req, Date.now());
      if (req.frame() === page.mainFrame() && req.isNavigationRequest()) {
        this.navPending = true;
        this.navRequest = req;
        this.navFailed = false;
        this.navStart = Date.now();
        this.host.send({ t: 'status', pageId: this.id, status: 'loading', url: pageUrl(req.url()) });
      }
    });
    page.on('requestfinished', (req) => void this.onRequestDone(req, null));
    page.on('requestfailed', (req) => {
      const reason = req.failure()?.errorText ?? 'Failed';
      void this.onRequestDone(req, reason);
      if (req === this.navRequest && !/ERR_ABORTED/.test(reason)) {
        this.navFailed = true;
        this.host.send({ t: 'status', pageId: this.id, status: 'error', url: pageUrl(req.url()), error: friendlyNetError(reason) });
      }
    });
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      const url = pageUrl(frame.url());
      if (this.navPending) {
        // A new document committed: reset per-document state.
        this.navPending = false;
        this.doc = { agentAlive: false, flushed: false, loaded: false, buffer: [], netCount: 0 };
      } else {
        this.host.send({ t: 'navigated', pageId: this.id, url });
      }
    });
    page.on('load', () => {
      if (this.closed) return;
      this.doc.loaded = true;
      void (async () => {
        const httpStatus = (await this.navRequest?.response().then((r) => r?.status() ?? null).catch(() => null)) ?? null;
        const title = await page.title().catch(() => '');
        if (this.closed || this.navFailed) return;
        this.host.send({ t: 'status', pageId: this.id, status: 'ready', url: pageUrl(page.url()), title: redactText(title, 300), httpStatus });
      })();
      // Documents where the agent cannot run (error pages, PDFs, CSP crashes) still report Chromium's console.
      const doc = this.doc;
      setTimeout(() => {
        if (this.closed || doc !== this.doc || doc.agentAlive) return;
        doc.flushed = true;
        for (const m of doc.buffer) this.host.send(m);
        doc.buffer = [];
      }, 2000);
    });
    page.on('console', (msg) => this.onChromiumLog(consoleMessage(this.id, msg)));
    page.on('pageerror', (err) =>
      this.onChromiumLog({ t: 'pageerror', pageId: this.id, error: { message: redactText(err.message, 2000), stack: err.stack ? redactText(err.stack, 4000) : undefined, ts: Date.now() } }),
    );
    page.on('crash', () => this.host.send({ t: 'status', pageId: this.id, status: 'crashed', error: 'The page crashed in Chromium (out of memory or a renderer fault).' }));
    page.on('close', () => {
      if (!this.closed) this.host.send({ t: 'status', pageId: this.id, status: 'closed', error: 'The page was closed.' });
    });
    page.on('dialog', (d: Dialog) => {
      this.host.send({ t: 'dialog', pageId: this.id, dialogType: d.type(), message: redactText(d.message(), 500) });
      (d.type() === 'beforeunload' ? d.accept() : d.dismiss()).catch(() => {});
    });
    page.on('popup', async (popup) => {
      // New windows would silently eat the page budget; close them and let the studio decide.
      let url = popup.url();
      if (!url || url === 'about:blank') {
        url = await popup
          .waitForEvent('request', { timeout: 2500 })
          .then((r) => r.url())
          .catch(() => popup.url());
      }
      await popup.close().catch(() => {});
      if (url && url !== 'about:blank') this.host.send({ t: 'popup', pageId: this.id, url: pageUrl(url) });
    });
  }

  private onChromiumLog(msg: ServerMessage) {
    const doc = this.doc;
    if (doc.agentAlive) return;
    if (doc.flushed) this.host.send(msg);
    else if (doc.buffer.length < CONSOLE_BUFFER) doc.buffer.push(msg);
  }

  private async onRequestDone(req: Request, failure: string | null) {
    if (this.closed || this.doc.netCount >= MAX_NETWORK_PER_DOC) return;
    const url = req.url();
    if (url.startsWith('data:') && req.resourceType() !== 'document') return;
    this.doc.netCount++;
    const started = this.requestStart.get(req) ?? Date.now();
    const timing = req.timing();
    const resp = failure ? null : await req.response().catch(() => null);
    const sizes = failure ? null : await req.sizes().catch(() => null);
    const status = resp ? resp.status() : null;
    const startEpoch = timing.startTime > 0 ? timing.startTime : started;
    const duration = timing.responseEnd > 0 ? timing.responseEnd : Date.now() - startEpoch;
    const entry: WireNetworkEntry = {
      url: redactUrl(url).url,
      method: req.method(),
      status,
      type: req.resourceType(),
      startTime: Math.max(0, Math.round(startEpoch - this.navStart)),
      duration: Math.max(0, Math.round(duration)),
      transferSize: sizes ? sizes.responseBodySize + sizes.responseHeadersSize : null,
      failed: Boolean(failure) || (status !== null && status >= 400),
      failureReason: failure ? failure : status !== null && status >= 400 ? `HTTP ${status}` : undefined,
      initiator: req.frame() === this.page.mainFrame() ? undefined : 'subframe',
      fromCache: resp ? resp.fromServiceWorker() || undefined : undefined,
      source: 'chromium',
    };
    this.netBatch.push(entry);
    if (!this.netTimer) {
      this.netTimer = setTimeout(() => {
        this.netTimer = null;
        const entries = this.netBatch;
        this.netBatch = [];
        if (entries.length && !this.closed) this.host.send({ t: 'network', pageId: this.id, entries });
      }, 250);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Agent relay                                                         */
  /* ------------------------------------------------------------------ */

  private onAgent(json: string, env: EnvelopeLike | null) {
    this.doc.agentAlive = true;
    this.doc.buffer = [];
    if (env && env.kind === 'event' && env.event && AGENT_EVENTS_REPLACED.has(env.event)) return;
    this.host.sendRaw(`{"t":"agent","pageId":${JSON.stringify(this.id)},"env":${json}}`);
  }

  toAgent(env: unknown) {
    this.lastActivity = Date.now();
    void this.agent.deliver(env);
  }

  /* ------------------------------------------------------------------ */
  /* Input                                                               */
  /* ------------------------------------------------------------------ */

  input(ev: RemoteInput) {
    this.lastActivity = Date.now();
    if (!ev || typeof ev !== 'object') return;
    // Coalesce high-frequency events that have not been dispatched yet.
    const last = this.inputQueue[this.inputQueue.length - 1];
    if (last && ev.kind === 'mouse' && ev.type === 'move' && last.kind === 'mouse' && last.type === 'move' && last.buttons === ev.buttons) {
      this.inputQueue[this.inputQueue.length - 1] = ev;
    } else if (last && ev.kind === 'wheel' && last.kind === 'wheel') {
      this.inputQueue[this.inputQueue.length - 1] = { ...ev, deltaX: last.deltaX + ev.deltaX, deltaY: last.deltaY + ev.deltaY };
    } else if (last && ev.kind === 'touch' && ev.type === 'move' && last.kind === 'touch' && last.type === 'move') {
      this.inputQueue[this.inputQueue.length - 1] = ev;
    } else {
      if (this.inputQueue.length > 400) this.inputQueue.shift();
      this.inputQueue.push(ev);
    }
    void this.drainInput();
  }

  private async drainInput() {
    if (this.inputBusy) return;
    this.inputBusy = true;
    try {
      while (this.inputQueue.length && !this.closed) {
        const ev = this.inputQueue.shift()!;
        try {
          await this.dispatch(ev);
        } catch {
          /* navigating; drop the event */
        }
      }
    } finally {
      this.inputBusy = false;
    }
  }

  private async dispatch(ev: RemoteInput) {
    const d = this.emu.device;
    const cx = (n: unknown) => Math.min(d.width + 50, Math.max(-50, num(n)));
    const cy = (n: unknown) => Math.min(d.height + 50, Math.max(-50, num(n)));
    const modifiers = Math.max(0, Math.min(15, Math.round(num((ev as { modifiers?: number }).modifiers))));
    switch (ev.kind) {
      case 'mouse': {
        const type = ev.type === 'down' ? 'mousePressed' : ev.type === 'up' ? 'mouseReleased' : 'mouseMoved';
        const button = ['none', 'left', 'middle', 'right', 'back', 'forward'].includes(ev.button) ? ev.button : 'none';
        await this.cdp.send('Input.dispatchMouseEvent', {
          type,
          x: cx(ev.x),
          y: cy(ev.y),
          button,
          buttons: Math.max(0, Math.min(31, Math.round(num(ev.buttons)))),
          clickCount: type === 'mouseMoved' ? 0 : Math.max(1, Math.min(3, Math.round(num(ev.clickCount) || 1))),
          modifiers,
          pointerType: 'mouse',
        });
        return;
      }
      case 'wheel':
        await this.cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: cx(ev.x),
          y: cy(ev.y),
          deltaX: Math.max(-5000, Math.min(5000, num(ev.deltaX))),
          deltaY: Math.max(-5000, Math.min(5000, num(ev.deltaY))),
          modifiers,
          button: 'none',
          pointerType: 'mouse',
        });
        return;
      case 'key': {
        const key = typeof ev.key === 'string' ? ev.key.slice(0, 32) : '';
        if (!key) return;
        try {
          if (ev.type === 'down') await this.page.keyboard.down(key);
          else await this.page.keyboard.up(key);
        } catch {
          // Not in Playwright's US layout (dead keys, non-Latin characters): dispatch raw.
          const text = ev.type === 'down' && [...key].length === 1 && !(modifiers & 6) ? key : undefined;
          await this.cdp.send('Input.dispatchKeyEvent', {
            type: ev.type === 'down' ? (text ? 'keyDown' : 'rawKeyDown') : 'keyUp',
            key,
            code: typeof ev.code === 'string' ? ev.code.slice(0, 32) : '',
            text,
            unmodifiedText: text,
            modifiers,
            autoRepeat: Boolean(ev.repeat),
            location: Math.max(0, Math.min(3, Math.round(num(ev.location)))),
          });
        }
        return;
      }
      case 'char':
        if (typeof ev.text === 'string' && ev.text) await this.cdp.send('Input.dispatchKeyEvent', { type: 'char', text: ev.text.slice(0, 8), unmodifiedText: ev.text.slice(0, 8) });
        return;
      case 'insertText':
        if (typeof ev.text === 'string' && ev.text) await this.cdp.send('Input.insertText', { text: ev.text.slice(0, 100_000) });
        return;
      case 'touch': {
        if (!d.touch) return;
        const type = ev.type === 'start' ? 'touchStart' : ev.type === 'move' ? 'touchMove' : ev.type === 'end' ? 'touchEnd' : 'touchCancel';
        const points = (Array.isArray(ev.points) ? ev.points : []).slice(0, 10).map((p) => ({
          x: cx(p.x),
          y: cy(p.y),
          id: Math.round(num(p.id)),
          radiusX: p.radiusX !== undefined ? Math.min(100, Math.max(0, num(p.radiusX))) : undefined,
          radiusY: p.radiusY !== undefined ? Math.min(100, Math.max(0, num(p.radiusY))) : undefined,
          force: p.force !== undefined ? Math.min(1, Math.max(0, num(p.force))) : undefined,
        }));
        await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : points, modifiers });
        return;
      }
    }
  }

  /* ------------------------------------------------------------------ */

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.netTimer) clearTimeout(this.netTimer);
    if (this.metricsTimer) clearTimeout(this.metricsTimer);
    this.agent?.dispose();
    this.inputQueue = [];
    await this.page?.close({ runBeforeUnload: false }).catch(() => {});
  }
}

/**
 * The page's own address is reported as-is (like the agent's hello), so the studio can
 * navigate and capture it; only network entries and logs are redacted.
 */
export const pageUrl = (u: string) => (u.length > 4096 ? u.slice(0, 4096) : u);

const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

const LEVELS: Record<string, WireConsoleEntry['level']> = { log: 'log', info: 'info', warning: 'warn', error: 'error', debug: 'debug', trace: 'debug', assert: 'error' };

export function consoleMessage(pageId: string, msg: ConsoleMessage): ServerMessage {
  const loc = msg.location();
  let source: string | undefined;
  if (loc.url) {
    try {
      source = `${new URL(loc.url).pathname.split('/').pop() || loc.url}:${loc.lineNumber}`;
    } catch {
      source = loc.url.slice(0, 80);
    }
  }
  return { t: 'console', pageId, entry: { level: LEVELS[msg.type()] ?? 'log', args: [redactText(msg.text())], ts: Date.now(), source } };
}

/** Make Chromium's net::ERR_* codes readable without hiding them. */
export function friendlyNetError(raw: string): string {
  const code = /net::(ERR_[A-Z_]+)/.exec(raw)?.[1];
  const hints: Record<string, string> = {
    ERR_NAME_NOT_RESOLVED: 'The domain could not be resolved (DNS). Check the address or your network.',
    ERR_INTERNET_DISCONNECTED: 'This machine appears to be offline.',
    ERR_CONNECTION_REFUSED: 'The server refused the connection.',
    ERR_CONNECTION_TIMED_OUT: 'The connection timed out.',
    ERR_TIMED_OUT: 'The request timed out.',
    ERR_CERT_AUTHORITY_INVALID: 'The site’s TLS certificate is not trusted.',
    ERR_CERT_COMMON_NAME_INVALID: 'The site’s TLS certificate does not match its address.',
    ERR_TUNNEL_CONNECTION_FAILED: 'The network proxy refused the connection to this site.',
    ERR_PROXY_CONNECTION_FAILED: 'The network proxy could not be reached.',
    ERR_BLOCKED_BY_CLIENT: 'The request was blocked.',
    ERR_ABORTED: 'Navigation was aborted.',
  };
  if (code && hints[code]) return `${hints[code]} (${code})`;
  if (/Timeout \d+ms exceeded/.test(raw)) return 'The page took longer than 45 seconds to respond.';
  return raw.slice(0, 300);
}
