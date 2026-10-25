import type { PatchSet } from '@shared/types';
import { studio } from '@/store';
import { api } from '@/modules/project-adapter/server-api';

export type ChromiumCaptureOptions = {
  url: string;
  viewport: { width: number; height: number; dpr: number; mobile: boolean; touch: boolean; userAgent?: string };
  fold?: { axis: 'vertical' | 'horizontal'; offset: number; maskLength: number } | null;
  /** Edits to apply before capturing (see `currentPatchSet()` in preview-runtime/sync). */
  patchSet?: PatchSet;
  colorScheme?: 'light' | 'dark' | null;
  fullPage?: boolean;
  /** Pause CSS animations/transitions and fast-forward finite animations (default true). */
  freezeAnimations?: boolean;
  /** Elements hidden with `visibility: hidden` (dynamic content, timestamps, ads). */
  hideSelectors?: string[];
  /** Extra settle time after load, network idle and fonts (max 15 s). */
  waitForMs?: number;
};

export type ChromiumCapture = {
  /** PNG data URL at the emulated device pixel ratio. */
  dataUrl: string;
  width: number;
  height: number;
  capturedAt: number;
  /** Non-fatal problems (agent missing, network never idle, invalid selectors, …). */
  warnings?: string[];
};

/** Whether the companion reported a launchable controlled Chromium. */
export function chromiumAvailable(): boolean {
  return Boolean(studio().server.capabilities?.browser.available);
}

/**
 * Pixel-exact capture in the companion's Chromium: a fresh page in a throwaway
 * context, true device emulation (viewport, DPR, mobile, touch, UA, fold), the
 * IFDY agent applies the patch set and freezes animations, then load + network
 * idle + `document.fonts.ready` before a PNG screenshot.
 */
export async function captureChromium(opts: ChromiumCaptureOptions): Promise<ChromiumCapture> {
  if (!chromiumAvailable()) {
    const reason = studio().server.capabilities?.browser.reason;
    throw new Error(`Controlled Chromium is unavailable${reason ? `: ${reason}` : '.'}`);
  }
  return api<ChromiumCapture>('/api/capture', { method: 'POST', json: { freezeAnimations: true, ...opts } });
}
