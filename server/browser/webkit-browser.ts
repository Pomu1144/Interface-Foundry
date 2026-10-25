import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Browser, BrowserContext } from 'playwright-core';
import type { IfdyServices } from '../services';
import type { WebKitContextOptions } from './webkit-emulation';

const IDLE_SHUTDOWN_MS = 60_000;

export type WebKitStatus = { available: boolean; reason: string; executable?: string };

/**
 * Owns the controlled WebKit (Playwright's build): checked cheaply (binary on disk, no
 * launch), launched on the first WebKit page, shut down when no WebKit page has been open
 * for a minute or with the companion. Every page gets its own context (fresh in-memory
 * profile), because WebKit fixes DPR, mobile mode, touch and UA at context creation.
 */
export class WebKitBrowser {
  private instance: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private cached: WebKitStatus | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private closing = false;
  private listeners = new Set<() => void>();
  pages = 0;
  /** Known once WebKit has been launched in this companion process. */
  version = '';
  readonly maxPages: number;

  constructor(private readonly services: IfdyServices) {
    this.maxPages = Math.max(1, Math.min(16, Number(process.env.IFDY_WEBKIT_MAX_PAGES) || 8));
  }

  async status(): Promise<WebKitStatus> {
    if (!this.services.config.browserEnabled) return { available: false, reason: 'Disabled with IFDY_BROWSER=0.' };
    if (this.cached) return this.cached;
    try {
      const pw = await import('playwright-core');
      const executable = process.env.IFDY_WEBKIT_PATH || pw.webkit.executablePath();
      await access(executable);
      if (!this.version && !process.env.IFDY_WEBKIT_PATH) this.version = await bundledVersion();
      this.cached = { available: true, reason: 'Playwright WebKit ready.', executable };
    } catch (err) {
      this.cached = {
        available: false,
        reason: `WebKit not found. Install it with "npx playwright install webkit" (and its system dependencies). (${(err as Error).message.split('\n')[0]})`,
      };
    }
    return this.cached;
  }

  isRunning() {
    return Boolean(this.instance?.isConnected());
  }

  /** New isolated context for one page; counts against the WebKit page budget until `release()`. */
  async newContext(options: WebKitContextOptions): Promise<BrowserContext> {
    const browser = await this.browser();
    return browser.newContext({
      ...options,
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
      bypassCSP: false,
      serviceWorkers: 'allow',
    });
  }

  /** Reserve a page slot (throws when the budget is used up). */
  acquire() {
    if (this.closing) throw new Error('The companion is shutting down.');
    if (this.pages >= this.maxPages) throw new Error(`WebKit page budget reached (${this.maxPages} pages). Close other WebKit boards first.`);
    this.pages++;
    this.touch();
  }

  release() {
    this.pages = Math.max(0, this.pages - 1);
    this.touch();
  }

  /** Called when WebKit exits unexpectedly (pages close themselves and tell the studio). */
  onGone(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private browser(): Promise<Browser> {
    if (this.closing) return Promise.reject(new Error('The companion is shutting down.'));
    if (this.instance?.isConnected()) return Promise.resolve(this.instance);
    if (!this.launching) {
      this.launching = this.launch().finally(() => {
        this.launching = null;
      });
    }
    return this.launching;
  }

  private async launch(): Promise<Browser> {
    const status = await this.status();
    if (!status.available || !status.executable) throw new Error(status.reason);
    const { webkit } = await import('playwright-core');
    const browser = await webkit.launch({ executablePath: process.env.IFDY_WEBKIT_PATH || undefined, headless: true });
    this.version = browser.version();
    browser.on('disconnected', () => {
      if (this.instance !== browser) return;
      this.instance = null;
      for (const fn of [...this.listeners]) fn();
    });
    this.instance = browser;
    this.touch();
    return browser;
  }

  /** Re-arm the idle shutdown (no WebKit pages for a while -> close WebKit). */
  private touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.pages || !this.instance) return;
    this.idleTimer = setTimeout(() => {
      if (this.pages) return;
      const b = this.instance;
      this.instance = null;
      void b?.close().catch(() => {});
    }, IDLE_SHUTDOWN_MS);
    this.idleTimer.unref?.();
  }

  async close() {
    this.closing = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const b = this.instance ?? (await this.launching?.catch(() => null)) ?? null;
    this.instance = null;
    await b?.close().catch(() => {});
  }
}

/** WebKit version of Playwright's bundled build, read from its manifest (no launch needed). */
async function bundledVersion(): Promise<string> {
  try {
    const dir = path.dirname(createRequire(import.meta.url).resolve('playwright-core/package.json'));
    const manifest = JSON.parse(await readFile(path.join(dir, 'browsers.json'), 'utf8')) as { browsers?: { name: string; browserVersion?: string }[] };
    return manifest.browsers?.find((b) => b.name === 'webkit')?.browserVersion ?? '';
  } catch {
    return '';
  }
}
