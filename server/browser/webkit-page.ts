import type { BrowserContext, Dialog, Page, Request } from 'playwright-core';
import type {
  EmulationParams,
  EngineInfo,
  FrameHeader,
  OpenMessage,
  RemoteInput,
  ScreencastOptions,
  ServerMessage,
  VisualViewport,
  WireNetworkEntry,
} from '../../src/modules/preview-runtime/remote/protocol';
import { AgentChannel, type EnvelopeLike } from './agent-channel';
import { sanitizeEmulation } from './emulation';
import { FramePacer } from './frame-pacer';
import type { LivePage } from './live-page';
import type { BrowserManager } from './manager';
import { redactText, redactUrl } from './redact';
import { consoleMessage, friendlyNetError, pageUrl, type PageHost } from './remote-page';
import type { WebKitBrowser } from './webkit-browser';
import { FOLD_DETAIL, jpegSize, planEmulation, recreateDetail, screenshotScale, webkitContextOptions } from './webkit-emulation';
import { modifierChanges, mouseButton, toScreenPoint, TouchGesture, unknownKeyText } from './webkit-input';

/** Agent events the companion replaces with WebKit's own data (complete, incl. failed requests). */
const AGENT_EVENTS_REPLACED = new Set(['network']);
const MAX_NETWORK_PER_DOC = 3000;
const CONSOLE_BUFFER = 200;
const METRICS_INTERVAL_MS = 300;
const MODIFIER_NAMES = new Set(['Alt', 'Control', 'Meta', 'Shift']);

const OS_NAME: Record<string, string> = { linux: 'Linux', darwin: 'macOS', win32: 'Windows' };
const osName = () => OS_NAME[process.platform] ?? process.platform;

/**
 * One live page rendered by WebKit (Playwright's build), without CDP:
 *  - emulation through a dedicated BrowserContext: size changes in place (`setViewportSize`),
 *    DPR / mobile / touch / UA changes rebuild the context and reload the same URL;
 *  - "screencast" by polling viewport screenshots, paced by `FramePacer`;
 *  - input through Playwright's mouse / keyboard / touchscreen (see webkit-input.ts);
 *  - the IFDY agent through a Playwright binding + init script (same envelopes as Chromium);
 *  - lifecycle, console, page errors, network, popups and dialogs reported like RemotePage.
 */
