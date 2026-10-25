import type { CaptureRef, PreviewSource } from '@/store';
import { studio } from '@/store';
import { viewportContext } from '@/modules/device-simulator/viewport';
import { sourceUrl } from '@/modules/project-adapter/source';
import { previews } from '@/modules/preview-runtime/registry';
import { currentPatchSet } from '@/modules/preview-runtime/sync';
import { captureChromium, chromiumAvailable } from '@/modules/preview-runtime/remote/capture';
import { chromiumViewportFor } from '@/modules/preview-runtime/remote/emulation';
import { contactSheetLayout, SHEET_DEFAULTS } from './layout';
import type { TileSpec } from './presets';

export type TileCapture = { tile: TileSpec; capture: CaptureRef; method: string };
export type CaptureMode = 'auto' | 'chromium';

/** How a tile is captured: live DOM raster for agent frames, a fresh Chromium render otherwise. */
export function captureMethodFor(tile: TileSpec, mode: CaptureMode): 'raster' | 'chromium' | 'none' {
  const inst = studio().instances[tile.instanceId];
  if (mode === 'chromium') return chromiumAvailable() ? 'chromium' : 'none';
  if (inst?.engine === 'frame' && previews.get(tile.instanceId)?.ready) return 'raster';
  return chromiumAvailable() ? 'chromium' : 'none';
}

async function captureTile(tile: TileSpec, mode: CaptureMode, source: PreviewSource, route: string): Promise<TileCapture | null> {
  const s = studio();
  const method = captureMethodFor(tile, mode);
  const viewport = viewportContext(tile.device, tile.posture, tile.orientation);
  const base = {
    id: `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label: `${tile.device.name}${tile.device.expanded ? ` · ${tile.posture}` : ''}${tile.orientation === 'landscape' ? ' · landscape' : ''}`,
    route,
    viewport,
    createdAt: Date.now(),
    changeCount: s.changes.length,
  };
  if (method === 'raster') {
    const conn = previews.get(tile.instanceId)!;
    const r = await conn.call('capture.raster', { scale: Math.min(2, tile.device.pixelRatio) }, 45_000);
    return { tile, method: 'DOM raster · approximate', capture: { ...base, kind: 'raster', dataUrl: r.dataUrl, width: r.width, height: r.height } };
  }
  if (method === 'chromium') {
    const url = s.instances[tile.instanceId]?.url || sourceUrl(source, route);
    const { viewport: vp, fold } = chromiumViewportFor(tile.device, tile.posture, tile.orientation, 2);
    const r = await captureChromium({ url, viewport: vp, fold, patchSet: currentPatchSet(), colorScheme: s.colorScheme, freezeAnimations: true });
    return { tile, method: 'Chromium · pixel-exact', capture: { ...base, kind: 'chromium', dataUrl: r.dataUrl, width: r.width, height: r.height } };
  }
  return null;
}

/**
 * Capture every tile (2 at a time), add each capture to the project and return
 * them in tile order. Failures are reported per tile, never abort the batch.
 */
export async function captureTiles(
  tiles: TileSpec[],
  mode: CaptureMode,
  onProgress: (done: number, total: number) => void,
): Promise<{ captures: TileCapture[]; failed: { tile: TileSpec; error: string }[] }> {
  const s = studio();
  const source = s.source;
  if (!source) throw new Error('Open a project first.');
  const route = s.currentRoute;
  const results: (TileCapture | null)[] = new Array(tiles.length).fill(null);
  const failed: { tile: TileSpec; error: string }[] = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < tiles.length) {
      const i = next++;
      try {
        const r = await captureTile(tiles[i], mode, source, route);
        if (r) results[i] = r;
        else failed.push({ tile: tiles[i], error: 'No capture method available (read-only embed and no Chromium).' });
      } catch (err) {
        failed.push({ tile: tiles[i], error: (err as Error).message });
      }
      onProgress(++done, tiles.length);
    }
  };
  await Promise.all([worker(), worker()]);
  const captures = results.filter((r): r is TileCapture => Boolean(r));
  for (const c of [...captures].reverse()) studio().addCapture(c.capture);
  return { captures, failed };
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode a capture'));
    img.src = src;
  });

const token = (name: string, fallback: string) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

/** Compose a labelled contact sheet (PNG) from tile captures. */
export async function composeContactSheet(items: TileCapture[], meta: { title: string; subtitle: string }): Promise<Blob> {
  const images = await Promise.all(items.map((i) => loadImage(i.capture.dataUrl)));
  const layout = contactSheetLayout(images.map((im) => ({ width: im.naturalWidth, height: im.naturalHeight })));
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d')!;
  const bg = token('--bg-0', '#0b0c0f');
  const panel = token('--bg-2', '#15161a');
  const line = token('--line-2', 'rgba(255,255,255,0.085)');
  const text0 = token('--text-0', '#eceef2');
  const text2 = token('--text-2', '#81848e');
  const accent = token('--molten', '#ff7a45');
  const ui = token('--font-ui', 'system-ui, sans-serif');
  const mono = token('--font-mono', 'ui-monospace, monospace');
  const pad = SHEET_DEFAULTS.padding;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, layout.width, layout.height);

  // Header
  ctx.fillStyle = accent;
  roundRect(ctx, pad, pad + 6, 6, 52, 3);
  ctx.fill();
  ctx.fillStyle = text0;
  ctx.font = `600 34px ${ui}`;
  ctx.textBaseline = 'top';
  ctx.fillText(fit(ctx, meta.title, layout.width - pad * 2 - 30), pad + 24, pad);
  ctx.fillStyle = text2;
  ctx.font = `400 19px ${mono}`;
  ctx.fillText(fit(ctx, meta.subtitle, layout.width - pad * 2 - 30), pad + 24, pad + 46);
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad + SHEET_DEFAULTS.header - 36);
  ctx.lineTo(layout.width - pad, pad + SHEET_DEFAULTS.header - 36);
  ctx.stroke();

  items.forEach((item, i) => {
    const c = layout.cells[i];
    const im = images[i];
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 36;
    ctx.shadowOffsetY = 14;
    ctx.fillStyle = panel;
    roundRect(ctx, c.x, c.y, c.width, c.height, 10);
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, c.x, c.y, c.width, c.height, 10);
    ctx.clip();
    ctx.drawImage(im, c.x, c.y, c.width, c.height);
    ctx.restore();
    ctx.strokeStyle = line;
    roundRect(ctx, c.x + 0.5, c.y + 0.5, c.width - 1, c.height - 1, 10);
    ctx.stroke();

    const v = item.capture.viewport;
    ctx.fillStyle = text0;
    ctx.font = `600 20px ${ui}`;
    ctx.fillText(fit(ctx, item.tile.device.name + (item.tile.device.expanded ? ` · ${item.tile.posture === 'expanded' ? 'Expanded' : 'Folded'}` : ''), c.width), c.x, c.labelY);
    ctx.fillStyle = text2;
    ctx.font = `400 15px ${mono}`;
    ctx.fillText(fit(ctx, `${v.width}×${v.height} @${item.tile.device.pixelRatio}x · ${item.method}`, c.width), c.x, c.labelY + 27);
  });

  ctx.fillStyle = text2;
  ctx.font = `400 15px ${ui}`;
  ctx.textBaseline = 'bottom';
  ctx.fillText(
    'IFDY device wall · Chromium captures are pixel-exact for Blink; device frames, Safari/WebKit and hardware rendering are not simulated.',
    pad,
    layout.height - pad / 2,
  );

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the contact sheet'))), 'image/png'));
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
