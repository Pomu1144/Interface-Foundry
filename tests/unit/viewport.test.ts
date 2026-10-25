import { describe, expect, it } from 'vitest';
import { BUILT_IN_DEVICES, responsiveDevice } from '@/modules/device-simulator/devices';
import { canFold, easeInOutCubic, fitScale, foldInViewport, frameSize, interpolateGeometry, resolveTransition, resolveViewport, rotateGeometry, viewportContext } from '@/modules/device-simulator/viewport';

const duo = BUILT_IN_DEVICES.find((d) => d.id === 'surface-duo')!;
const fold5 = BUILT_IN_DEVICES.find((d) => d.id === 'galaxy-z-fold-5')!;
const iphone = BUILT_IN_DEVICES.find((d) => d.id === 'iphone-16-pro')!;

describe('device registry', () => {
  it('every profile has a consistent viewport and a verification note', () => {
    for (const d of BUILT_IN_DEVICES) {
      for (const g of [d.folded, d.expanded].filter(Boolean)) {
        const vg = g!;
        expect(vg.viewport.width).toBe(vg.screen.width - vg.safeArea.left - vg.safeArea.right);
        expect(vg.viewport.height).toBe(vg.screen.height - vg.safeArea.top - vg.safeArea.bottom - vg.browserChrome.top - vg.browserChrome.bottom);
      }
      expect(d.verification.source.length).toBeGreaterThan(10);
    }
  });

  it('marks the Duo profile as provisional with a 34px hinge', () => {
    expect(duo.verification.level).toBe('provisional');
    expect(duo.folded.viewport).toEqual({ width: 540, height: 720 });
    expect(duo.expanded!.viewport).toEqual({ width: 1114, height: 720 });
    expect(duo.expanded!.fold).toMatchObject({ axis: 'vertical', offset: 540, maskLength: 34, kind: 'hinge' });
  });

  it('caches the responsive device by size (stable identity for store selectors)', () => {
    expect(responsiveDevice({ width: 800, height: 600 })).toBe(responsiveDevice({ width: 800, height: 600 }));
    expect(responsiveDevice({ width: 801, height: 600 }).folded.viewport.width).toBe(801);
  });
});

describe('resolveViewport', () => {
  it('uses the expanded geometry only for foldables', () => {
    expect(canFold(duo)).toBe(true);
    expect(canFold(iphone)).toBe(false);
    expect(resolveViewport(iphone, 'expanded', 'portrait').posture).toBe('folded');
    expect(resolveViewport(duo, 'expanded', 'portrait').geometry.viewport.width).toBe(1114);
  });

  it('rotates screen, safe areas and fold axis into landscape', () => {
    const r = resolveViewport(duo, 'expanded', 'landscape').geometry;
    expect(r.screen).toEqual({ width: 720, height: 1114 });
    expect(r.fold?.axis).toBe('horizontal');
    const ip = rotateGeometry(iphone.folded);
    expect(ip.safeArea.right).toBe(iphone.folded.safeArea.top);
    expect(ip.viewport.width).toBe(ip.screen.width - ip.safeArea.left - ip.safeArea.right);
  });

  it('computes frame size including bezels', () => {
    const f = frameSize(duo.folded);
    expect(f.width).toBe(540 + duo.folded.bezel.left + duo.folded.bezel.right);
  });

  it('reports the fold relative to the viewport', () => {
    expect(foldInViewport(duo.expanded!)).toMatchObject({ offset: 540, maskLength: 34 });
    expect(foldInViewport(iphone.folded)).toBeNull();
  });

  it('builds viewport contexts for change records', () => {
    expect(viewportContext(fold5, 'expanded', 'portrait')).toMatchObject({ deviceId: 'galaxy-z-fold-5', posture: 'expanded', width: 690 });
  });
});

describe('fold transitions', () => {
  it('eases symmetrically', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
  });

  it('interpolates the viewport continuously', () => {
    const g = interpolateGeometry(duo.folded, duo.expanded!, 0.5, 'continuous');
    expect(g.viewport.width).toBe(Math.round((540 + 1114) / 2));
    expect(interpolateGeometry(duo.folded, duo.expanded!, 0, 'continuous').viewport.width).toBe(540);
    expect(interpolateGeometry(duo.folded, duo.expanded!, 1, 'continuous').viewport.width).toBe(1114);
  });

  it('switches the viewport once at the midpoint while the frame still animates', () => {
    const before = interpolateGeometry(duo.folded, duo.expanded!, 0.49, 'midpoint');
    const after = interpolateGeometry(duo.folded, duo.expanded!, 0.51, 'midpoint');
    expect(before.viewport.width).toBe(540);
    expect(after.viewport.width).toBe(1114);
    expect(before.screen.width).toBeGreaterThan(540);
    // The screen must always contain the viewport.
    expect(after.screen.width).toBeGreaterThanOrEqual(1114);
  });

  it('keeps the hinge proportionally anchored mid-transition', () => {
    const g = resolveTransition(duo, 'portrait', 0.5, 'continuous');
    expect(g.fold).toBeDefined();
    expect(g.fold!.offset / g.screen.width).toBeCloseTo(540 / 1114, 2);
  });

  it('clamps progress', () => {
    expect(interpolateGeometry(duo.folded, duo.expanded!, 5, 'continuous').viewport.width).toBe(1114);
    expect(interpolateGeometry(duo.folded, duo.expanded!, -1, 'continuous').viewport.width).toBe(540);
  });
});

describe('fitScale', () => {
  it('fits content without upscaling past max', () => {
    expect(fitScale({ width: 100, height: 100 }, { width: 2000, height: 2000 })).toBe(1);
    expect(fitScale({ width: 2000, height: 1000 }, { width: 1096, height: 600 }, 48)).toBeCloseTo(0.5);
  });
});