export class WebKitPage implements LivePage {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private agent: AgentChannel | null = null;
  private closed = false;
  private acquired = false;
  private offGone: (() => void) | null = null;
  private emu: EmulationParams;
  private applied: EmulationParams | null = null;
  private emulating: Promise<void> | null = null;
  private pendingEmu: EmulationParams | null = null;
  /* screenshot stream */
  private screencast: Required<ScreencastOptions> = { enabled: false, quality: 70, maxWidth: 800, maxHeight: 1600 };
  private pacer = new FramePacer();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextAt = 0;
  private inflight: Promise<void> | null = null;
  /** A frame is out; the session calls back when the next capture may start. */
  private awaitingAck = false;
  private swapping = false;
  private lastJpeg: Buffer | null = null;
  private frameSeq = 0;
  lastFrameAt = 0;
  private visual: VisualViewport | null = null;
  private metricsAt = 0;
  private metricsKey = '';
  /* input */
  private inputQueue: RemoteInput[] = [];
  private inputBusy = false;
  private gesture = new TouchGesture();
  private heldModifiers = new Set<string>();
  /* document tracking */
  private lastUrl: string;
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
    private readonly webkit: WebKitBrowser,
  ) {
    this.emu = sanitizeEmulation(open);
    this.lastUrl = open.url;
  }

  get isStreaming() {
    return this.screencast.enabled && !this.closed;
  }

  async start() {
    this.webkit.acquire();
    this.acquired = true;
    this.offGone = this.webkit.onGone(() => {
      if (this.closed) return;
      this.host.send({ t: 'status', pageId: this.id, status: 'closed', error: 'WebKit exited. Reload to start it again.' });
      void this.close();
    });
    await this.buildPage(this.emu);
    this.sendEmulated(this.emu, []);
    if (this.open.screencast) await this.setScreencast(this.open.screencast);
    void this.navigate(this.open.url);
  }

  /** Fresh context + page for `e` (replacing the current one), with the agent and reporting attached. */
  private async buildPage(e: EmulationParams) {
    const context = await this.webkit.newContext(webkitContextOptions(e));
    if (this.closed) {
      await context.close().catch(() => {});
      return;
    }
    const page = await context.newPage();
    const agent = new AgentChannel(page, null, {
      session: String(this.open.session).slice(0, 64),
      flags: (Array.isArray(this.open.flags) ? this.open.flags : []).filter((f) => typeof f === 'string' && /^[a-z]{1,8}$/.test(f)),
      agent: this.host.agent,
      onEnvelope: (json, env) => {
        if (page === this.page) this.onAgent(json, env);
      },
    });
    await agent.install();
    this.attachEvents(page);
    const old = { context: this.context, agent: this.agent };
    this.context = context;
    this.page = page;
    this.agent = agent;
    this.applied = e;
    this.visual = null;
    this.metricsKey = '';
    this.lastJpeg = null;
    this.gesture = new TouchGesture();
    this.heldModifiers.clear();
    old.agent?.dispose();
    await old.context?.close().catch(() => {});
    if (this.closed) await context.close().catch(() => {});
  }

  /* ------------------------------------------------------------------ */
  /* Emulation                                                           */
  /* ------------------------------------------------------------------ */

  /** Coalesced like RemotePage: a fold animation only applies the latest size. */
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
          if (!this.closed) this.host.send({ t: 'error', pageId: this.id, code: 'internal', message: `Emulation failed: ${(err as Error).message.split('\n')[0]}` });
        }
      }
      this.emulating = null;
    })();
  }

  private async applyEmulation(e: EmulationParams) {
    const plan = planEmulation(this.applied, e);
    this.emu = e;
    if (plan.recreate) {
      const url = this.currentUrl();
      await this.pauseCapture(() => this.buildPage(e));
      if (this.closed) return;
      if (url) void this.navigate(url);
    } else if (this.page) {
      if (plan.resize) await this.page.setViewportSize({ width: e.device.width, height: e.device.height });
      if (plan.media) await this.page.emulateMedia({ colorScheme: e.colorScheme, reducedMotion: e.reducedMotion ? 'reduce' : null });
      this.applied = e;
    }
    this.sendEmulated(e, plan.reasons);
    this.metricsAt = 0;
    this.wake();
  }

  private sendEmulated(e: EmulationParams, reloadReasons: string[]) {
    const detail = [e.fold ? FOLD_DETAIL : '', reloadReasons.length ? recreateDetail(reloadReasons) : ''].filter(Boolean).join(' ');
    this.host.send({
      t: 'emulated',
      pageId: this.id,
      viewport: { width: e.device.width, height: e.device.height, dpr: e.device.dpr },
      displayFeature: e.fold ? 'unsupported' : 'none',
      detail: detail || undefined,
      reloaded: reloadReasons.length ? true : undefined,
    });
  }

  /** The URL to bring back after a context rebuild (the last committed or requested one). */
  private currentUrl(): string {
    const u = this.page?.url();
    return u && u !== 'about:blank' && !this.navFailed ? u : this.lastUrl;
  }

  /* ------------------------------------------------------------------ */
  /* Screenshot stream                                                   */
  /* ------------------------------------------------------------------ */

  async setScreencast(o: ScreencastOptions) {
    this.lastActivity = Date.now();
    const q = Math.round(Math.min(95, Math.max(20, o.quality ?? this.screencast.quality)));
    const mw = Math.round(Math.min(4096, Math.max(64, o.maxWidth ?? this.screencast.maxWidth)));
    const mh = Math.round(Math.min(4096, Math.max(64, o.maxHeight ?? this.screencast.maxHeight)));
    const was = this.screencast.enabled;
    this.screencast = { enabled: Boolean(o.enabled), quality: q, maxWidth: mw, maxHeight: mh };
    if (this.closed) return;
    if (!this.screencast.enabled) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      return;
    }
    // Shown again: the studio needs a fresh frame even if the page did not change.
    if (!was) this.lastJpeg = null;
    this.wake();
  }

  private canCapture() {
    return !this.closed && !this.swapping && this.screencast.enabled && Boolean(this.page);
  }

  private schedule(delay: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.canCapture() || this.inflight) return;
    this.nextAt = Date.now() + delay;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.inflight = this.capture().then(
        (next) => {
          this.inflight = null;
          if (next !== null) this.schedule(next);
        },
        () => {
          this.inflight = null;
          this.schedule(250);
        },
      );
    }, delay);
  }

  /** Capture soon (input, navigation, emulation): never overlapping a capture or skipping back-pressure. */
  private wake() {
    this.pacer.bump();
    if (this.inflight || this.awaitingAck) return;
    if (!this.timer || this.nextAt - Date.now() > 40) this.schedule(this.timer ? 16 : 0);
  }

  /** One capture; resolves to the delay before the next one, or null when the session's ack schedules it. */
  private async capture(): Promise<number | null> {
    const page = this.page;
    if (!page || !this.canCapture()) return null;
    const sc = this.screencast;
    const scale = screenshotScale(this.emu.device, sc.maxWidth, sc.maxHeight);
    const t0 = Date.now();
    let jpeg: Buffer | null = null;
    try {
      await this.refreshMetrics(page);
      // caret 'initial': keep the text caret visible (Playwright hides it by default for stable screenshots).
      jpeg = await page.screenshot({ type: 'jpeg', quality: sc.quality, scale, caret: 'initial', timeout: 5000 });
    } catch {
      /* navigating, resizing or closing: try again shortly */
    }
    const took = Date.now() - t0;
    if (page !== this.page || !this.canCapture()) return null;
    if (!jpeg) return 250;
    const changed = !this.lastJpeg || !jpeg.equals(this.lastJpeg);
    const delay = this.pacer.next(took, changed);
    if (!changed) return delay;
    this.lastJpeg = jpeg;
    const k = scale === 'device' ? this.emu.device.dpr : 1;
    const size = jpegSize(jpeg) ?? { width: this.emu.device.width * k, height: this.emu.device.height * k };
    const header: FrameHeader = {
      t: 'frame',
      pageId: this.id,
      width: Math.round(size.width / k),
      height: Math.round(size.height / k),
      ts: Date.now() / 1000,
      pageScale: this.visual?.scale ?? 1,
      seq: ++this.frameSeq,
    };
    this.lastFrameAt = Date.now();
    this.host.sendFrame(header, jpeg);
    // The session's shared budget + socket back-pressure decide when the next capture may start.
    this.awaitingAck = true;
    this.host.scheduleAck(this, () => {
      this.awaitingAck = false;
      this.schedule(delay);
    });
    return null;
  }

  /** Visual viewport (zoomed-out mobile layouts), throttled, sent when it changes. */
  private async refreshMetrics(page: Page) {
    if (Date.now() - this.metricsAt < METRICS_INTERVAL_MS) return;
    this.metricsAt = Date.now();
    const v = (await page.evaluate(VISUAL_VIEWPORT).catch(() => null)) as { width: number; height: number; scale: number; offsetX: number; offsetY: number } | null;
    if (!v || page !== this.page) return;
    const visual: VisualViewport = {
      width: Math.round(v.width * 100) / 100,
      height: Math.round(v.height * 100) / 100,
      scale: Math.round(v.scale * 10000) / 10000,
      offsetX: Math.round(v.offsetX * 100) / 100,
      offsetY: Math.round(v.offsetY * 100) / 100,
    };
    this.visual = visual;
    const key = JSON.stringify(visual);
    if (key !== this.metricsKey) {
      this.metricsKey = key;
      this.host.send({ t: 'metrics', pageId: this.id, visual });
    }
  }

  /** Stop the stream while `fn` swaps the page, then resume. */
  private async pauseCapture(fn: () => Promise<void>) {
    this.swapping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      await this.inflight?.catch(() => {});
      await fn();
    } finally {
      this.swapping = false;
      this.wake();
    }
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
    this.lastUrl = url;
    const page = this.page;
    if (!page) return;
    try {
      await page.goto(url, { waitUntil: 'commit', timeout: 45_000 });
    } catch (err) {
      if (this.closed || seq !== this.navSeq || page !== this.page) return;
      const msg = (err as Error).message.split('\n')[0].replace(/^page\.goto:\s*/, '');
      if (/interrupted by another navigation|frame was detached|navigation.*(cancel|abort)/i.test(msg)) return;
      this.navFailed = true;
      this.host.send({ t: 'status', pageId: this.id, status: 'error', url, error: friendlyNetError(msg) });
    }
  }

  async reload() {
    this.lastActivity = Date.now();
    this.navSeq++;
    const page = this.page;
    if (!page) return;
    if (this.navFailed || page.url() === 'about:blank') return void this.navigate(this.lastUrl);
    try {
      await page.reload({ waitUntil: 'commit', timeout: 45_000 });
    } catch (err) {
      if (!this.closed && page === this.page && !/interrupted by another navigation/i.test((err as Error).message)) {
        this.host.send({ t: 'status', pageId: this.id, status: 'error', error: friendlyNetError((err as Error).message.split('\n')[0]) });
      }
    }
  }

  async history(direction: 'back' | 'forward') {
    try {
      if (direction === 'back') await this.page?.goBack({ waitUntil: 'commit', timeout: 15_000 });
      else await this.page?.goForward({ waitUntil: 'commit', timeout: 15_000 });
    } catch {
      /* no history entry */
    }
  }

  /** Events of a replaced page (context rebuild) are ignored. */
  private attachEvents(page: Page) {
    const live = () => page === this.page && !this.closed;
    page.on('request', (req) => {
      this.requestStart.set(req, Date.now());
      if (!live()) return;
      if (req.frame() === page.mainFrame() && req.isNavigationRequest()) {
        this.navPending = true;
        this.navRequest = req;
        this.navFailed = false;
        this.navStart = Date.now();
        this.wake();
        this.host.send({ t: 'status', pageId: this.id, status: 'loading', url: pageUrl(req.url()) });
      }
    });
    page.on('requestfinished', (req) => {
      if (live()) void this.onRequestDone(page, req, null);
    });
    page.on('requestfailed', (req) => {
      if (!live()) return;
      const reason = req.failure()?.errorText ?? 'Failed';
      void this.onRequestDone(page, req, reason);
      // WebKit reports a navigation replaced by another one as "cancelled".
      if (req === this.navRequest && !/ERR_ABORTED|cancel/i.test(reason)) {
        this.navFailed = true;
        this.host.send({ t: 'status', pageId: this.id, status: 'error', url: pageUrl(req.url()), error: friendlyNetError(reason) });
      }
    });
    page.on('framenavigated', (frame) => {
      if (!live() || frame !== page.mainFrame()) return;
      const url = pageUrl(frame.url());
      if (url !== 'about:blank') this.lastUrl = url;
      if (this.navPending) {
        // A new document committed: reset per-document state.
        this.navPending = false;
        this.doc = { agentAlive: false, flushed: false, loaded: false, buffer: [], netCount: 0 };
        this.metricsAt = 0;
      } else {
        this.host.send({ t: 'navigated', pageId: this.id, url });
      }
    });
    page.on('load', () => {
      if (!live()) return;
      this.doc.loaded = true;
      this.wake();
      void (async () => {
        const httpStatus = (await this.navRequest?.response().then((r) => r?.status() ?? null).catch(() => null)) ?? null;
        const title = await page.title().catch(() => '');
        if (!live() || this.navFailed) return;
        this.host.send({ t: 'status', pageId: this.id, status: 'ready', url: pageUrl(page.url()), title: redactText(title, 300), httpStatus });
      })();
      // Documents where the agent cannot run (error pages, CSP crashes) still report WebKit's console.
      const doc = this.doc;
      setTimeout(() => {
        if (!live() || doc !== this.doc || doc.agentAlive) return;
        doc.flushed = true;
        for (const m of doc.buffer) this.host.send(m);
        doc.buffer = [];
      }, 2000);
    });
    page.on('console', (msg) => {
      if (live()) this.onEngineLog(consoleMessage(this.id, msg));
    });
    page.on('pageerror', (err) => {
      if (live()) this.onEngineLog({ t: 'pageerror', pageId: this.id, error: { message: redactText(err.message, 2000), stack: err.stack ? redactText(err.stack, 4000) : undefined, ts: Date.now() } });
    });
    page.on('crash', () => {
      if (live()) this.host.send({ t: 'status', pageId: this.id, status: 'crashed', error: 'The page crashed in WebKit (out of memory or a web process fault).' });
    });
    page.on('close', () => {
      if (live()) this.host.send({ t: 'status', pageId: this.id, status: 'closed', error: 'The page was closed.' });
    });
    page.on('dialog', (d: Dialog) => {
      if (live()) this.host.send({ t: 'dialog', pageId: this.id, dialogType: d.type(), message: redactText(d.message(), 500) });
      (d.type() === 'beforeunload' ? d.accept() : d.dismiss()).catch(() => {});
    });
    page.on('popup', async (popup) => {
      // New windows would open in this page's context unseen; close them and let the studio decide.
      let url = popup.url();
      if (!url || url === 'about:blank') {
        url = await popup
          .waitForEvent('request', { timeout: 2500 })
          .then((r) => r.url())
          .catch(() => popup.url());
      }
      await popup.close().catch(() => {});
      if (live() && url && url !== 'about:blank') this.host.send({ t: 'popup', pageId: this.id, url: pageUrl(url) });
    });
  }

  private onEngineLog(msg: ServerMessage) {
    const doc = this.doc;
    if (doc.agentAlive) return;
    if (doc.flushed) this.host.send(msg);
    else if (doc.buffer.length < CONSOLE_BUFFER) doc.buffer.push(msg);
  }

  private async onRequestDone(page: Page, req: Request, failure: string | null) {
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
      failureReason: failure ? redactText(failure, 300) : status !== null && status >= 400 ? `HTTP ${status}` : undefined,
      initiator: req.frame() === page.mainFrame() ? undefined : 'subframe',
      fromCache: resp ? resp.fromServiceWorker() || undefined : undefined,
      source: 'webkit',
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
    // Inspection overlays (hover, selection) change the page: capture right away.
    if (env?.kind === 'event') this.wake();
    if (env && env.kind === 'event' && env.event && AGENT_EVENTS_REPLACED.has(env.event)) return;
    this.host.sendRaw(`{"t":"agent","pageId":${JSON.stringify(this.id)},"env":${json}}`);
  }

  toAgent(env: unknown) {
    this.lastActivity = Date.now();
    void this.agent?.deliver(env).then(() => this.wake());
  }

  /* ------------------------------------------------------------------ */
  /* Input                                                               */
  /* ------------------------------------------------------------------ */

  input(ev: RemoteInput) {
    this.lastActivity = Date.now();
    if (!ev || typeof ev !== 'object') return;
    const last = this.inputQueue[this.inputQueue.length - 1];
    if (last && ev.kind === 'mouse' && ev.type === 'move' && last.kind === 'mouse' && last.type === 'move' && last.buttons === ev.buttons) {
      this.inputQueue[this.inputQueue.length - 1] = ev;
    } else if (last && ev.kind === 'wheel' && last.kind === 'wheel') {
      this.inputQueue[this.inputQueue.length - 1] = { ...ev, deltaX: last.deltaX + ev.deltaX, deltaY: last.deltaY + ev.deltaY };
    } else {
      // Touch moves are not coalesced: the gesture needs every delta to pan by the right amount.
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
        const page = this.page;
        if (!page || this.swapping) continue;
        try {
          await this.dispatch(page, ev);
        } catch {
          /* navigating; drop the event */
        }
        this.wake();
      }
    } finally {
      this.inputBusy = false;
    }
  }

  private async dispatch(page: Page, ev: RemoteInput) {
    const d = this.emu.device;
    // Mouse coordinates are layout CSS px; zoomed-out mobile layouts are wider than the device.
    const layoutW = this.visual && this.visual.scale > 0 ? Math.max(d.width, this.visual.width) : d.width;
    const layoutH = this.visual && this.visual.scale > 0 ? Math.max(d.height, this.visual.height) : d.height;
    const cx = (n: unknown) => Math.min(layoutW + 50, Math.max(-50, num(n)));
    const cy = (n: unknown) => Math.min(layoutH + 50, Math.max(-50, num(n)));
    const modifiers = Math.max(0, Math.min(15, Math.round(num((ev as { modifiers?: number }).modifiers))));
    switch (ev.kind) {
      case 'mouse': {
        await this.syncModifiers(page, modifiers);
        const x = cx(ev.x);
        const y = cy(ev.y);
        await page.mouse.move(x, y);
        if (ev.type === 'move') return;
        const button = mouseButton(ev.button);
        if (!button) return;
        const clickCount = Math.max(1, Math.min(3, Math.round(num(ev.clickCount) || 1)));
        if (ev.type === 'down') await page.mouse.down({ button, clickCount });
        else await page.mouse.up({ button, clickCount });
        return;
      }
      case 'wheel': {
        const dx = Math.max(-5000, Math.min(5000, num(ev.deltaX)));
        const dy = Math.max(-5000, Math.min(5000, num(ev.deltaY)));
        if (d.mobile) {
          // Playwright has no wheel in mobile WebKit: scroll what is under the pointer instead.
          await scrollAt(page, { x: cx(ev.x), y: cy(ev.y), dx, dy });
          return;
        }
        await page.mouse.move(cx(ev.x), cy(ev.y));
        await page.mouse.wheel(dx, dy);
        return;
      }
      case 'key': {
        const key = typeof ev.key === 'string' ? ev.key.slice(0, 32) : '';
        if (!key) return;
        if (MODIFIER_NAMES.has(key)) {
          if (ev.type === 'down') this.heldModifiers.add(key);
          else this.heldModifiers.delete(key);
        }
        try {
          if (ev.type === 'down') await page.keyboard.down(key);
          else await page.keyboard.up(key);
        } catch {
          // Not in Playwright's US layout (é, ß, non-Latin): type the character instead.
          const text = unknownKeyText(key, ev.type, modifiers);
          if (text) await page.keyboard.insertText(text);
        }
        return;
      }
      case 'char':
      case 'insertText':
        if (typeof ev.text === 'string' && ev.text) await page.keyboard.insertText(ev.text.slice(0, ev.kind === 'char' ? 8 : 100_000));
        return;
      case 'touch': {
        if (!d.touch) return;
        const type = ev.type === 'start' || ev.type === 'move' || ev.type === 'end' ? ev.type : 'cancel';
        const points = (Array.isArray(ev.points) ? ev.points : []).slice(0, 10).map((p) => ({ x: cx(p.x), y: cy(p.y), id: Math.round(num(p.id)) }));
        for (const a of this.gesture.feed(type, points)) {
          if (a.type === 'tap') {
            const p = toScreenPoint(a, this.visual);
            await page.touchscreen.tap(p.x, p.y);
          } else {
            await scrollAt(page, a);
          }
        }
        return;
      }
    }
  }

  private async syncModifiers(page: Page, mask: number) {
    const { press, release } = modifierChanges(this.heldModifiers, mask);
    for (const k of press) {
      this.heldModifiers.add(k);
      await page.keyboard.down(k);
    }
    for (const k of release) {
      this.heldModifiers.delete(k);
      await page.keyboard.up(k);
    }
  }

  /* ------------------------------------------------------------------ */

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.netTimer) clearTimeout(this.netTimer);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.agent?.dispose();
    this.offGone?.();
    this.inputQueue = [];
    const ctx = this.context;
    this.context = null;
    await ctx?.close().catch(() => {});
    if (this.acquired) {
      this.acquired = false;
      this.webkit.release();
    }
  }
}

