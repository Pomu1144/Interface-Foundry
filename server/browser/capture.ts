import { randomBytes } from 'node:crypto';
import type { Browser } from 'playwright-core';
import { HttpError } from '../http';
import { AgentChannel } from './agent-channel';
import { defaultUserAgent, displayFeatureFor, sanitizeDevice, sanitizeFold } from './emulation';
import type { BrowserManager } from './manager';

export type CaptureRequest = {
  url: string;
  viewport: { width: number; height: number; dpr: number; mobile: boolean; touch: boolean; userAgent?: string };
  fold?: { axis: 'vertical' | 'horizontal'; offset: number; maskLength: number } | null;
  /** IFDY patch set (see src/shared/types.ts PatchSet), applied through the agent before capture. */
  patchSet?: unknown;
  colorScheme?: 'light' | 'dark' | null;
  fullPage?: boolean;
  freezeAnimations?: boolean;
  hideSelectors?: string[];
  waitForMs?: number;
};

export type CaptureResult = { dataUrl: string; width: number; height: number; capturedAt: number; warnings?: string[] };

const MAX_FULL_PAGE_HEIGHT = 16_000;

export function validateCaptureRequest(body: unknown): CaptureRequest {
  const b = (body ?? {}) as Partial<CaptureRequest>;
  if (typeof b.url !== 'string') throw new HttpError(400, 'url is required');
  let u: URL;
  try {
    u = new URL(b.url);
  } catch {
    throw new HttpError(400, 'Invalid url');
  }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, 'Only http(s) URLs can be captured');
  if (!b.viewport || typeof b.viewport !== 'object') throw new HttpError(400, 'viewport is required');
  const hide = Array.isArray(b.hideSelectors) ? b.hideSelectors.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length < 500).slice(0, 100) : [];
  return {
    url: u.href,
    viewport: b.viewport,
    fold: b.fold ?? null,
    patchSet: b.patchSet,
    colorScheme: b.colorScheme === 'dark' || b.colorScheme === 'light' ? b.colorScheme : null,
    fullPage: Boolean(b.fullPage),
    freezeAnimations: b.freezeAnimations !== false,
    hideSelectors: hide,
    waitForMs: Math.max(0, Math.min(15_000, Number(b.waitForMs) || 0)),
  };
}

/**
 * Deterministic screenshot: a fresh page in a throwaway context (no cookies or
 * storage from live previews), true device emulation, the IFDY agent injected to
 * apply the patch set and freeze animations, then load + network idle +
 * document.fonts.ready before a PNG capture.
 */
