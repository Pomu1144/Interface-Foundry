import { describe, expect, it } from 'vitest';
import { overflowZones, type SweepPoint } from '@/modules/responsive-audit/sweep-math';

const pt = (vw: number, right: number, visible = true): SweepPoint => ({ vw, present: true, visible, x: right - 100, width: 100, right, height: 20 });

describe('overflowZones', () => {
  it('finds contiguous ranges where the right edge passes the viewport and their worst overflow', () => {
    // A 560px banner with a 16px margin: overflows until the viewport reaches 576px.
    const points = [320, 360, 400, 480, 540, 560, 600, 640].map((vw) => pt(vw, 576));
    expect(overflowZones(points)).toEqual([{ from: 320, to: 560, max: 256 }]);
  });

  it('splits zones at hidden widths and ignores sub-pixel overflow', () => {
    const points = [pt(320, 400), pt(360, 400, false), pt(400, 401), pt(440, 500), pt(480, 500), pt(520, 500)];
    expect(overflowZones(points)).toEqual([
      { from: 320, to: 320, max: 80 },
      { from: 440, to: 480, max: 60 },
    ]);
  });

  it('returns nothing when the element always fits', () => {
    expect(overflowZones([pt(320, 300), pt(1600, 1200)])).toEqual([]);
  });
});
