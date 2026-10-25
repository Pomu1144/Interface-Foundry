import path from 'node:path';
import {
  isAllowedRemoteUrl,
  type EmulationParams,
  type EngineInfo,
  type FrameHeader,
  type OpenMessage,
  type RemoteInput,
  type ScreencastOptions,
} from '../../src/modules/preview-runtime/remote/protocol';
import type { LivePage } from '../browser/live-page';
import type { BrowserManager } from '../browser/manager';
import type { PageHost } from '../browser/remote-page';
import { sanitizeEmulation } from '../browser/emulation';
import { redactText } from '../browser/redact';
import { AXE_DONE_SCRIPT, AXE_REQUEST_PREFIX, buildAxeScript, buildInstallScript, DELIVER_SCRIPT, MAX_DRAIN_BYTES, SCROLL_SCRIPT, TICK_SCRIPT, type TickResult } from './bridge';
import { defaultIosDeps, type IosDeps } from './deps';
import { gestureToActions, InputMapper, jobToIdb, keyToActions, textToActions, type InputJob } from './input';
import { engineInfo, SimulatorPool, type DeviceLease } from './pool';
import { jpegSize, openUrl, pngSize, setAppearance, simctl } from './simctl';
import { friendlyDriverError, isSessionGone, launchSafariDriver, simulatorCapabilities, WebDriverClient, WebDriverError, type DriverHandle } from './webdriver';

/** How often page state (navigation, agent queue, viewport) is polled over WebDriver. */
export const TICK_MS = 150;
/** Poll interval while the screen is unchanged. */
const IDLE_FRAME_MS = 250;
const ERROR_FRAME_MS = 1000;
const MAX_ENVELOPE = 48 * 1024 * 1024;
const MAX_PENDING_INPUT = 60;
const POPUP_CHECK_EVERY = 14;

class PageClosed extends Error {
  constructor() {
    super('Page closed');
  }
}

const isHttp = (u: string) => /^https?:/i.test(u);

/**
 * Real Mobile Safari in Xcode's iOS Simulator (macOS companion only).
 *
 * Preferred path ("webdriver"): safaridriver drives Safari in an IFDY simulator.
 * Frames are WebDriver viewport screenshots, input is W3C Actions, and the IFDY
 * agent is installed and relayed through Execute Script, so the board is
 * inspectable like a Chromium one.
 *
 * Fallback ("simctl"): when no safaridriver session can be created, the page is
 * opened with `simctl openurl` and the whole simulator screen is mirrored with
 * `simctl io screenshot`; input goes through `idb` when installed, otherwise the
 * board is view-only. No inspection in this mode.
 *
 * Written and unit-tested without a Mac: see docs/IOS_SIMULATOR.md.
 */
export class SimulatorPage implements LivePage {
  lastFrameAt = 0;
  lastActivity = Date.now();
  mode: 'webdriver' | 'simctl' | null = null;
  private closed = false;
  private gone = false;
  private lease: DeviceLease | null = null;
  private driver: DriverHandle | null = null;
  private wd: WebDriverClient | null = null;
  private idb = false;
  private fallbackReason = '';
  private emu: EmulationParams;
  private screencast: Required<ScreencastOptions> = { enabled: false, quality: 70, maxWidth: 800, maxHeight: 1600 };
  private streaming = false;
  private chain: Promise<unknown> = Promise.resolve();
  private frameTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly token = Math.random().toString(36).slice(2, 12);
  private readonly session: string;
  private readonly flags: string[];
  /** Layout viewport measured in Safari (or the screen, in simctl mode). */
  private viewport: { width: number; height: number; dpr: number };
  private visualKey = '';
  private visualScale = 1;
  private emulatedKey = '';
  private doc = { readySent: false, installTries: 0, href: '' };
  private navSeq = 0;
  /** A `loading` status was already sent for the navigation in flight. */
  private navAnnounced = false;
  private currentUrl: string;
  private lastShot: string | Buffer | null = null;
  private frameSeq = 0;
  private shotErrors = 0;
  private tickErrors = 0;
  private ticks = 0;
  private mainHandle = '';
  private orientation: 'portrait' | 'landscape' = 'portrait';
  private rotateNote = '';
  private screenshotMismatch = false;
  private appearance: 'light' | 'dark' | null = null;
  private pendingInput = 0;
  private installScript: { agent: string; script: string } | null = null;
  private readonly mapper: InputMapper;

