/**
 * Pure emulation logic for the WebKit engine. WebKit has no CDP: device pixel
 * ratio, mobile viewport semantics, touch and the user agent are fixed when a
 * BrowserContext is created, while the viewport size and media features can
 * change on a live page. No Playwright imports so this is unit-testable.
 */
import type { EmulationParams, RemoteDevice } from '../../src/modules/preview-runtime/remote/protocol';

export type WebKitContextOptions = {
  viewport: { width: number; height: number };
  screen: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  userAgent?: string;
  colorScheme: 'light' | 'dark' | null;
  reducedMotion: 'reduce' | null;
};

/** `browser.newContext()` options for an emulation (size, DPR, mobile, touch, UA, media). */
export function webkitContextOptions(e: EmulationParams): WebKitContextOptions {
  const d = e.device;
  return {
    viewport: { width: d.width, height: d.height },
    screen: { width: d.screen?.width ?? d.width, height: d.screen?.height ?? d.height },
    deviceScaleFactor: d.dpr,
    isMobile: d.mobile,
    hasTouch: d.touch,
    ...(d.userAgent ? { userAgent: d.userAgent } : {}),
    colorScheme: e.colorScheme,
    reducedMotion: e.reducedMotion ? 'reduce' : null,
  };
}

export type EmulationPlan = {
  /** A context-level property changed: a new context + page is needed and the URL reloads. */
  recreate: boolean;
  /** Only the viewport size changed: `page.setViewportSize` keeps the page and its state. */
  resize: boolean;
  /** Color scheme / reduced motion changed: `page.emulateMedia` applies in place. */
  media: boolean;
  /** Human-readable reasons for a recreate (for the studio's `emulated.detail`). */
  reasons: string[];
};

/** Decide how to get from the applied emulation to the requested one. */
export function planEmulation(prev: EmulationParams | null, next: EmulationParams): EmulationPlan {
  if (!prev) return { recreate: true, resize: false, media: false, reasons: [] };
  const a: RemoteDevice = prev.device;
  const b: RemoteDevice = next.device;
  const reasons: string[] = [];
  if (a.dpr !== b.dpr) reasons.push(`device pixel ratio ${a.dpr} → ${b.dpr}`);
  if (a.mobile !== b.mobile) reasons.push(b.mobile ? 'mobile viewport on' : 'mobile viewport off');
  if (a.touch !== b.touch) reasons.push(b.touch ? 'touch on' : 'touch off');
  if ((a.userAgent ?? '') !== (b.userAgent ?? '')) reasons.push('user agent');
  const recreate = reasons.length > 0;
  return {
    recreate,
    resize: !recreate && (a.width !== b.width || a.height !== b.height),
    media: !recreate && (prev.colorScheme !== next.colorScheme || prev.reducedMotion !== next.reducedMotion),
    reasons,
  };
}

export function recreateDetail(reasons: string[]): string {
  return `WebKit reloaded the page to apply ${reasons.join(', ')}: these are fixed per WebKit context. Size, rotation and fold changes apply in place.`;
}

export const FOLD_DETAIL = 'WebKit has no viewport-segment emulation: the page sees one viewport and the hinge is only drawn on the canvas.';

/**
 * Screenshot scale for a frame. `'css'` captures one image pixel per CSS pixel (fast: ~10 ms
 * for a phone); `'device'` captures at the device pixel ratio, only worth it when the studio
 * displays the board large enough to see the difference and the image stays reasonably small.
 */
export function screenshotScale(device: Pick<RemoteDevice, 'width' | 'height' | 'dpr'>, maxWidth: number, maxHeight: number, pixelBudget = 4_000_000): 'css' | 'device' {
  if (device.dpr < 1.5) return 'css';
  const wanted = Math.min(maxWidth / Math.max(1, device.width), maxHeight / Math.max(1, device.height));
  if (wanted < 1.5) return 'css';
  return device.width * device.height * device.dpr * device.dpr <= pixelBudget ? 'device' : 'css';
}

/** Width × height of a baseline or progressive JPEG (SOF0/1/2 marker), or null. */
export function jpegSize(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const len = (buf[i + 2] << 8) | buf[i + 3];
    if (marker >= 0xc0 && marker <= 0xc2) return { height: (buf[i + 5] << 8) | buf[i + 6], width: (buf[i + 7] << 8) | buf[i + 8] };
    i += 2 + len;
  }
  return null;
}