const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/**
 * Runs in the page: scroll the innermost scrollable element under (x, y) along the delta,
 * or the document. Stands in for wheel events (mobile WebKit) and touch panning.
 * Page-side code is kept as source text: transpilers (tsx, Vite SSR) may inject helpers
 * such as `__name` into a function's body, which do not exist in the page.
 */
const VISUAL_VIEWPORT = `(function () {
  var vv = window.visualViewport;
  return vv ? { width: vv.width, height: vv.height, scale: vv.scale, offsetX: vv.offsetLeft, offsetY: vv.offsetTop } : null;
})()`;

const SCROLL_AT = `(function (a) {
  function scrollable(el, vertical) {
    var s = getComputedStyle(el);
    if (!/(auto|scroll|overlay)/.test(vertical ? s.overflowY : s.overflowX)) return false;
    return vertical ? el.scrollHeight > el.clientHeight : el.scrollWidth > el.clientWidth;
  }
  for (var el = document.elementFromPoint(a.x, a.y); el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    if ((a.dy && scrollable(el, true)) || (a.dx && scrollable(el, false))) { el.scrollBy(a.dx, a.dy); return; }
  }
  window.scrollBy(a.dx, a.dy);
})`;

const scrollAt = (page: Page, a: { x: number; y: number; dx: number; dy: number }) =>
  page.evaluate(`${SCROLL_AT}(${JSON.stringify({ x: num(a.x), y: num(a.y), dx: num(a.dx), dy: num(a.dy) })})`);

/** Factory used by the session (see live-page.ts). */
export function createWebKitPage(id: string, host: PageHost, open: OpenMessage, manager: BrowserManager): LivePage {
  return new WebKitPage(id, host, open, manager.webkit);
}

export async function webkitStatus(manager: BrowserManager): Promise<EngineInfo> {
  const features = { inspect: true, input: true, touch: true, foldEmulation: false, rotate: true };
  const detail = `Safari's engine (WebKit) on ${osName()} — not iOS Safari: no iOS browser UI or native form controls; fonts and some iOS-only behaviour differ.`;
  try {
    const s = await manager.webkit.status();
    const label = manager.webkit.version ? `WebKit ${manager.webkit.version}` : 'WebKit';
    if (!s.available) return { id: 'webkit', available: false, label, detail: s.reason, features: { ...features, inspect: false, input: false, touch: false, rotate: false } };
    return { id: 'webkit', available: true, label, detail, features };
  } catch (err) {
    return { id: 'webkit', available: false, label: 'WebKit', detail: `WebKit status check failed: ${(err as Error).message.split('\n')[0]}`, features: { ...features, inspect: false, input: false, touch: false, rotate: false } };
  }
}
