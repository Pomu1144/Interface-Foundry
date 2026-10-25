/**
 * Pixel diff off the main thread: decode both captures, normalise them to a
 * common pixel density, align top-left, run pixelmatch over the overlap and
 * report statistics plus changed-region boxes (in CSS px of the captures).
 */
import pixelmatch from 'pixelmatch';
import type { Rect } from '@shared/types';
import { buildIgnoreMask, changedBoxes, cropRGBA, DIFF_COLOR, diffStats, maskFromDiffOutput, overlapSize, scaleRect } from './pixel';

export type DiffRequest = {
  id: number;
  a: Blob;
  b: Blob;
  /** Image px per CSS px for each capture (DPR of the capture). */
  scaleA: number;
  scaleB: number;
  threshold: number;
  /** Ignore regions in CSS px. */
  ignore: Rect[];
  includeAA?: boolean;
};

export type DiffResponse =
  | {
      id: number;
      ok: true;
      /** Diff image (RGBA) covering the overlap at `scale` image px per CSS px. */
      rgba: Uint8ClampedArray;
      width: number;
      height: number;
      scale: number;
      resampled: boolean;
      changed: number;
      compared: number;
      ignored: number;
      percent: number;
      /** Changed regions in CSS px. */
      boxes: Rect[];
      ms: number;
    }
  | { id: number; ok: false; error: string };

type Post = { postMessage(message: unknown, transfer?: Transferable[]): void };
const post = (self as unknown as Post).postMessage.bind(self);

async function decode(blob: Blob, factor: number): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const bmp = await createImageBitmap(blob);
  const width = Math.max(1, Math.round(bmp.width * factor));
  const height = Math.max(1, Math.round(bmp.height * factor));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas is not available in this worker.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}

self.onmessage = async (e: MessageEvent<DiffRequest>) => {
  const req = e.data;
  const t0 = performance.now();
  try {
    const scale = Math.min(req.scaleA, req.scaleB) || 1;
    const fa = scale / (req.scaleA || 1);
    const fb = scale / (req.scaleB || 1);
    const [a, b] = await Promise.all([decode(req.a, fa), decode(req.b, fb)]);
    const { width, height } = overlapSize(a, b);
    if (!width || !height) throw new Error('The captures do not overlap.');
    const ca = cropRGBA(a.data, a.width, a.height, width, height);
    const cb = cropRGBA(b.data, b.width, b.height, width, height);
    const ignoreMask = buildIgnoreMask(width, height, req.ignore.map((r) => scaleRect(r, scale)));
    const out = new Uint8ClampedArray(width * height * 4);
    pixelmatch(ca, cb, out, width, height, {
      threshold: req.threshold,
      includeAA: req.includeAA ?? false,
      alpha: 0.18,
      diffColor: DIFF_COLOR,
      diffColorAlt: DIFF_COLOR,
      aaColor: [250, 204, 21],
      ignoreMask,
    });
    const mask = maskFromDiffOutput(out, width, height, DIFF_COLOR);
    const stats = diffStats(mask, ignoreMask);
    const cell = Math.max(6, Math.round(8 * scale));
    const boxes = changedBoxes(mask, width, height, { cell, gap: 1, maxBoxes: 80, minPixels: Math.max(4, Math.round(4 * scale * scale)) }).map((r) => scaleRect(r, 1 / scale));
    const res: DiffResponse = { id: req.id, ok: true, rgba: out, width, height, scale, resampled: fa !== 1 || fb !== 1, ...stats, boxes, ms: Math.round(performance.now() - t0) };
    post(res, [out.buffer]);
  } catch (err) {
    post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies DiffResponse);
  }
};
