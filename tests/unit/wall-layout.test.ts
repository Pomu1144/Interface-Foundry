import { describe, expect, it } from 'vitest';
import { BUILT_IN_DEVICES } from '@/modules/device-simulator/devices';
import { contactSheetLayout, fitWallLayout, linearPartition, wallLayout, WALL_DEFAULTS } from '@/modules/device-wall/layout';
import { buildTiles, DEFAULT_SET, frameBox, matchingPreset, parseKey, presetKeys, tileInstanceId } from '@/modules/device-wall/presets';

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width - 0.01 && b.x < a.x + a.width - 0.01 && a.y < b.y + b.height - 0.01 && b.y < a.y + a.height - 0.01;

describe('wall presets', () => {
  it('builds the launch set in category order with stable instance ids', () => {
    const tiles = buildTiles(DEFAULT_SET, BUILT_IN_DEVICES, 'portrait');
    expect(tiles.map((t) => t.instanceId)).toEqual([
      'wall-surface-duo-folded',
      'wall-surface-duo-expanded',
      'wall-galaxy-z-fold-5-folded',
      'wall-galaxy-z-fold-5-expanded',
      'wall-iphone-16-pro-folded',
      'wall-pixel-8-folded',
      'wall-ipad-mini-folded',
      'wall-laptop-13-folded',
    ]);
    expect(tiles[1].geometry.viewport).toEqual({ width: 1114, height: 720 });
  });

  it('ignores unknown devices, impossible postures and duplicates', () => {
    const tiles = buildTiles(['nope:folded', 'iphone-16-pro:expanded', 'pixel-8:folded', 'pixel-8:folded'], BUILT_IN_DEVICES, 'portrait');
    expect(tiles.map((t) => t.key)).toEqual(['pixel-8:folded']);
  });

  it('rotates every tile for landscape', () => {
    const [duo] = buildTiles(['surface-duo:expanded'], BUILT_IN_DEVICES, 'landscape');
    expect(duo.geometry.viewport).toEqual({ width: 720, height: 1114 });
  });

  it('expands presets and recognises them', () => {
    expect(presetKeys('foldables', BUILT_IN_DEVICES)).toHaveLength(6);
    expect(presetKeys('desktop', BUILT_IN_DEVICES).map((k) => parseKey(k).deviceId)).toEqual(['laptop-13', 'desktop-1440', 'desktop-1920']);
    expect(matchingPreset(presetKeys('phones', BUILT_IN_DEVICES), BUILT_IN_DEVICES)).toBe('phones');
    expect(matchingPreset(['pixel-8:folded'], BUILT_IN_DEVICES)).toBeNull();
    expect(tileInstanceId('surface-duo', 'expanded')).toBe('wall-surface-duo-expanded');
  });

  it('reserves room for laptop bases and monitor stands', () => {
    const laptop = BUILT_IN_DEVICES.find((d) => d.id === 'laptop-13')!;
    const box = frameBox(laptop, laptop.folded);
    expect(box.width).toBeGreaterThan(laptop.folded.screen.width + 36);
    expect(box.height).toBeGreaterThan(laptop.folded.screen.height + 40);
    expect(box.offsetX).toBeGreaterThan(0);
  });
});

describe('wall layout', () => {
  const frames = buildTiles(DEFAULT_SET, BUILT_IN_DEVICES, 'portrait').map((t) => frameBox(t.device, t.geometry));

  it('lines frames up at a common height without overlaps', () => {
    const l = wallLayout(frames, 1200, 300);
    expect(l.cells).toHaveLength(frames.length);
    for (const c of l.cells) {
      expect(c.height).toBeCloseTo(300, 0);
      expect(c.x).toBeGreaterThanOrEqual(-0.01);
      expect(c.x + c.width).toBeLessThanOrEqual(1200.01);
    }
    for (let i = 0; i < l.cells.length; i++) for (let j = i + 1; j < l.cells.length; j++) expect(overlaps(l.cells[i], l.cells[j])).toBe(false);
  });

  it('never upscales past true size', () => {
    const l = wallLayout([{ width: 100, height: 200 }], 2000, 900);
    expect(l.cells[0].scale).toBe(1);
  });

  it('fits everything into the container and keeps order', () => {
    const container = { width: 1100, height: 760 };
    const l = fitWallLayout(frames, container, WALL_DEFAULTS);
    expect(l.height).toBeLessThanOrEqual(container.height + 0.5);
    for (const c of l.cells) expect(c.x + c.width).toBeLessThanOrEqual(container.width + 0.5);
    expect(l.cells.map((c) => c.index)).toEqual(frames.map((_, i) => i));
    for (let i = 0; i < l.cells.length; i++) for (let j = i + 1; j < l.cells.length; j++) expect(overlaps(l.cells[i], l.cells[j])).toBe(false);
  });

  it('uses more rows for tall containers than for wide ones', () => {
    const rows = (l: ReturnType<typeof fitWallLayout>) => new Set(l.cells.map((c) => Math.round(c.y))).size;
    expect(rows(fitWallLayout(frames, { width: 900, height: 2400 }))).toBeGreaterThan(rows(fitWallLayout(frames, { width: 4000, height: 600 })));
  });

  it('partitions weights into balanced contiguous groups', () => {
    expect(linearPartition([1, 1, 1, 1], 2)).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(linearPartition([3, 1, 1, 1], 2)).toEqual([[0], [1, 2, 3]]);
    expect(linearPartition([1, 2], 5)).toEqual([[0], [1]]);
  });
});

describe('contact sheet layout', () => {
  it('scales captures to a common height, never up, in centred rows', () => {
    const imgs = [
      { width: 1080, height: 1440 },
      { width: 2228, height: 1440 },
      { width: 804, height: 1556 },
      { width: 2560, height: 1600 },
      { width: 300, height: 400 },
    ];
    const l = contactSheetLayout(imgs);
    expect(l.cells).toHaveLength(imgs.length);
    expect(l.cells[0].height).toBe(720);
    expect(l.cells[4]).toMatchObject({ width: 300, height: 400 });
    for (const c of l.cells) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x + c.width).toBeLessThanOrEqual(l.width);
      expect(c.labelY).toBeGreaterThan(c.y + c.height);
      expect(c.labelY).toBeLessThan(l.height);
    }
    for (let i = 0; i < l.cells.length; i++) for (let j = i + 1; j < l.cells.length; j++) expect(overlaps(l.cells[i], l.cells[j])).toBe(false);
  });

  it('keeps a minimum width for a single capture', () => {
    const l = contactSheetLayout([{ width: 400, height: 800 }]);
    expect(l.width).toBe(1400);
    expect(l.cells[0].x + l.cells[0].width / 2).toBeCloseTo(700, 0);
  });
});
