import type { Browser } from 'playwright-core';
import type { WebSocket } from 'ws';
import type { DisplayFeatureMethod } from '../../src/modules/preview-runtime/remote/protocol';
import { isLoopbackHost } from '../http';
import type { IfdyServices } from '../services';
import { runCapture, type CaptureRequest, type CaptureResult } from './capture';
import { BrowserSession } from './session';
import { getBrowserStatus } from './status';
import { WebKitBrowser } from './webkit-browser';

export type DisplayFeatureSupport = { method: DisplayFeatureMethod; detail: string };

const IDLE_SHUTDOWN_MS = 2 * 60_000;
const MAX_CONCURRENT_CAPTURES = 3;

/**
 * Owns the controlled Chromium: launched lazily (headless, never with a user
 * profile), one isolated BrowserContext per studio websocket, deterministic
 * captures in throwaway contexts, and shutdown when idle or on server close.
 */
export class BrowserManager {
  private instance: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private sessions = new Set<BrowserSession>();
  private probe: Promise<DisplayFeatureSupport> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private activeCaptures = 0;
  private captureQueue: (() => void)[] = [];
  private closing = false;
  readonly maxPages: number;
  /** The WebKit engine has its own lifecycle (launched only for WebKit boards). */
  readonly webkit: WebKitBrowser;

  constructor(private readonly services: IfdyServices) {
    this.maxPages = Math.max(1, Math.min(32, Number(process.env.IFDY_BROWSER_MAX_PAGES) || 12));
    this.webkit = new WebKitBrowser(services);
  }

  get agent() {
    return this.services.agent;
  }

  /* ------------------------------------------------------------------ */
  /* Browser lifecycle                                                   */
  /* ------------------------------------------------------------------ */

  async browser(): Promise<Browser> {
    if (this.closing) throw new Error('The companion is shutting down.');
    if (this.instance?.isConnected()) return this.instance;
    if (!this.launching) {
      this.launching = this.launch().finally(() => {
        this.launching = null;
      });
    }
    return this.launching;
  }

