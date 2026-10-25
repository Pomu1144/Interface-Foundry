import { describe, expect, it } from 'vitest';
import { BUILT_IN_DEVICES } from '@/modules/device-simulator/devices';
import { remoteEmulation } from '@/modules/preview-runtime/remote/emulation';
import { MOD, type EmulationParams } from '@/modules/preview-runtime/remote/protocol';
import { sanitizeEmulation } from '../../server/browser/emulation';
import { FramePacer } from '../../server/browser/frame-pacer';
import { jpegSize, planEmulation, recreateDetail, screenshotScale, webkitContextOptions } from '../../server/browser/webkit-emulation';
import { modifierChanges, mouseButton, toScreenPoint, TouchGesture, unknownKeyText } from '../../server/browser/webkit-input';

const dev = (id: string) => BUILT_IN_DEVICES.find((d) => d.id === id)!;
const emu = (id: string, posture: 'folded' | 'expanded' = 'folded', orientation: 'portrait' | 'landscape' = 'portrait'): EmulationParams => {
  const e = remoteEmulation(dev(id), posture, orientation);
  return sanitizeEmulation({ device: e.device, fold: e.fold, colorScheme: null, reducedMotion: false });
};

describe('WebKit emulation plan', () => {
  it('builds a context on the first emulation', () => {
    expect(planEmulation(null, emu('iphone-16-pro'))).toMatchObject({ recreate: true, resize: false });
  });

  it('unfolds, folds and rotates in place (size only)', () => {
    const folded = emu('surface-duo');
    const open = emu('surface-duo', 'expanded');
    expect(open.device.width).toBe(1114);
    expect(planEmulation(folded, open)).toEqual({ recreate: false, resize: true, media: false, reasons: [] });
    expect(planEmulation(open, folded)).toMatchObject({ recreate: false, resize: true });
    expect(planEmulation(folded, emu('surface-duo', 'folded', 'landscape'))).toMatchObject({ recreate: false, resize: true });
  });

  it('applies color scheme and reduced motion in place', () => {
    const a = emu('pixel-8');
    expect(planEmulation(a, { ...a, colorScheme: 'dark' })).toMatchObject({ recreate: false, resize: false, media: true });
    expect(planEmulation(a, { ...a, reducedMotion: true })).toMatchObject({ media: true });
    expect(planEmulation(a, a)).toEqual({ recreate: false, resize: false, media: false, reasons: [] });
  });

  it('rebuilds the context for DPR, mobile, touch and user agent changes, and says why', () => {
    const phone = emu('iphone-16-pro');
    const laptop = emu('laptop-13');
    const p = planEmulation(phone, laptop);
    expect(p.recreate).toBe(true);
    expect(p.resize).toBe(false);
    expect(p.reasons).toEqual(expect.arrayContaining(['mobile viewport off', 'touch off', 'user agent']));
    expect(planEmulation(phone, { ...phone, device: { ...phone.device, dpr: 2 } }).reasons).toEqual(['device pixel ratio 3 → 2']);
    expect(recreateDetail(['touch on'])).toMatch(/reloaded the page to apply touch on/);
  });

  it('maps an emulation to WebKit context options', () => {
    const o = webkitContextOptions({ ...emu('iphone-16-pro'), colorScheme: 'dark', reducedMotion: true });
    expect(o).toMatchObject({ viewport: { width: 402, height: 778 }, screen: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'dark', reducedMotion: 'reduce' });
    expect(o.userAgent).toMatch(/iPhone/);
    const plain = webkitContextOptions(sanitizeEmulation({ device: { width: 800, height: 600, dpr: 1, mobile: false, touch: false }, fold: null, colorScheme: null, reducedMotion: false }));
    expect('userAgent' in plain).toBe(false);
    expect(plain.reducedMotion).toBeNull();
  });

  it('captures at device resolution only when it is visible and affordable', () => {
    const d = { width: 402, height: 778, dpr: 3 };
    expect(screenshotScale(d, 402, 778)).toBe('css');
    expect(screenshotScale(d, 804, 1556)).toBe('device');
    expect(screenshotScale({ ...d, dpr: 1 }, 2000, 2000)).toBe('css');
    expect(screenshotScale({ width: 1440, height: 900, dpr: 2 }, 2880, 1800)).toBe('css'); // over the pixel budget
  });

  it('reads JPEG dimensions', () => {
    // SOI, APP0 (len 16), SOF0 with height 844 and width 390.
    const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)];
    const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, 844 >> 8, 844 & 255, 390 >> 8, 390 & 255, 0x03];
    expect(jpegSize(new Uint8Array([0xff, 0xd8, ...app0, ...sof, ...new Array(10).fill(0)]))).toEqual({ width: 390, height: 844 });
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});

