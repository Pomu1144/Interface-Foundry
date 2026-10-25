import { describe, expect, it } from 'vitest';
import pixelmatch from 'pixelmatch';
import { buildIgnoreMask, changedBoxes, cropRGBA, DIFF_COLOR, diffStats, maskFromDiffOutput, overlapSize, sizeDelta } from '@/modules/responsive-diff/pixel';

function image(w: number, h: number, fill: [number, number, number] = [255, 255, 255]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([...fill, 255], i * 4);
  return d;
}
function paint(d: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) d.set([...c, 255], (y * w + x) * 4);
}

describe('alignment of differently sized captures', () => {
  it('compares only the top-left overlap', () => {
    expect(overlapSize({ width: 540, height: 720 }, { width: 1114, height: 720 })).toEqual({ width: 540, height: 720 });
    expect(sizeDelta({ width: 540, height: 720 }, { width: 1114, height: 700 })).toBe('+574 × -20 px');
  });

  it('crops rows correctly', () => {
    const src = image(4, 3);
    paint(src, 4, 0, 1, 1, 2, [0, 0, 0]); // pixel (0,1) black
    const out = cropRGBA(src, 4, 3, 2, 2);
    expect(out.length).toBe(2 * 2 * 4);
    expect([...out.slice(8, 12)]).toEqual([0, 0, 0, 255]); // row 1, col 0
    expect([...out.slice(0, 4)]).toEqual([255, 255, 255, 255]);
  });
});

describe('ignore regions', () => {
  it('builds a clamped mask, accepting negative-size (drawn backwards) rects', () => {
    const mask = buildIgnoreMask(10, 10, [{ x: 8, y: 8, width: 5, height: 5 }, { x: 3, y: 3, width: -2, height: -2 }])!;
    expect(mask.reduce((a, b) => a + b, 0)).toBe(4 + 4);
    expect(mask[9 * 10 + 9]).toBe(1);
    expect(mask[1 * 10 + 1]).toBe(1);
    expect(buildIgnoreMask(10, 10, [])).toBeUndefined();
  });

  it('excludes ignored pixels from statistics and from pixelmatch', () => {
    const w = 40;
    const h = 20;
    const a = image(w, h);
    const b = image(w, h);
    paint(b, w, 2, 2, 12, 12, [20, 20, 20]); // 100 px change
    paint(b, w, 30, 5, 35, 10, [20, 20, 20]); // 25 px change (to be ignored)
    const ignore = buildIgnoreMask(w, h, [{ x: 28, y: 0, width: 12, height: 20 }]);
    const out = new Uint8ClampedArray(w * h * 4);
    const n = pixelmatch(a, b, out, w, h, { threshold: 0.1, diffColor: DIFF_COLOR, diffColorAlt: DIFF_COLOR, ignoreMask: ignore });
    const mask = maskFromDiffOutput(out, w, h);
    const stats = diffStats(mask, ignore);
    expect(n).toBe(100);
    expect(stats.changed).toBe(100);
    expect(stats.ignored).toBe(12 * 20);
    expect(stats.compared).toBe(w * h - 240);
    expect(stats.percent).toBeCloseTo((100 / (w * h - 240)) * 100, 5);
  });
});

describe('changed-region bounding boxes', () => {
  it('returns one tight box per separated region, largest first', () => {
    const w = 100;
    const h = 60;
    const mask = new Uint8Array(w * h);
    const set = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = 1;
    };
    set(5, 5, 15, 9); // 10×4
    set(60, 30, 90, 50); // 30×20
    const boxes = changedBoxes(mask, w, h, { cell: 8, gap: 0 });
    expect(boxes).toEqual([
      { x: 60, y: 30, width: 30, height: 20 },
      { x: 5, y: 5, width: 10, height: 4 },
    ]);
  });

  it('merges nearby changes within the gap', () => {
    const w = 64;
    const h = 16;
    const mask = new Uint8Array(w * h);
    mask[2 * w + 2] = 1;
    mask[2 * w + 20] = 1; // 2 cells apart with cell=8
    expect(changedBoxes(mask, w, h, { cell: 8, gap: 0 })).toHaveLength(2);
    expect(changedBoxes(mask, w, h, { cell: 8, gap: 1 })).toEqual([{ x: 2, y: 2, width: 19, height: 1 }]);
  });

  it('respects minPixels and maxBoxes', () => {
    const w = 80;
    const h = 8;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < 5; i++) mask[i * 16] = 1;
    expect(changedBoxes(mask, w, h, { cell: 4, gap: 0, minPixels: 2 })).toHaveLength(0);
    expect(changedBoxes(mask, w, h, { cell: 4, gap: 0, maxBoxes: 3 })).toHaveLength(3);
  });
});