  private async launch(): Promise<Browser> {
    const status = await getBrowserStatus(this.services);
    if (!status.available || !status.executable) throw new Error(status.reason);
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({
      executablePath: status.executable,
      headless: true,
      args: ['--disable-dev-shm-usage', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-features=Translate,MediaRouter'],
    });
    browser.on('disconnected', () => {
      if (this.instance !== browser) return;
      this.instance = null;
      this.probe = null;
      for (const s of this.sessions) s.onBrowserGone();
    });
    this.instance = browser;
    this.touch();
    return browser;
  }

  isRunning() {
    return Boolean(this.instance?.isConnected());
  }

  /**
   * Determine how foldable display features can be emulated, by checking that the
   * viewport-segment media queries actually report two segments (never assumed).
   */
  displayFeatureSupport(): Promise<DisplayFeatureSupport> {
    if (!this.probe) {
      this.probe = this.runProbe().catch((err) => ({ method: 'none' as const, detail: `Probe failed: ${(err as Error).message.split('\n')[0]}` }));
    }
    return this.probe;
  }

  private async runProbe(): Promise<DisplayFeatureSupport> {
    const browser = await this.browser();
    const ctx = await browser.newContext({ viewport: null });
    try {
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      const metrics = { width: 400, height: 300, deviceScaleFactor: 1, mobile: false };
      const feature = { orientation: 'vertical' as const, offset: 200, maskLength: 0 };
      const segments = () =>
        page.evaluate(() => {
          const v = (window as unknown as { viewport?: { segments?: unknown[] } }).viewport;
          return { mq: matchMedia('(horizontal-viewport-segments: 2)').matches, n: v?.segments?.length ?? 0 };
        });
      let modern = '';
      try {
        await cdp.send('Emulation.setDeviceMetricsOverride', metrics);
        await cdp.send('Emulation.setDisplayFeaturesOverride', { features: [feature] });
        const r = await segments();
        if (r.mq) return { method: 'displayFeaturesOverride', detail: 'Emulation.setDisplayFeaturesOverride (viewport segments verified).' };
        modern = 'Emulation.setDisplayFeaturesOverride was accepted but had no effect';
        await cdp.send('Emulation.clearDisplayFeaturesOverride').catch(() => {});
      } catch (err) {
        modern = `Emulation.setDisplayFeaturesOverride failed (${(err as Error).message.split('\n')[0]})`;
      }
      try {
        await cdp.send('Emulation.setDeviceMetricsOverride', { ...metrics, displayFeature: feature });
        const r = await segments();
        if (r.mq) return { method: 'deviceMetrics', detail: `Device-metrics display feature (viewport segments verified; ${modern}).` };
      } catch {
        /* fall through */
      }
      return { method: 'none', detail: `${modern}; this Chromium build does not expose viewport segments, so folds are drawn but not emulated.` };
    } finally {
      await ctx.close().catch(() => {});
    }
  }

  /* ------------------------------------------------------------------ */
  /* Sessions                                                            */
  /* ------------------------------------------------------------------ */

  attach(ws: WebSocket) {
    const session = new BrowserSession(this, ws);
    this.sessions.add(session);
    this.touch();
    return session;
  }

  detach(session: BrowserSession) {
    this.sessions.delete(session);
    this.touch();
  }

  totalPages() {
    let n = 0;
    for (const s of this.sessions) n += s.pageCount;
    return n;
  }

  /** Re-arm the idle shutdown timer (no sessions, no captures -> close Chromium). */
  touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.sessions.size || this.activeCaptures || !this.instance) return;
    this.idleTimer = setTimeout(() => {
      if (this.sessions.size || this.activeCaptures) return;
      const b = this.instance;
      this.instance = null;
      this.probe = null;
      void b?.close().catch(() => {});
    }, IDLE_SHUTDOWN_MS);
    this.idleTimer.unref?.();
  }

  /** The studio itself must never be loaded into the controlled browser (it would recurse). */
  isForbiddenUrl(url: string): string | null {
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return 'Only http(s) URLs can be opened in the controlled browser.';
      const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
      if (isLoopbackHost(u.hostname) && port === this.services.studioPort()) return 'The IFDY studio itself cannot be opened in the controlled browser.';
      return null;
    } catch {
      return url === 'about:blank' ? null : 'Invalid URL';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Captures                                                            */
  /* ------------------------------------------------------------------ */

  async capture(req: CaptureRequest): Promise<CaptureResult> {
    if (this.activeCaptures >= MAX_CONCURRENT_CAPTURES) await new Promise<void>((r) => this.captureQueue.push(r));
    this.activeCaptures++;
    this.touch();
    try {
      const browser = await this.browser();
      return await runCapture(this, browser, req);
    } finally {
      this.activeCaptures--;
      this.captureQueue.shift()?.();
      this.touch();
    }
  }

  status() {
    return {
      running: this.isRunning(),
      version: this.instance?.version() ?? null,
      sessions: this.sessions.size,
      pages: this.totalPages(),
      maxPages: this.maxPages,
      activeCaptures: this.activeCaptures,
      webkit: { running: this.webkit.isRunning(), version: this.webkit.version || null, pages: this.webkit.pages, maxPages: this.webkit.maxPages },
    };
  }

  async close() {
    this.closing = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    await Promise.all([...this.sessions].map((s) => s.dispose()));
    const b = this.instance ?? (await this.launching?.catch(() => null)) ?? null;
    this.instance = null;
    await Promise.all([b?.close().catch(() => {}), this.webkit.close()]);
  }
}

/** Shared manager for the companion (created on first use, closed with the server). */
export function getBrowserManager(services: IfdyServices): BrowserManager {
  let m = services.registry.get('browser') as BrowserManager | undefined;
  if (!m) {
    const created = new BrowserManager(services);
    services.registry.set('browser', created);
    services.onClose(() => created.close());
    m = created;
  }
  return m;
}