describe('WebKit input mapping', () => {
  it('maps mouse buttons Playwright supports', () => {
    expect(mouseButton('left')).toBe('left');
    expect(mouseButton('right')).toBe('right');
    expect(mouseButton('back')).toBeNull();
    expect(mouseButton('none')).toBeNull();
  });

  it('syncs keyboard modifiers with the mouse event mask', () => {
    expect(modifierChanges(new Set(), MOD.shift | MOD.meta)).toEqual({ press: ['Meta', 'Shift'], release: [] });
    expect(modifierChanges(new Set(['Shift', 'Alt']), MOD.shift)).toEqual({ press: [], release: ['Alt'] });
    expect(modifierChanges(new Set(['Control']), MOD.ctrl)).toEqual({ press: [], release: [] });
  });

  it('types characters Playwright has no key for, but never for shortcuts or keyup', () => {
    expect(unknownKeyText('é', 'down', 0)).toBe('é');
    expect(unknownKeyText('é', 'down', MOD.shift)).toBe('é');
    expect(unknownKeyText('é', 'up', 0)).toBeNull();
    expect(unknownKeyText('ß', 'down', MOD.ctrl)).toBeNull();
    expect(unknownKeyText('Dead', 'down', 0)).toBeNull();
  });

  it('converts layout points to touchscreen (visual viewport) points', () => {
    expect(toScreenPoint({ x: 900, y: 20 }, null)).toEqual({ x: 900, y: 20 });
    expect(toScreenPoint({ x: 900, y: 20 }, { width: 980, height: 2120, scale: 0.4, offsetX: 0, offsetY: 0 })).toEqual({ x: 360, y: 8 });
    expect(toScreenPoint({ x: 110, y: 60 }, { width: 200, height: 400, scale: 2, offsetX: 10, offsetY: 10 })).toEqual({ x: 200, y: 100 });
  });

  it('turns a touch without movement into a tap', () => {
    const g = new TouchGesture();
    expect(g.feed('start', [{ x: 50, y: 60, id: 1 }])).toEqual([]);
    expect(g.feed('move', [{ x: 52, y: 61, id: 1 }])).toEqual([]); // within the slop
    expect(g.feed('end', [])).toEqual([{ type: 'tap', x: 50, y: 60 }]);
  });

  it('turns a drag into panning by the finger delta, without a tap', () => {
    const g = new TouchGesture();
    g.feed('start', [{ x: 100, y: 300, id: 1 }]);
    expect(g.feed('move', [{ x: 100, y: 280, id: 1 }])).toEqual([{ type: 'pan', x: 100, y: 300, dx: 0, dy: 20 }]);
    expect(g.feed('move', [{ x: 90, y: 250, id: 1 }])).toEqual([{ type: 'pan', x: 100, y: 300, dx: 10, dy: 30 }]);
    expect(g.feed('end', [])).toEqual([]);
  });

  it('ignores pinches and cancelled touches', () => {
    const g = new TouchGesture();
    g.feed('start', [{ x: 10, y: 10, id: 1 }]);
    g.feed('start', [
      { x: 10, y: 10, id: 1 },
      { x: 80, y: 80, id: 2 },
    ]);
    expect(g.feed('move', [{ x: 0, y: 0, id: 1 }])).toEqual([]);
    expect(g.feed('end', [])).toEqual([]);
    g.feed('start', [{ x: 10, y: 10, id: 3 }]);
    g.feed('cancel', []);
    expect(g.feed('end', [])).toEqual([]);
  });
});

describe('frame pacing', () => {
  it('aims at 15 fps while the page changes', () => {
    const p = new FramePacer();
    expect(p.next(10, true)).toBe(57); // 1000/15 - 10
  });

  it('never spends more than half the time capturing', () => {
    const p = new FramePacer();
    expect(p.next(80, true)).toBe(80);
  });

  it('drops to the idle rate after a few identical frames and recovers on activity', () => {
    const p = new FramePacer();
    p.next(10, false);
    p.next(10, false);
    expect(p.idle).toBe(false);
    expect(p.next(10, false)).toBe(240); // 4 fps
    expect(p.idle).toBe(true);
    p.bump();
    expect(p.next(10, true)).toBe(57);
    p.next(10, false);
    p.next(10, false);
    p.next(10, false);
    expect(p.next(10, true)).toBe(57);
  });
});
