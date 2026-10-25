import type { LayoutSnapshotEntry } from '@shared/protocol';
import type { FoldGeometry, PatchSet, ViewportContext, ViewportState } from '@shared/types';
import { studio, type CaptureRef } from '@/store';
import { currentFold, currentViewportContext } from '@/modules/device-simulator/context';
import { describeViewport } from '@/modules/device-simulator/viewport';
import { previews } from '@/modules/preview-runtime/registry';
import { currentPatchSet } from '@/modules/preview-runtime/sync';
import { sourceUrl } from '@/modules/project-adapter/source';
import { findDevice, resolveProfile, type ResolvedProfile } from '@/modules/responsive-audit/profiles';
import { withWorker } from '@/modules/responsive-audit/worker';
import { lastScroll } from '@/modules/responsive-audit/scroll';
import { saveLayout } from './layouts';

/* ------------------------------------------------------------------ */
/* Optional deterministic Chromium capture (companion + Playwright)    */
/* ------------------------------------------------------------------ */

type ChromiumCaptureOptions = {
  url: string;
  viewport: { width: number; height: number; dpr: number; mobile: boolean; touch: boolean; userAgent?: string };
  fold?: FoldGeometry | null;
  patchSet?: PatchSet;
  colorScheme?: 'light' | 'dark' | null;
  fullPage?: boolean;
  freezeAnimations?: boolean;
  hideSelectors?: string[];
  waitForMs?: number;
};
type ChromiumModule = {
  captureChromium(opts: ChromiumCaptureOptions): Promise<{ dataUrl: string; width: number; height: number }>;
  chromiumAvailable(): boolean;
};

// Glob import so this module works whether or not the remote engine exists yet.
const chromiumLoaders = import.meta.glob<ChromiumModule>('/src/modules/preview-runtime/remote/capture.ts');

async function loadChromium(): Promise<ChromiumModule | null> {
  const load = Object.values(chromiumLoaders)[0];
  if (!load) return null;
  try {
    const mod = await load();
    return typeof mod.captureChromium === 'function' ? mod : null;
  } catch {
    return null;
  }
}

export type ChromiumStatus = { available: boolean; reason: string };

export async function chromiumStatus(): Promise<ChromiumStatus> {
  const s = studio();
  if (!s.source) return { available: false, reason: 'No project open.' };
  const mod = await loadChromium();
  if (!mod) return { available: false, reason: 'The controlled-Chromium capture engine is not installed in this build.' };
  let ok = false;
  try {
    ok = mod.chromiumAvailable();
  } catch {
    ok = false;
  }
  if (!ok) return { available: false, reason: s.server.capabilities?.browser.reason || 'The companion’s Chromium is not available.' };
  return { available: true, reason: 'Deterministic capture in the companion’s Chromium.' };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

let seq = 0;
const captureId = () => `cap_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function baselineKey(c: Pick<CaptureRef, 'route' | 'viewport'>): string {
  return `${c.route}|${c.viewport.deviceId}|${c.viewport.posture}|${c.viewport.orientation}`;
}

export const engineLabel = (kind: CaptureRef['kind']) => (kind === 'chromium' ? 'Chromium' : 'DOM raster — approximate');

function makeRef(kind: CaptureRef['kind'], viewport: ViewportContext, img: { dataUrl: string; width: number; height: number }, label?: string): CaptureRef {
  const s = studio();
  return {
    id: captureId(),
    label: label ?? `${describeViewport(viewport)} · ${engineLabel(kind)}`,
    kind,
    route: s.currentRoute,
    viewport,
    dataUrl: img.dataUrl,
    width: img.width,
    height: img.height,
    createdAt: Date.now(),
    changeCount: s.changes.length,
  };
}

async function persist(ref: CaptureRef, entries: LayoutSnapshotEntry[], fold: FoldGeometry | null, scroll: { x: number; y: number }, measuredOn: 'canvas' | 'background') {
  studio().addCapture(ref);
  await saveLayout({
    id: ref.id,
    entries,
    viewport: { width: ref.viewport.width, height: ref.viewport.height },
    fold,
    scroll,
    scale: ref.viewport.width ? ref.width / ref.viewport.width : 1,
    measuredOn,
    at: ref.createdAt,
  });
}

async function chromiumShot(mod: ChromiumModule, p: ResolvedProfile): Promise<{ dataUrl: string; width: number; height: number }> {
  const s = studio();
  if (!s.source) throw new Error('No project open.');
  return mod.captureChromium({
    url: sourceUrl(s.source, s.currentRoute),
    viewport: {
      width: p.ctx.width,
      height: p.ctx.height,
      dpr: p.device.pixelRatio,
      mobile: p.device.touch && p.device.category !== 'desktop',
      touch: p.device.touch,
      userAgent: p.device.userAgent,
    },
    fold: p.fold,
    patchSet: currentPatchSet(),
    colorScheme: s.colorScheme,
    freezeAnimations: true,
  });
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export type CaptureResult = { captures: CaptureRef[]; warnings: string[] };

/**
 * Capture the canvas preview as the user sees it (live state) with the agent's
 * DOM raster, plus a deterministic Chromium capture when the companion has one.
 */
export async function captureCurrent(opts: { label?: string } = {}): Promise<CaptureResult> {
  const s = studio();
  const conn = previews.primary();
  if (!s.project || !conn?.ready) throw new Error('No preview is connected. Open a project first.');
  const viewport = currentViewportContext();
  const fold = currentFold();
  const scroll = lastScroll.get(conn.id) ?? { x: 0, y: 0 };
  const warnings: string[] = [];
  const captures: CaptureRef[] = [];

  const [raster, entries] = await Promise.all([conn.call('capture.raster', { scale: 1 }, 45_000), conn.call('layout.snapshot', undefined, 15_000).catch(() => [] as LayoutSnapshotEntry[])]);
  const ref = makeRef('raster', viewport, raster, opts.label);
  await persist(ref, entries, fold, scroll, 'canvas');
  captures.push(ref);

  const chromium = await chromiumStatus();
  if (chromium.available) {
    try {
      const mod = (await loadChromium())!;
      const p = resolveProfile({ deviceId: viewport.deviceId, posture: viewport.posture, orientation: viewport.orientation });
      if (p) {
        const img = await chromiumShot(mod, p);
        const cref = makeRef('chromium', viewport, img, opts.label ? `${opts.label} · Chromium` : undefined);
        // Fresh page load in Chromium: no scroll, same structure as the canvas page.
        await persist(cref, entries, fold, { x: 0, y: 0 }, 'canvas');
        captures.push(cref);
      }
    } catch (err) {
      warnings.push(`Chromium capture failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { captures, warnings };
}

