import { describe, expect, it } from 'vitest';
import { BUILT_IN_DEVICES } from '@/modules/device-simulator/devices';
import { chromiumViewportFor, isMobileProfile, remoteEmulation } from '@/modules/preview-runtime/remote/emulation';
import { defaultUserAgent, deviceMetricsParams, mediaFeatures, sanitizeDevice, sanitizeEmulation, sanitizeFold, userAgentMetadataFor } from '../../server/browser/emulation';

const dev = (id: string) => BUILT_IN_DEVICES.find((d) => d.id === id)!;

describe('device -> remote emulation', () => {
  it('maps a phone to mobile + touch with its UA and DPR', () => {
    const e = remoteEmulation(dev('iphone-16-pro'), 'folded', 'portrait');
    expect(e.device).toMatchObject({ width: 402, height: 778, dpr: 3, mobile: true, touch: true, orientation: 'portrait' });
    expect(e.device.userAgent).toMatch(/iPhone/);
    expect(e.device.screen).toEqual({ width: 402, height: 874 });
    expect(e.fold).toBeNull();
  });

  it('emulates the Surface Duo hinge as a display feature only when expanded', () => {
    const duo = dev('surface-duo');
    expect(remoteEmulation(duo, 'folded', 'portrait').fold).toBeNull();
    const open = remoteEmulation(duo, 'expanded', 'portrait');
    expect(open.device.width).toBe(1114);
    expect(open.fold).toEqual({ axis: 'vertical', offset: 540, maskLength: 34 });
  });

  it('rotates the fold axis in landscape', () => {
    const open = remoteEmulation(dev('surface-duo'), 'expanded', 'landscape');
    expect(open.device).toMatchObject({ width: 720, height: 1114, orientation: 'landscape' });
    expect(open.fold).toEqual({ axis: 'horizontal', offset: 540, maskLength: 34 });
  });

  it('keeps a crease (mask 0) on the Galaxy Z Fold 5', () => {
    const open = remoteEmulation(dev('galaxy-z-fold-5'), 'expanded', 'portrait');
    expect(open.fold).toEqual({ axis: 'vertical', offset: 345, maskLength: 0 });
  });

  it('drops the fold mid-transition (viewport differs from the resting geometry)', () => {
    const mid = remoteEmulation(dev('surface-duo'), 'expanded', 'portrait', { width: 800, height: 720 });
    expect(mid.device.width).toBe(800);
    expect(mid.fold).toBeNull();
  });

  it('treats laptops as desktop (no mobile viewport, no touch)', () => {
    const e = remoteEmulation(dev('laptop-13'), 'folded', 'portrait');
    expect(e.device).toMatchObject({ width: 1280, height: 800, mobile: false, touch: false });
    expect(isMobileProfile(dev('laptop-13'))).toBe(false);
    expect(isMobileProfile(dev('ipad-mini'))).toBe(true);
  });

  it('caps DPR for captures', () => {
    expect(chromiumViewportFor(dev('iphone-16-pro'), 'folded', 'portrait', 2).viewport.dpr).toBe(2);
  });
});

describe('server-side emulation sanitising', () => {
  it('clamps sizes and rejects hostile UA strings', () => {
    const d = sanitizeDevice({ width: 99999, height: -4, dpr: 40, userAgent: 'evil\r\nHeader: 1' });
    expect(d.width).toBe(4096);
    expect(d.height).toBe(120);
    expect(d.dpr).toBe(4);
    expect(d.userAgent).toBeUndefined();
  });

  it('rejects folds that do not split the viewport', () => {
    const d = sanitizeDevice({ width: 1114, height: 720 });
    expect(sanitizeFold({ axis: 'vertical', offset: 540, maskLength: 34 }, d)).toEqual({ axis: 'vertical', offset: 540, maskLength: 34 });
    expect(sanitizeFold({ axis: 'vertical', offset: 0, maskLength: 0 }, d)).toBeNull();
    expect(sanitizeFold({ axis: 'vertical', offset: 1100, maskLength: 34 }, d)).toBeNull();
    expect(sanitizeFold({ axis: 'diagonal' as never, offset: 300, maskLength: 0 }, d)).toBeNull();
  });

  it('builds device metrics with the inline display feature only for that method', () => {
    const e = sanitizeEmulation({ device: { width: 1114, height: 720, dpr: 2.5, mobile: true, touch: true }, fold: { axis: 'vertical', offset: 540, maskLength: 34 } });
    const legacy = deviceMetricsParams(e.device, e.fold, 'deviceMetrics');
    expect(legacy).toMatchObject({ width: 1114, height: 720, deviceScaleFactor: 2.5, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
    expect(legacy.displayFeature).toEqual({ orientation: 'vertical', offset: 540, maskLength: 34 });
    expect(deviceMetricsParams(e.device, e.fold, 'displayFeaturesOverride')).not.toHaveProperty('displayFeature');
  });

  it('never advertises HeadlessChrome and derives client hints from the UA', () => {
    expect(defaultUserAgent('153.0.8010.12', 'linux')).toBe('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36');
    const md = userAgentMetadataFor('Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', '153.0.1', true);
    expect(md).toMatchObject({ platform: 'Android', platformVersion: '15', model: 'Pixel 8', mobile: true });
    expect(userAgentMetadataFor('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', '153', true).platform).toBe('iOS');
  });

  it('maps colour scheme / reduced motion to media features', () => {
    expect(mediaFeatures('dark', true)).toEqual([
      { name: 'prefers-color-scheme', value: 'dark' },
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ]);
    expect(mediaFeatures(null, false).every((f) => f.value === '')).toBe(true);
  });
});