export async function runCapture(manager: BrowserManager, browser: Browser, req: CaptureRequest): Promise<CaptureResult> {
  const forbidden = manager.isForbiddenUrl(req.url);
  if (forbidden) throw new HttpError(403, forbidden);
  const warnings: string[] = [];
  const d = sanitizeDevice({ ...req.viewport, screen: undefined, orientation: undefined });
  const fold = sanitizeFold(req.fold ?? null, d);
  const ua = d.userAgent ?? defaultUserAgent(browser.version());
  const context = await browser.newContext({
    viewport: { width: d.width, height: d.height },
    screen: { width: d.width, height: d.height },
    deviceScaleFactor: d.dpr,
    isMobile: d.mobile,
    hasTouch: d.touch,
    userAgent: ua,
    colorScheme: req.colorScheme ?? 'no-preference',
    reducedMotion: req.freezeAnimations ? 'reduce' : 'no-preference',
    acceptDownloads: false,
    serviceWorkers: 'block',
  });
  const deadline = setTimeout(() => void context.close().catch(() => {}), 60_000);
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const session = randomBytes(12).toString('hex');
    const agent = new AgentChannel(page, cdp, { session, flags: [], agent: manager.agent });
    await agent.install();
    page.on('dialog', (dlg) => void dlg.dismiss().catch(() => {}));

    if (fold) {
      const { method } = await manager.displayFeatureSupport();
      if (method === 'none') warnings.push('This Chromium build cannot emulate display features; the fold is not reflected in viewport-segment media queries.');
      else if (method === 'displayFeaturesOverride') await cdp.send('Emulation.setDisplayFeaturesOverride', { features: [displayFeatureFor(fold)] });
      else
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: d.width,
          height: d.height,
          deviceScaleFactor: d.dpr,
          mobile: d.mobile,
          displayFeature: displayFeatureFor(fold),
        });
    }

    let response;
    try {
      response = await page.goto(req.url, { waitUntil: 'load', timeout: 30_000 });
    } catch (err) {
      const msg = (err as Error).message.split('\n')[0].replace(/^page\.goto:\s*/, '');
      if (/Timeout/.test(msg)) warnings.push('The load event did not fire within 30s; captured anyway.');
      else throw new HttpError(502, `Could not load ${req.url}: ${msg}`);
    }
    if (response && response.status() >= 400) warnings.push(`The page responded with HTTP ${response.status()}.`);

    const hasAgent = await agent.waitForHello(8000);
    if (!hasAgent) warnings.push('The IFDY agent did not start in this page; edits and animation freezing were not applied.');
    if (hasAgent && req.patchSet && typeof req.patchSet === 'object') {
      const r = await agent.call<{ applied: number; failed: string[] }>('patch.apply', req.patchSet, 10_000).catch((e: Error) => {
        warnings.push(`Edits could not be applied: ${e.message}`);
        return null;
      });
      if (r?.failed?.length) warnings.push(`${r.failed.length} edit(s) did not match an element: ${r.failed.slice(0, 5).join(', ')}`);
    }
    if (hasAgent && req.freezeAnimations) await agent.call('env.set', { freezeAnimations: true }, 5000).catch(() => {});

    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => warnings.push('The network did not go idle within 10s.'));
    await page
      .evaluate(() => Promise.race([(document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready.then(() => true), new Promise((r) => setTimeout(r, 5000))]))
      .catch(() => {});
    if (req.hideSelectors?.length) {
      const missed = await page.evaluate((sels) => {
        const bad: string[] = [];
        for (const sel of sels) {
          try {
            document.querySelectorAll<HTMLElement>(sel).forEach((el) => el.style.setProperty('visibility', 'hidden', 'important'));
          } catch {
            bad.push(sel);
          }
        }
        return bad;
      }, req.hideSelectors);
      if (missed.length) warnings.push(`Invalid selector(s) ignored: ${missed.join(', ')}`);
    }
    if (req.waitForMs) await page.waitForTimeout(req.waitForMs);
    // Two animation frames so style/layout changes above are painted.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});

    let clip: { x: number; y: number; width: number; height: number } | undefined;
    if (req.fullPage) {
      const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0)).catch(() => 0);
      if (h > MAX_FULL_PAGE_HEIGHT) {
        warnings.push(`The page is ${h}px tall; the capture is limited to the first ${MAX_FULL_PAGE_HEIGHT}px.`);
        clip = { x: 0, y: 0, width: d.width, height: MAX_FULL_PAGE_HEIGHT };
      }
    }
    const png = await page.screenshot({
      type: 'png',
      fullPage: Boolean(req.fullPage),
      animations: req.freezeAnimations ? 'disabled' : 'allow',
      caret: 'hide',
      scale: 'device',
      clip,
      timeout: 20_000,
    });
    const { width, height } = pngSize(png);
    return { dataUrl: `data:image/png;base64,${png.toString('base64')}`, width, height, capturedAt: Date.now(), ...(warnings.length ? { warnings } : {}) };
  } finally {
    clearTimeout(deadline);
    await context.close().catch(() => {});
  }
}

/** Read width/height from a PNG IHDR chunk. */
export function pngSize(buf: Buffer | Uint8Array): { width: number; height: number } {
  if (buf.length < 24) return { width: 0, height: 0 };
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { width: dv.getUint32(16, false), height: dv.getUint32(20, false) };
}