/**
 * Capture another viewport without touching the canvas: deterministic Chromium
 * when available, otherwise a DOM raster of the hidden background preview.
 * The structural layout is always measured in the background preview.
 */
export async function captureProfiles(states: ViewportState[], opts: { labelPrefix?: string } = {}): Promise<CaptureResult> {
  const s = studio();
  if (!s.project) throw new Error('Open a project first.');
  const profiles = states.map(resolveProfile).filter((p): p is ResolvedProfile => Boolean(p));
  const warnings: string[] = [];
  const captures: CaptureRef[] = [];
  const chromium = await chromiumStatus();
  const mod = chromium.available ? await loadChromium() : null;
  if (!chromium.available) warnings.push(`Using DOM raster (approximate): ${chromium.reason}`);

  await withWorker('Capture', async (w) => {
    for (const p of profiles) {
      await w.resize(p.ctx.width, p.ctx.height);
      const entries = await w.call('layout.snapshot', undefined, 15_000).catch(() => [] as LayoutSnapshotEntry[]);
      let img: { dataUrl: string; width: number; height: number } | null = null;
      let kind: CaptureRef['kind'] = 'raster';
      if (mod) {
        try {
          img = await chromiumShot(mod, p);
          kind = 'chromium';
        } catch (err) {
          warnings.push(`Chromium capture failed for ${p.ctx.deviceName}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (!img) img = await w.call('capture.raster', { scale: 1 }, 45_000);
      const posture = p.device.expanded ? ` · ${p.ctx.posture}` : '';
      const ref = makeRef(kind, p.ctx, img, `${opts.labelPrefix ? `${opts.labelPrefix} · ` : ''}${p.ctx.deviceName}${posture} · ${engineLabel(kind)}`);
      await persist(ref, entries, p.fold, { x: 0, y: 0 }, 'background');
      captures.push(ref);
    }
  });
  return { captures, warnings };
}

/** Folded and expanded captures of the canvas device (or the first foldable profile). */
export async function captureFoldPair(): Promise<CaptureResult & { deviceName: string }> {
  const s = studio();
  let d = s.device();
  const warnings: string[] = [];
  if (!d.expanded) {
    const alt = s.allDevices().find((x) => x.expanded);
    if (!alt) throw new Error('No foldable device profile is available.');
    warnings.push(`${d.name} cannot fold; compared ${alt.name} instead.`);
    d = alt;
  }
  const orientation = s.viewport.orientation;
  const res = await captureProfiles([
    { deviceId: d.id, posture: 'folded', orientation },
    { deviceId: d.id, posture: 'expanded', orientation },
  ]);
  return { captures: res.captures, warnings: [...warnings, ...res.warnings], deviceName: findDevice(d.id)?.name ?? d.name };
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadText(text: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  downloadDataUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const captureFilename = (c: CaptureRef, ext = 'png') =>
  `ifdy-${c.viewport.deviceId}-${c.viewport.posture}-${c.viewport.width}x${c.viewport.height}-${new Date(c.createdAt).toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`;
