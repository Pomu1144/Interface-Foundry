import { describe, expect, it } from 'vitest';
import { BUILT_IN_DEVICES } from '@/modules/device-simulator/devices';
import { fold3dLayout } from '@/modules/device-simulator/fold3d';
import { contentPostureAt, foldVars, SWING_END } from '@/modules/device-simulator/motion';
import { resolveViewport } from '@/modules/device-simulator/viewport';

const dev = (id: string) => BUILT_IN_DEVICES.find((d) => d.id === id)!;
const layout = (id: string, orientation: 'portrait' | 'landscape' = 'portrait') => {
  const d = dev(id);
  return fold3dLayout(d, resolveViewport(d, 'folded', orientation).geometry, resolveViewport(d, 'expanded', orientation).geometry)!;
};

describe('fold3dLayout', () => {
  it('swings the Duo right panel around the hinge, with the live screen on the left', () => {
    const L = layout('surface-duo');
    expect(L.moving).toBe('after');
    expect(L.axis).toBe('vertical');
    // Folded screen sits where the folded device draws it; expanded screen spans both panels.
    expect(L.screen.folded).toMatchObject({ x: 6, width: 540, height: 720 });
    expect(L.screen.expanded).toMatchObject({ x: 6, width: 1114 });
    // Hinge centre = bezel + fold offset + half the 34px hinge; the visible barrel is slim.
    expect(L.movingPanel.x).toBe(6 + 540 + 17);
    expect(L.hinge!.x + L.hinge!.width / 2).toBe(6 + 540 + 17);
    expect(L.hinge!.width).toBeLessThan(34);
    // The reveal covers everything right of the left screen.
    expect(L.reveal).toMatchObject({ x: 540, width: 1114 - 540 });
    expect(L.foldedShift).toEqual({ x: 0, y: 0 });
  });

  it('opens book foldables to the left and keeps the folded device aligned to the slot', () => {
    const L = layout('galaxy-z-fold-5');
    expect(L.moving).toBe('before');
    expect(L.hinge).toBeNull(); // a crease, not a hinge
    expect(L.movingPanel.x).toBe(0);
    // While folded the cover panel is shifted back to x = 0.
    expect(L.staticPanel.folded.x + L.foldedShift.x).toBe(0);
    expect(L.reveal.x).toBe(0);
  });

  it('turns the hinge horizontal in landscape', () => {
    const L = layout('surface-duo', 'landscape');
    expect(L.axis).toBe('horizontal');
    expect(L.screen.expanded.height).toBe(1114);
    expect(L.movingPanel.y).toBeGreaterThan(540);
    expect(L.container.height).toBeGreaterThanOrEqual(L.screen.expanded.height);
  });
});

describe('fold motion curve', () => {
  it('swings the hinge first, then slides the content across', () => {
    expect(foldVars(0)).toMatchObject({ angle: 180, open: 0, slide: 0 });
    const mid = foldVars(SWING_END / 2);
    expect(mid.angle).toBeGreaterThan(0);
    expect(mid.angle).toBeLessThan(180);
    expect(mid.slide).toBe(0);
    expect(foldVars(SWING_END)).toMatchObject({ angle: 0, open: 1, slide: 0 });
    expect(foldVars(1)).toMatchObject({ angle: 0, slide: 1 });
  });

  it('reflows the page once, when the hinge is flat', () => {
    expect(contentPostureAt(SWING_END - 0.01)).toBe('folded');
    expect(contentPostureAt(SWING_END)).toBe('expanded');
  });
});
