import type { DeviceProfile } from '@shared/types';

/**
 * Industrial design of each simulated device: the metal band and finish seen
 * around the glass, and the back plate with its camera module. Values follow
 * each product's published colours and camera layouts; sizes are fractions of
 * the device so they scale with any frame. Brand logos are deliberately not
 * drawn.
 */

export type CameraLayout =
  | 'iphone-pro' // square module, three lenses in a triangle, flash + LiDAR
  | 'iphone-single' // one lens and flash, top left
  | 'pixel-bar' // full-width camera bar
  | 'galaxy-vertical' // three lenses stacked, no module
  | 'fold-vertical' // three lenses in a raised vertical pill
  | 'duo' // vertical pill near the hinge (second panel)
  | 'ipad-pro' // square module with two lenses, flash, LiDAR
  | 'ipad-single'
  | 'tab-dual' // two lenses stacked, no module
  | 'none';

export type Hardware = {
  /** Visible metal band around the glass, CSS px. */
  band: number;
  /** Band colour as a CSS gradient. */
  frame: string;
  /** Back plate colour as a CSS background. */
  back: string;
  /** Lighter finishes need dark camera rings and a dark-on-light seam. */
  light: boolean;
  camera: CameraLayout;
};

const TITANIUM_DESERT = {
  frame: 'linear-gradient(135deg, #cdbfae 0%, #a8998a 30%, #e2d6c8 52%, #9c8d7e 75%, #c8b9a8 100%)',
  back: 'radial-gradient(120% 70% at 30% 10%, rgba(255,255,255,0.22), transparent 60%), linear-gradient(160deg, #cbbca9 0%, #b9a996 55%, #c6b7a4 100%)',
  light: true,
};
const TITANIUM_BLACK = {
  frame: 'linear-gradient(135deg, #4a4a4c 0%, #2c2c2e 30%, #5d5d60 52%, #262628 75%, #434345 100%)',
  back: 'radial-gradient(120% 70% at 30% 10%, rgba(255,255,255,0.08), transparent 60%), linear-gradient(160deg, #2e2e30 0%, #222224 55%, #2b2b2d 100%)',
  light: false,
};
const GLACIER = {
  frame: 'linear-gradient(135deg, #f4f4f5 0%, #d3d4d7 30%, #ffffff 52%, #c7c8cb 75%, #eeeef0 100%)',
  back: 'radial-gradient(120% 70% at 30% 10%, rgba(255,255,255,0.65), transparent 60%), linear-gradient(160deg, #eef0f2 0%, #e1e3e6 55%, #eceef0 100%)',
  light: true,
};
const OBSIDIAN = {
  frame: 'linear-gradient(135deg, #3b3c3f 0%, #1f2022 35%, #4a4b4e 55%, #1b1c1e 80%, #333437 100%)',
  back: 'radial-gradient(120% 70% at 30% 10%, rgba(255,255,255,0.06), transparent 60%), linear-gradient(160deg, #1d1e20 0%, #151617 55%, #1c1d1f 100%)',
  light: false,
};
const ONYX = {
  frame: 'linear-gradient(135deg, #3a3b3e 0%, #1c1d20 35%, #4c4d51 55%, #18191b 80%, #2f3033 100%)',
  back: 'radial-gradient(120% 70% at 30% 10%, rgba(255,255,255,0.1), transparent 60%), linear-gradient(160deg, #26272b 0%, #1a1b1e 55%, #24252a 100%)',
  light: false,
};
const SPACE_GREY = {
  frame: 'linear-gradient(135deg, #8b8c90 0%, #5d5e62 35%, #a4a5a9 55%, #55565a 80%, #7c7d81 100%)',
  back: 'radial-gradient(120% 70% at 30% 10%, rgba(255,255,255,0.18), transparent 60%), linear-gradient(160deg, #6f7074 0%, #5b5c60 55%, #6b6c70 100%)',
  light: false,
};
const GRAPHITE = {
  frame: 'linear-gradient(135deg, #5a5b5f 0%, #3a3b3e 35%, #6d6e72 55%, #36373a 80%, #535458 100%)',
  back: 'radial-gradient(120% 70% at 30% 10%, rgba(255,255,255,0.12), transparent 60%), linear-gradient(160deg, #46474b 0%, #3a3b3e 55%, #444549 100%)',
  light: false,
};

const BY_ID: Record<string, Hardware> = {
  'iphone-16-pro': { band: 3, camera: 'iphone-pro', ...TITANIUM_DESERT },
  'iphone-16-pro-max': { band: 3, camera: 'iphone-pro', ...TITANIUM_BLACK },
  'iphone-se': { band: 2, camera: 'iphone-single', ...OBSIDIAN },
  'pixel-8': { band: 3, camera: 'pixel-bar', ...OBSIDIAN },
  'galaxy-s24': { band: 2, camera: 'galaxy-vertical', ...ONYX },
  'surface-duo': { band: 2, camera: 'duo', ...GLACIER },
  'galaxy-z-fold-5': { band: 2, camera: 'fold-vertical', ...ONYX },
  'pixel-fold': { band: 3, camera: 'pixel-bar', ...OBSIDIAN },
  'ipad-pro-13': { band: 2, camera: 'ipad-pro', ...SPACE_GREY },
  'ipad-mini': { band: 2, camera: 'ipad-single', ...SPACE_GREY },
  'galaxy-tab-s9': { band: 2, camera: 'tab-dual', ...GRAPHITE },
};

const BY_STYLE: Partial<Record<DeviceProfile['frameStyle'], Hardware>> = {
  'iphone-island': { band: 3, camera: 'iphone-pro', ...TITANIUM_BLACK },
  'iphone-notch': { band: 3, camera: 'iphone-pro', ...TITANIUM_BLACK },
  'iphone-home': { band: 2, camera: 'iphone-single', ...OBSIDIAN },
  'android-punch': { band: 3, camera: 'galaxy-vertical', ...ONYX },
  'foldable-book': { band: 2, camera: 'fold-vertical', ...ONYX },
  'dual-screen': { band: 2, camera: 'duo', ...GLACIER },
  ipad: { band: 2, camera: 'ipad-single', ...SPACE_GREY },
  'android-tablet': { band: 2, camera: 'tab-dual', ...GRAPHITE },
  laptop: { band: 0, camera: 'none', ...SPACE_GREY },
  monitor: { band: 0, camera: 'none', ...GRAPHITE },
};

export function hardwareFor(device: DeviceProfile): Hardware {
  return BY_ID[device.id] ?? BY_STYLE[device.frameStyle] ?? { band: 0, camera: 'none', ...OBSIDIAN };
}