  constructor(
    readonly id: string,
    private readonly host: PageHost,
    private readonly open: OpenMessage,
    private readonly pool: SimulatorPool,
    private readonly deps: IosDeps = pool.deps,
  ) {
    this.emu = sanitizeEmulation(open);
    this.session = String(open.session).slice(0, 64);
    this.flags = (Array.isArray(open.flags) ? open.flags : []).filter((f) => typeof f === 'string' && /^[a-z]{1,8}$/.test(f));
    this.viewport = { width: this.emu.device.width, height: this.emu.device.height, dpr: this.emu.device.dpr };
    this.currentUrl = open.url;
    this.mapper = new InputMapper((job) => this.onInputJob(job));
  }

  get isStreaming() {
    return this.streaming;
  }

  get deviceLease() {
    return this.lease;
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  async start() {
    const probe = await this.pool.status();
    if (!probe.available) throw new Error(probe.detail);
    try {
      this.lease = await this.pool.acquire(this.id, this.open.deviceId, this.emu.device);
    } catch (err) {
      // The setup may have changed (Xcode updated, runtime removed): probe again next time.
      this.pool.invalidate();
      throw err;
    }
    if (this.closed) return this.releaseLease();
    if (probe.safaridriver) {
      try {
        await this.startWebDriver();
        this.mode = 'webdriver';
      } catch (err) {
        this.fallbackReason = `safaridriver could not start a session: ${friendlyDriverError(err)}`;
        await this.stopWebDriver();
      }
    } else {
      this.fallbackReason = 'safaridriver was not found on this Mac.';
    }
    if (this.closed) return;
    if (!this.mode) {
      this.mode = 'simctl';
      this.idb = probe.idb;
    }
    await this.applyAppearance(this.emu.colorScheme);
    const wanted = this.orientationOf(this.emu);
    if (wanted !== this.orientation) await this.rotate(wanted);
    this.sendEmulated(true);
    if (this.open.screencast) await this.setScreencast(this.open.screencast);
    if (this.mode === 'webdriver') this.scheduleTick(0);
    void this.navigate(this.open.url);
  }

  private async startWebDriver() {
    const lease = this.lease!;
    const driver = await launchSafariDriver(this.deps);
    this.driver = driver;
    this.pool.trackDriver(driver.child);
    const wd = new WebDriverClient(driver.url, this.deps.fetch);
    await wd.newSession(simulatorCapabilities(lease));
    this.wd = wd;
    await wd.setTimeouts({ script: 30_000, pageLoad: 60_000, implicit: 0 }).catch(() => {});
    this.mainHandle = await wd.windowHandle().catch(() => '');
  }

  private async stopWebDriver() {
    const wd = this.wd;
    this.wd = null;
    if (wd) await wd.deleteSession(8000).catch(() => {});
    this.driver?.stop();
    this.driver = null;
  }

  private releaseLease() {
    if (this.lease) this.pool.release(this.lease);
    this.lease = null;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.streaming = false;
    if (this.frameTimer) clearTimeout(this.frameTimer);
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.frameTimer = this.tickTimer = null;
    this.mapper.dispose();
    await this.stopWebDriver();
    this.releaseLease();
  }

  /** Commands to one WebDriver session / simulator run strictly one at a time. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(() => {
      if (this.closed || this.gone) throw new PageClosed();
      return fn();
    });
    this.chain = next.catch(() => {});
    return next;
  }

  /** A WebDriver call that survives a JavaScript dialog (reported to the studio, then dismissed). */
  private async call<T>(fn: (wd: WebDriverClient) => Promise<T>): Promise<T> {
    const wd = this.wd;
    if (!wd) throw new PageClosed();
    try {
      return await fn(wd);
    } catch (err) {
      if (!(err instanceof WebDriverError) || err.error !== 'unexpected alert open') throw err;
      let text = typeof err.data?.text === 'string' ? err.data.text : '';
      const shown = await wd.alertText().catch(() => null);
      if (typeof shown === 'string') text = shown;
      await wd.dismissAlert().catch(() => {});
      this.host.send({ t: 'dialog', pageId: this.id, dialogType: 'dialog', message: redactText(text, 500) });
      return await fn(wd);
    }
  }

  /** The automation session is gone: stop polling and tell the studio (a reload reopens it). */
  private onDriverError(err: unknown) {
    if (this.closed || this.gone || err instanceof PageClosed) return;
    if (isSessionGone(err)) {
      this.gone = true;
      this.streaming = false;
      this.host.send({
        t: 'status',
        pageId: this.id,
        status: 'closed',
        error: `Safari's automation session in the simulator ended (${friendlyDriverError(err)}).`,
      });
      return;
    }
    if (++this.tickErrors === 8) {
      this.host.send({ t: 'status', pageId: this.id, status: 'error', url: this.currentUrl, error: `Lost contact with Safari in the simulator: ${friendlyDriverError(err)}` });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Navigation                                                          */
  /* ------------------------------------------------------------------ */

  async navigate(url: string) {
    this.lastActivity = Date.now();
    if (this.closed) return;
    const forbidden = !isAllowedRemoteUrl(url) ? 'Only http(s) URLs can be opened in the iOS Simulator.' : this.host.isForbiddenUrl(url);
    if (forbidden) {
      this.host.send({ t: 'status', pageId: this.id, status: 'error', url, error: forbidden });
      return;
    }
    const seq = ++this.navSeq;
    this.currentUrl = url;
    this.navAnnounced = true;
    this.host.send({ t: 'status', pageId: this.id, status: 'loading', url });
    if (this.mode === 'webdriver') {
      try {
        await this.run(() => this.call((wd) => wd.navigateTo(url)));
        await this.settleAfterNavigation(seq);
      } catch (err) {
        if (this.closed || seq !== this.navSeq || err instanceof PageClosed) return;
        this.navAnnounced = false;
        if (isSessionGone(err)) return this.onDriverError(err);
        this.host.send({ t: 'status', pageId: this.id, status: 'error', url, error: friendlyNavError(err) });
      }
      return;
    }
    try {
      await this.run(() => openUrl(this.deps, this.lease!.udid, url));
    } catch (err) {
      if (this.closed || seq !== this.navSeq || err instanceof PageClosed) return;
      this.host.send({ t: 'status', pageId: this.id, status: 'error', url, error: `simctl could not open the page: ${(err as Error).message}` });
      return;
    }
    // simctl cannot observe page loads: report ready once Safari has had a moment.
    setTimeout(() => {
      if (!this.closed && seq === this.navSeq) this.host.send({ t: 'status', pageId: this.id, status: 'ready', url, title: '', httpStatus: null });
    }, 1500).unref?.();
  }

  /**
   * After a blocking WebDriver navigation: poll once so a new document reports
   * `ready` right away; a same-document navigation (hash change) never produces
   * a fresh document, so it is reported ready here.
   */
  private async settleAfterNavigation(seq: number) {
    await this.run(() => this.tick()).catch((err) => this.onDriverError(err));
    if (this.closed || seq !== this.navSeq || !this.navAnnounced) return;
    this.navAnnounced = false;
    this.doc.readySent = true;
    this.host.send({ t: 'status', pageId: this.id, status: 'ready', url: this.doc.href || this.currentUrl, httpStatus: null });
  }

  async reload() {
    this.lastActivity = Date.now();
    if (this.mode !== 'webdriver') return this.navigate(this.currentUrl);
    const seq = ++this.navSeq;
    this.navAnnounced = true;
    this.host.send({ t: 'status', pageId: this.id, status: 'loading', url: this.doc.href || this.currentUrl });
    try {
      await this.run(() => this.call((wd) => wd.refresh()));
      await this.settleAfterNavigation(seq);
    } catch (err) {
      if (this.closed || err instanceof PageClosed) return;
      this.navAnnounced = false;
      if (isSessionGone(err)) return this.onDriverError(err);
      this.host.send({ t: 'status', pageId: this.id, status: 'error', error: friendlyNavError(err) });
    }
  }

  async history(direction: 'back' | 'forward') {
    this.lastActivity = Date.now();
    // simctl has no history API; the board's own back/forward stay inert in that mode.
    if (this.mode !== 'webdriver') return;
    try {
      await this.run(() => this.call((wd) => (direction === 'back' ? wd.back() : wd.forward())));
      this.nudgeTick();
    } catch (err) {
      this.onDriverError(err);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Polling: navigation, agent queue, viewport                          */
  /* ------------------------------------------------------------------ */

  private scheduleTick(delay = TICK_MS) {
    if (this.closed || this.gone || this.mode !== 'webdriver' || this.tickTimer) return;
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      void this.run(() => this.tick())
        .catch((err) => this.onDriverError(err))
        .finally(() => this.scheduleTick());
    }, delay);
  }

  /** Poll sooner (after studio -> agent messages or input) so responses arrive promptly. */
  private nudgeTick() {
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.tickTimer = null;
    this.scheduleTick(20);
  }

  /** One poll. Runs inside the command chain. */
  private async tick() {
    const r = await this.call((wd) => wd.execute<TickResult>(TICK_SCRIPT, [this.token, MAX_DRAIN_BYTES]));
    this.tickErrors = 0;
    if (!r || typeof r !== 'object' || typeof r.href !== 'string') return;
    this.updateViewport(r);
    if (r.fresh && !isHttp(r.href)) {
      // about:blank before the first load, or a Safari-internal page: nothing to report or inspect.
      this.doc = { readySent: true, installTries: 3, href: r.href };
    } else if (r.fresh) {
      // A new document: announce it unless the studio already knows a navigation is in flight.
      if (!this.navAnnounced) this.host.send({ t: 'status', pageId: this.id, status: 'loading', url: r.href });
      this.navAnnounced = false;
      this.doc = { readySent: false, installTries: 0, href: r.href };
    } else if (r.href !== this.doc.href) {
      this.doc.href = r.href;
      if (this.doc.readySent) this.host.send({ t: 'navigated', pageId: this.id, url: r.href.slice(0, 4096) });
    }
    if (!r.bridge && r.readyState !== 'loading' && this.doc.installTries < 3 && isHttp(r.href)) {
      this.doc.installTries++;
      await this.install();
    }
    if (!this.doc.readySent && r.readyState === 'complete') {
      this.doc.readySent = true;
      this.host.send({ t: 'status', pageId: this.id, status: 'ready', url: r.href.slice(0, 4096), title: redactText(r.title, 300), httpStatus: r.httpStatus ?? null });
    }
    for (const item of Array.isArray(r.queue) ? r.queue : []) this.onQueued(item);
    if (++this.ticks % POPUP_CHECK_EVERY === 0) await this.closePopups();
  }

  private async install() {
    const agent = await this.host.agent.get();
    if (this.installScript?.agent !== agent) this.installScript = { agent, script: buildInstallScript(agent) };
    const script = this.installScript.script;
    await this.call((wd) => wd.execute(script, [{ session: this.session, flags: this.flags }, this.token], 30_000)).catch((err) => {
      if (isSessionGone(err)) throw err;
      /* CSP / navigation race: retried on the next tick (bounded by installTries) */
    });
  }

  private onQueued(item: unknown) {
    if (typeof item !== 'string') return;
    if (item.startsWith(AXE_REQUEST_PREFIX)) {
      const id = item.slice(AXE_REQUEST_PREFIX.length).slice(0, 32);
      void this.run(() => this.loadAxe(id)).catch((err) => this.onDriverError(err));
      return;
    }
    if (item.length > MAX_ENVELOPE) return;
    let env: { session?: unknown } | null;
    try {
      // Always parse: page-controlled text must be well-formed JSON before it is spliced into a message.
      env = JSON.parse(item) as { session?: unknown };
    } catch {
      return;
    }
    if (!env || typeof env !== 'object' || env.session !== this.session) return;
    this.host.sendRaw(`{"t":"agent","pageId":${JSON.stringify(this.id)},"env":${item}}`);
  }

  private async loadAxe(id: string) {
    let ok = false;
    let error = '';
    try {
      const code = await this.host.agent.getAxe();
      ok = Boolean(await this.call((wd) => wd.execute<boolean>(buildAxeScript(code), [], 60_000)));
      if (!ok) error = 'axe-core did not register on window (the page may redefine "axe" or "module").';
    } catch (err) {
      if (isSessionGone(err)) throw err;
      error = `Could not load axe-core into this page: ${(err as Error).message}`;
    }
    await this.call((wd) => wd.execute(AXE_DONE_SCRIPT, [id, ok, error]));
  }

  /** New windows/tabs would hide the page under test: close them and report the URL. */
  private async closePopups() {
    if (!this.mainHandle) return;
    const handles = await this.call((wd) => wd.windowHandles()).catch(() => [] as string[]);
    for (const h of Array.isArray(handles) ? handles : []) {
      if (h === this.mainHandle) continue;
      try {
        await this.wd!.switchToWindow(h);
        const url = await this.wd!.getUrl().catch(() => '');
        await this.wd!.closeWindow();
        if (url && isHttp(url)) this.host.send({ t: 'popup', pageId: this.id, url: url.slice(0, 4096) });
      } catch {
        /* already gone */
      }
    }
    if (handles.length > 1) await this.wd?.switchToWindow(this.mainHandle).catch(() => {});
  }

  private updateViewport(r: TickResult) {
    if (r.innerWidth > 0 && r.innerHeight > 0) {
      this.viewport = { width: r.innerWidth, height: r.innerHeight, dpr: r.dpr > 0 ? r.dpr : this.viewport.dpr };
      this.sendEmulated();
    }
    if (r.visual && r.visual.width > 0) {
      const v = r.visual;
      const visual = {
        width: Math.round(v.width * 100) / 100,
        height: Math.round(v.height * 100) / 100,
        scale: Math.round(v.scale * 10000) / 10000,
        offsetX: Math.round(v.offsetX * 100) / 100,
        offsetY: Math.round(v.offsetY * 100) / 100,
      };
      this.visualScale = visual.scale || 1;
      const key = JSON.stringify(visual);
      if (key !== this.visualKey) {
        this.visualKey = key;
        this.host.send({ t: 'metrics', pageId: this.id, visual });
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Emulation: the simulator is the device; report what it really is    */
  /* ------------------------------------------------------------------ */

  emulate(e: Partial<EmulationParams>) {
    this.lastActivity = Date.now();
    const next = sanitizeEmulation(e);
    const prevScheme = this.emu.colorScheme;
    this.emu = next;
    const wanted = this.orientationOf(next);
    void (async () => {
      if (wanted !== this.orientation) await this.rotate(wanted);
      if (next.colorScheme !== prevScheme) await this.applyAppearance(next.colorScheme);
      if (!this.closed) this.sendEmulated(true);
    })();
  }

  private orientationOf(e: EmulationParams): 'portrait' | 'landscape' {
    return e.device.orientation ?? (e.device.width > e.device.height ? 'landscape' : 'portrait');
  }

  private async rotate(o: 'portrait' | 'landscape') {
    if (this.mode !== 'webdriver') {
      this.rotateNote = o === 'landscape' ? 'simctl cannot rotate the simulator, so it stays in portrait.' : '';
      return;
    }
    try {
      await this.run(() => this.call((wd) => wd.setOrientation(o === 'landscape' ? 'LANDSCAPE' : 'PORTRAIT')));
      this.orientation = o;
      this.rotateNote = '';
      this.nudgeTick();
    } catch (err) {
      if (err instanceof PageClosed) return;
      if (isSessionGone(err)) return this.onDriverError(err);
      this.rotateNote = o === 'landscape' ? 'safaridriver cannot rotate the simulator, so it stays in portrait.' : '';
    }
  }

  /** Light/dark is a simulator-wide setting; it is only changed on IFDY's own simulators. */
  private async applyAppearance(scheme: 'light' | 'dark' | null) {
    const lease = this.lease;
    if (!lease || !lease.name.startsWith('IFDY ')) return;
    const mode = scheme ?? (this.appearance === 'dark' ? 'light' : null);
    if (!mode || mode === this.appearance) return;
    try {
      await setAppearance(this.deps, lease.udid, mode);
      this.appearance = mode;
    } catch {
      /* older Xcode without `simctl ui`: the page keeps the simulator's appearance */
    }
  }

  private describe(): string {
    const l = this.lease;
    if (!l) return '';
    const parts: string[] = [];
    if (this.mode === 'webdriver') {
      parts.push(`Real Mobile Safari on ${l.deviceType} (${l.runtimeName} Simulator). The viewport is Safari's own and cannot be resized.`);
    } else {
      parts.push(
        `${l.deviceType} (${l.runtimeName} Simulator) mirrored with simctl: the whole screen, including the status bar and Safari's address bar. ${this.fallbackReason} ${
          this.idb ? 'Input goes through idb.' : 'View-only: install idb for touch and typing.'
        } No inspection in this mode.`,
      );
    }
    if (l.substitute) parts.push(`No ${l.substitute} simulator is installed; showing ${l.deviceType} instead.`);
    if (this.rotateNote) parts.push(this.rotateNote);
    if (this.emu.fold) parts.push('Foldable postures cannot be simulated on iOS.');
    if (this.screenshotMismatch) parts.push("Safari's screenshots cover more than the page viewport, so inspection overlays may be offset.");
    parts.push('Not yet verified on real hardware.');
    return parts.join(' ');
  }

  private sendEmulated(force = false) {
    if (!this.lease) return;
    const viewport = { width: Math.round(this.viewport.width), height: Math.round(this.viewport.height), dpr: this.viewport.dpr };
    const detail = this.describe();
    const displayFeature = this.emu.fold ? ('unsupported' as const) : ('none' as const);
    const input = this.mode === 'webdriver' || (this.mode === 'simctl' && this.idb);
    const key = JSON.stringify([viewport, detail, displayFeature, input]);
    if (!force && key === this.emulatedKey) return;
    this.emulatedKey = key;
    this.host.send({ t: 'emulated', pageId: this.id, viewport, displayFeature, detail, input });
  }

  /* ------------------------------------------------------------------ */
  /* Frames                                                              */
  /* ------------------------------------------------------------------ */

  async setScreencast(o: ScreencastOptions) {
    this.lastActivity = Date.now();
    this.screencast = {
      enabled: Boolean(o.enabled),
      quality: Math.round(Math.min(95, Math.max(20, o.quality ?? this.screencast.quality))),
      maxWidth: Math.round(Math.min(4096, Math.max(64, o.maxWidth ?? this.screencast.maxWidth))),
      maxHeight: Math.round(Math.min(4096, Math.max(64, o.maxHeight ?? this.screencast.maxHeight))),
    };
    if (this.closed || this.gone) return;
    if (!this.screencast.enabled) {
      this.streaming = false;
      if (this.frameTimer) clearTimeout(this.frameTimer);
      this.frameTimer = null;
      return;
    }
    if (this.streaming) return;
    this.streaming = true;
    this.lastShot = null;
    this.scheduleFrame(0);
  }

  private scheduleFrame(delay: number) {
    if (!this.streaming || this.closed || this.gone || this.frameTimer) return;
    this.frameTimer = setTimeout(() => {
      this.frameTimer = null;
      void this.captureFrame();
    }, delay);
  }

  private async captureFrame() {
    let sent = false;
    let failed = false;
    try {
      if (this.mode === 'webdriver') {
        const b64 = await this.run(() => this.call((wd) => wd.screenshot()));
        if (typeof b64 === 'string' && b64 && b64 !== this.lastShot) {
          this.lastShot = b64;
          const png = Buffer.from(b64, 'base64');
          this.emitFrame(this.headerForPng(png), png);
          sent = true;
        }
      } else if (this.mode === 'simctl') {
        const jpeg = await this.run(() => this.simctlScreenshot());
        if (!(this.lastShot instanceof Buffer) || !jpeg.equals(this.lastShot)) {
          this.lastShot = jpeg;
          this.emitFrame(this.headerForJpeg(jpeg), jpeg);
          sent = true;
        }
      }
      this.shotErrors = 0;
    } catch (err) {
      if (this.closed || err instanceof PageClosed) return;
      failed = true;
      if (isSessionGone(err)) return this.onDriverError(err);
      if (++this.shotErrors === 5) {
        this.host.send({ t: 'status', pageId: this.id, status: 'error', url: this.currentUrl, error: `Could not capture the simulator screen: ${friendlyDriverError(err)}` });
      }
    }
    if (!this.streaming || this.closed) return;
    // Paced by the session's shared frame budget and socket backpressure, like Chromium's acks.
    if (sent) this.host.scheduleAck(this, () => this.scheduleFrame(0));
    else this.scheduleFrame(failed ? ERROR_FRAME_MS : IDLE_FRAME_MS);
  }

  private emitFrame(header: FrameHeader, image: Buffer) {
    this.lastFrameAt = Date.now();
    this.host.sendFrame(header, image);
  }

  /**
   * Frames represent the layout viewport in CSS px. If Safari's screenshot turns
   * out to cover a different area (e.g. the whole screen), describe the image
   * honestly at its own size instead of stretching it onto the viewport.
   */
  private headerForPng(png: Buffer): FrameHeader {
    const size = pngSize(png);
    let { width, height } = this.viewport;
    if (size && width > 0 && height > 0) {
      const ar = size.width / size.height;
      const vr = width / height;
      const mismatch = Math.abs(ar - vr) / vr > 0.03;
      if (mismatch !== this.screenshotMismatch) {
        this.screenshotMismatch = mismatch;
        this.sendEmulated();
      }
      if (mismatch) {
        const k = this.viewport.dpr || 1;
        width = size.width / k;
        height = size.height / k;
      }
    }
    return { t: 'frame', pageId: this.id, width: Math.round(width), height: Math.round(height), ts: Date.now() / 1000, pageScale: this.visualScale, seq: ++this.frameSeq };
  }

  /** simctl screenshots are the whole screen in device pixels; express them in points. */
  private headerForJpeg(jpeg: Buffer): FrameHeader {
    const size = jpegSize(jpeg);
    const d = this.emu.device;
    let width = d.width;
    let height = d.height;
    if (size) {
      const scale = Math.max(1, Math.round(Math.min(size.width, size.height) / Math.max(1, Math.min(d.width, d.height))));
      width = size.width / scale;
      height = size.height / scale;
      if (Math.round(width) !== this.viewport.width || Math.round(height) !== this.viewport.height) {
        this.viewport = { width: Math.round(width), height: Math.round(height), dpr: scale };
        this.sendEmulated();
      }
    }
    return { t: 'frame', pageId: this.id, width: Math.round(width), height: Math.round(height), ts: Date.now() / 1000, pageScale: 1, seq: ++this.frameSeq };
  }

  private async simctlScreenshot(): Promise<Buffer> {
    const udid = this.lease!.udid;
    const file = path.join(this.deps.tmpDir(), `ifdy-ios-${process.pid}-${this.id.replace(/[^\w-]/g, '_').slice(0, 40)}.jpg`);
    await simctl(this.deps, ['io', udid, 'screenshot', '--type=jpeg', file], 20_000);
    try {
      return await this.deps.readFile(file);
    } finally {
      await this.deps.removeFile(file).catch(() => {});
    }
  }

  /* ------------------------------------------------------------------ */
  /* Input and agent                                                     */
  /* ------------------------------------------------------------------ */

  input(ev: RemoteInput) {
    this.lastActivity = Date.now();
    if (this.closed || this.gone) return;
    if (this.mode === 'webdriver' || (this.mode === 'simctl' && this.idb)) this.mapper.push(ev);
  }

  private onInputJob(job: InputJob) {
    if (this.pendingInput >= MAX_PENDING_INPUT) return;
    this.pendingInput++;
    void this.run(() => this.dispatch(job))
      .catch((err) => {
        if (isSessionGone(err)) this.onDriverError(err);
        // A failed gesture can leave a finger "down" in the driver's input state.
        else if (this.mode === 'webdriver') void this.wd?.releaseActions().catch(() => {});
      })
      .finally(() => {
        this.pendingInput--;
        if (this.mode === 'webdriver') this.nudgeTick();
      });
  }

  /** Express one input job for the active path. Runs inside the command chain. */
  async dispatch(job: InputJob) {
    if (this.mode === 'webdriver') {
      switch (job.kind) {
        case 'gesture':
          await this.call((wd) => wd.performActions([gestureToActions(job.gesture, this.viewport)]));
          return;
        case 'scroll':
          await this.call((wd) => wd.execute(SCROLL_SCRIPT, [job.x, job.y, job.dx, job.dy]));
          return;
        case 'key': {
          const seq = keyToActions(job.key, job.modifiers);
          if (seq) await this.call((wd) => wd.performActions([seq]));
          return;
        }
        case 'text':
          for (const seq of textToActions(job.text)) await this.call((wd) => wd.performActions([seq]));
          return;
      }
    }
    if (this.mode === 'simctl' && this.idb && this.lease) {
      for (const args of jobToIdb(job, this.lease.udid)) await this.deps.exec('idb', args, { timeoutMs: 15_000 });
    }
  }

  toAgent(env: unknown) {
    this.lastActivity = Date.now();
    if (this.mode !== 'webdriver') return;
    void this.run(() => this.call((wd) => wd.execute(DELIVER_SCRIPT, [env])))
      .catch((err) => {
        // Navigating: the studio's request times out and is retried after the agent's next hello.
        if (isSessionGone(err)) this.onDriverError(err);
      })
      .finally(() => this.nudgeTick());
  }
}

function friendlyNavError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (err instanceof WebDriverError && err.error === 'timeout') return 'The page took longer than 60 seconds to load in the simulator.';
  if (/could not connect|cannot connect|not connect to the server|NSURLErrorDomain|-1004/i.test(raw)) return 'Safari could not connect to the server. Is it running and reachable from this Mac?';
  if (/hostname could not be found|-1003/i.test(raw)) return 'The domain could not be resolved (DNS). Check the address or your network.';
  if (/offline|-1009/i.test(raw)) return 'This Mac appears to be offline.';
  return friendlyDriverError(err);
}

/* ------------------------------------------------------------------ */
/* Entry points used by the browser session                            */
/* ------------------------------------------------------------------ */

const pools = new WeakMap<object, SimulatorPool>();

/** One pool per companion (keyed by its browser manager). */
export function simulatorPoolFor(manager: BrowserManager): SimulatorPool {
  let pool = pools.get(manager);
  if (!pool) {
    pool = new SimulatorPool(defaultIosDeps());
    pools.set(manager, pool);
  }
  return pool;
}

/** Real Mobile Safari in Xcode's iOS Simulator (macOS only). */
export function createSimulatorPage(id: string, host: PageHost, open: OpenMessage, manager: BrowserManager): LivePage {
  return new SimulatorPage(id, host, open, simulatorPoolFor(manager));
}

export async function iosSimulatorStatus(manager: BrowserManager): Promise<EngineInfo> {
  return engineInfo(await simulatorPoolFor(manager).status());
}
