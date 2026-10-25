import type { Rect, Size } from '@shared/types';

/**
 * Pure pixel-diff helpers shared by the diff Web Worker and unit tests:
 * top-left alignment of differently sized images, ignore-region masks,
 * change statistics and changed-region bounding boxes.
 */

export const DIFF_COLOR: [number, number, number] = [255, 46, 99];

/** Comparable area when two images are aligned top-left. */
export function overlapSize(a: Size, b: Size): Size {
  return { width: Math.max(0, Math.min(a.width, b.width)), height: Math.max(0, Math.min(a.height, b.height)) };
}

/** Copy the top-left `cw×ch` region out of an RGBA buffer of width `w`. */
export function cropRGBA(data: Uint8ClampedArray, w: number, h: number, cw: number, ch: number): Uint8ClampedArray {
  if (cw === w && ch === h) return data;
  const out = new Uint8ClampedArray(cw * ch * 4);
  const rowBytes = cw * 4;
  for (let y = 0; y < Math.min(ch, h); y++) out.set(data.subarray(y * w * 4, y * w * 4 + rowBytes), y * rowBytes);
  return out;
}

/** One byte per pixel; non-zero means "ignore". Regions are clamped to the image. */
export function buildIgnoreMask(w: number, h: number, regions: Rect[]): Uint8Array | undefined {
  if (!regions.length) return undefined;
  const mask = new Uint8Array(w * h);
  for (const r of regions) {
    const x0 = Math.max(0, Math.floor(Math.min(r.x, r.x + r.width)));
    const y0 = Math.max(0, Math.floor(Math.min(r.y, r.y + r.height)));
    const x1 = Math.min(w, Math.ceil(Math.max(r.x, r.x + r.width)));
    const y1 = Math.min(h, Math.ceil(Math.max(r.y, r.y + r.height)));
    for (let y = y0; y < y1; y++) mask.fill(1, y * w + x0, y * w + x1);
  }
  return mask;
}

/** Changed-pixel mask from a pixelmatch output buffer drawn with `color`. */
export function maskFromDiffOutput(out: Uint8ClampedArray, w: number, h: number, color: [number, number, number] = DIFF_COLOR): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let i = 0, p = 0; p < w * h; p++, i += 4) {
    if (out[i] === color[0] && out[i + 1] === color[1] && out[i + 2] === color[2]) mask[p] = 1;
  }
  return mask;
}

export type DiffStats = { changed: number; compared: number; ignored: number; percent: number };

export function diffStats(mask: Uint8Array, ignore?: Uint8Array): DiffStats {
  let changed = 0;
  let ignored = 0;
  for (let i = 0; i < mask.length; i++) {
    if (ignore && ignore[i]) ignored++;
    else if (mask[i]) changed++;
  }
  const compared = mask.length - ignored;
  return { changed, compared, ignored, percent: compared ? (changed / compared) * 100 : 0 };
}

/**
 * Bounding boxes of changed regions. Pixels are bucketed into `cell`-sized
 * cells; cells within `gap` cells of each other are merged (8-connectivity on a
 * dilated grid) and each box is the tight extent of its changed pixels.
 */
export function changedBoxes(mask: Uint8Array, w: number, h: number, opts: { cell?: number; gap?: number; maxBoxes?: number; minPixels?: number } = {}): Rect[] {
  const cell = Math.max(1, opts.cell ?? 8);
  const gap = Math.max(0, opts.gap ?? 1);
  const maxBoxes = opts.maxBoxes ?? 60;
  const minPixels = opts.minPixels ?? 1;
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  const count = new Int32Array(cols * rows);
  const minX = new Int32Array(cols * rows).fill(2 ** 31 - 1);
  const minY = new Int32Array(cols * rows).fill(2 ** 31 - 1);
  const maxX = new Int32Array(cols * rows).fill(-1);
  const maxY = new Int32Array(cols * rows).fill(-1);
  for (let y = 0; y < h; y++) {
    const cy = (y / cell) | 0;
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const c = cy * cols + ((x / cell) | 0);
      count[c]++;
      if (x < minX[c]) minX[c] = x;
      if (y < minY[c]) minY[c] = y;
      if (x > maxX[c]) maxX[c] = x;
      if (y > maxY[c]) maxY[c] = y;
    }
  }
  const seen = new Uint8Array(cols * rows);
  const boxes: (Rect & { pixels: number })[] = [];
  const stack: number[] = [];
  for (let start = 0; start < count.length; start++) {
    if (!count[start] || seen[start]) continue;
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    let pixels = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const c = stack.pop()!;
      pixels += count[c];
      if (minX[c] < bx0) bx0 = minX[c];
      if (minY[c] < by0) by0 = minY[c];
      if (maxX[c] > bx1) bx1 = maxX[c];
      if (maxY[c] > by1) by1 = maxY[c];
      const cx = c % cols;
      const cy = (c / cols) | 0;
      for (let oy = -1 - gap; oy <= 1 + gap; oy++) {
        const ny = cy + oy;
        if (ny < 0 || ny >= rows) continue;
        for (let ox = -1 - gap; ox <= 1 + gap; ox++) {
          const nx = cx + ox;
          if (nx < 0 || nx >= cols) continue;
          const n = ny * cols + nx;
          if (count[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    if (pixels >= minPixels) boxes.push({ x: bx0, y: by0, width: bx1 - bx0 + 1, height: by1 - by0 + 1, pixels });
  }
  boxes.sort((p, q) => q.width * q.height - p.width * p.height);
  return boxes.slice(0, maxBoxes).map(({ x, y, width, height }) => ({ x, y, width, height }));
}

/** Scale ignore regions / boxes between CSS px and image px. */
export const scaleRect = (r: Rect, k: number): Rect => ({ x: r.x * k, y: r.y * k, width: r.width * k, height: r.height * k });

/** Human description of a size difference, e.g. "+574 × 0 px". */
export function sizeDelta(a: Size, b: Size): string {
  const dw = b.width - a.width;
  const dh = b.height - a.height;
  const f = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  return `${f(dw)} × ${f(dh)} px`;
}
