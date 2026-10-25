import type { DeviceProfile, Insets, PostureGeometry } from '@shared/types';

/**
 * Built-in device registry.
 *
 * Geometry is expressed in CSS px for the device's natural ("portrait") orientation.
 * `viewport` is what the page sees as innerWidth × innerHeight: the screen minus
 * system bars (status bar / home indicator / gesture bar). No browser address bar is
 * simulated unless `browserChrome` is non-zero.
 *
 * None of these profiles reproduce hardware exactly. Each carries a verification note
 * stating where its numbers come from so the UI never over-claims accuracy.
 */

const inset = (top: number, right = top, bottom = top, left = right): Insets => ({ top, right, bottom, left });
const ZERO = inset(0);

function geometry(
  screenW: number,
  screenH: number,
  opts: {
    safe?: Insets;
    radius?: number;
    bezel?: Insets;
    chrome?: { top: number; bottom: number };
    fold?: PostureGeometry['fold'];
  } = {},
): PostureGeometry {
  const safe = opts.safe ?? ZERO;
  const chrome = opts.chrome ?? { top: 0, bottom: 0 };
  return {
    screen: { width: screenW, height: screenH },
    viewport: {
      width: screenW - safe.left - safe.right,
      height: screenH - safe.top - safe.bottom - chrome.top - chrome.bottom,
    },
    safeArea: safe,
    browserChrome: chrome,
    cornerRadius: opts.radius ?? 0,
    bezel: opts.bezel ?? inset(12),
    fold: opts.fold,
  };
}

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA = (model: string) =>
  `Mozilla/5.0 (Linux; Android 15; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36`;
const ANDROID_TABLET_UA = (model: string) =>
  `Mozilla/5.0 (Linux; Android 15; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36`;

export const BUILT_IN_DEVICES: DeviceProfile[] = [
  {
    id: 'surface-duo',
    name: 'Surface Duo',
    vendor: 'Microsoft',
    platform: 'android',
    category: 'foldable',
    pixelRatio: 2.5,
    touch: true,
    userAgent: ANDROID_UA('Surface Duo'),
    frameStyle: 'dual-screen',
    folded: geometry(540, 720, { radius: 6, bezel: inset(16, 6, 16, 6) }),
    expanded: geometry(1114, 720, {
      radius: 6,
      bezel: inset(16, 6, 16, 6),
      fold: { axis: 'vertical', offset: 540, maskLength: 34, kind: 'hinge' },
    }),
    verification: {
      level: 'provisional',
      source: "Chrome DevTools' Surface Duo emulation preset (540×720 single screen, 1114×720 spanned, 34px hinge).",
      note: 'Provisional Duo profile. Not verified against hardware; confirm with the project owner before relying on exact pixel positions.',
    },
    builtIn: true,
  },
  {
    id: 'galaxy-z-fold-5',
    name: 'Galaxy Z Fold 5',
    vendor: 'Samsung',
    platform: 'android',
    category: 'foldable',
    pixelRatio: 2.625,
    touch: true,
    userAgent: ANDROID_UA('SM-F946B'),
    frameStyle: 'foldable-book',
    folded: geometry(344, 882, { safe: inset(24, 0, 24, 0), radius: 22, bezel: inset(8) }),
    expanded: geometry(690, 829, {
      safe: inset(24, 0, 24, 0),
      radius: 18,
      bezel: inset(9),
      fold: { axis: 'vertical', offset: 345, maskLength: 0, kind: 'crease' },
    }),
    verification: {
      level: 'provisional',
      source: "Derived from Samsung's published panel resolutions (cover 904×2316, main 1812×2176) at an assumed device pixel ratio of 2.625.",
      note: 'System bar heights are approximations.',
    },
    builtIn: true,
  },
  {
    id: 'pixel-fold',
    name: 'Pixel Fold',
    vendor: 'Google',
    platform: 'android',
    category: 'foldable',
    pixelRatio: 2.625,
    touch: true,
    userAgent: ANDROID_UA('Pixel Fold'),
    frameStyle: 'foldable-book',
    folded: geometry(411, 797, { safe: inset(24, 0, 24, 0), radius: 26, bezel: inset(11) }),
    expanded: geometry(841, 701, {
      safe: inset(24, 0, 24, 0),
      radius: 20,
      bezel: inset(11),
      fold: { axis: 'vertical', offset: 420, maskLength: 0, kind: 'crease' },
    }),
    verification: {
      level: 'provisional',
      source: "Derived from Google's published panel resolutions (cover 1080×2092, main 2208×1840) at an assumed device pixel ratio of 2.625.",
    },
    builtIn: true,
  },
  {
    id: 'iphone-16-pro',
    name: 'iPhone 16 Pro',
    vendor: 'Apple',
    platform: 'ios',
    category: 'phone',
    pixelRatio: 3,
    touch: true,
    userAgent: IOS_UA,
    frameStyle: 'iphone-island',
    folded: geometry(402, 874, { safe: inset(62, 0, 34, 0), radius: 55, bezel: inset(8) }),
    verification: {
      level: 'reference',
      source: 'Apple-published logical resolution (402×874 pt). Status bar and home indicator heights approximate.',
    },
    builtIn: true,
  },
  {
    id: 'iphone-16-pro-max',
    name: 'iPhone 16 Pro Max',
    vendor: 'Apple',
    platform: 'ios',
    category: 'phone',
    pixelRatio: 3,
    touch: true,
    userAgent: IOS_UA,
    frameStyle: 'iphone-island',
    folded: geometry(440, 956, { safe: inset(62, 0, 34, 0), radius: 60, bezel: inset(8) }),
    verification: { level: 'reference', source: 'Apple-published logical resolution (440×956 pt).' },
    builtIn: true,
  },
  {
    id: 'iphone-se',
    name: 'iPhone SE',
    vendor: 'Apple',
    platform: 'ios',
    category: 'phone',
    pixelRatio: 2,
    touch: true,
    userAgent: IOS_UA,
    frameStyle: 'iphone-home',
    folded: geometry(375, 667, { safe: inset(20, 0, 0, 0), radius: 0, bezel: inset(96, 22, 96, 22) }),
    verification: { level: 'reference', source: 'Apple-published logical resolution (375×667 pt).' },
    builtIn: true,
  },
  {
    id: 'pixel-8',
    name: 'Pixel 8',
    vendor: 'Google',
    platform: 'android',
    category: 'phone',
    pixelRatio: 2.625,
    touch: true,
    userAgent: ANDROID_UA('Pixel 8'),
    frameStyle: 'android-punch',
    folded: geometry(412, 915, { safe: inset(24, 0, 24, 0), radius: 38, bezel: inset(10) }),
    verification: { level: 'provisional', source: 'Commonly reported CSS viewport for 1080×2400 Pixel panels at DPR 2.625.' },
    builtIn: true,
  },
  {
    id: 'galaxy-s24',
    name: 'Galaxy S24',
    vendor: 'Samsung',
    platform: 'android',
    category: 'phone',
    pixelRatio: 3,
    touch: true,
    userAgent: ANDROID_UA('SM-S921B'),
    frameStyle: 'android-punch',
    folded: geometry(360, 780, { safe: inset(24, 0, 24, 0), radius: 32, bezel: inset(7) }),
    verification: { level: 'provisional', source: '1080×2340 panel at DPR 3.' },
    builtIn: true,
  },
  {
    id: 'ipad-pro-13',
    name: 'iPad Pro 13″',
    vendor: 'Apple',
    platform: 'ios',
    category: 'tablet',
    pixelRatio: 2,
    touch: true,
    userAgent: IPAD_UA,
    frameStyle: 'ipad',
    folded: geometry(1032, 1376, { safe: inset(24, 0, 20, 0), radius: 30, bezel: inset(22) }),
    verification: { level: 'reference', source: 'Apple-published logical resolution (1032×1376 pt).' },
    builtIn: true,
  },
  {
    id: 'ipad-mini',
    name: 'iPad mini',
    vendor: 'Apple',
    platform: 'ios',
    category: 'tablet',
    pixelRatio: 2,
    touch: true,
    userAgent: IPAD_UA,
    frameStyle: 'ipad',
    folded: geometry(744, 1133, { safe: inset(24, 0, 20, 0), radius: 22, bezel: inset(28) }),
    verification: { level: 'reference', source: 'Apple-published logical resolution (744×1133 pt).' },
    builtIn: true,
  },
  {
    id: 'galaxy-tab-s9',
    name: 'Galaxy Tab S9',
    vendor: 'Samsung',
    platform: 'android',
    category: 'tablet',
    pixelRatio: 2,
    touch: true,
    userAgent: ANDROID_TABLET_UA('SM-X710'),
    frameStyle: 'android-tablet',
    folded: geometry(800, 1280, { safe: inset(24, 0, 24, 0), radius: 18, bezel: inset(20) }),
    verification: { level: 'provisional', source: '1600×2560 panel at DPR 2.' },
    builtIn: true,
  },
  {
    id: 'laptop-13',
    name: 'Laptop 13″',
    platform: 'desktop',
    category: 'desktop',
    pixelRatio: 2,
    touch: false,
    frameStyle: 'laptop',
    folded: geometry(1280, 800, { radius: 8, bezel: inset(18, 18, 22, 18) }),
    verification: { level: 'reference', source: 'Common laptop CSS viewport (1280×800).' },
    builtIn: true,
  },
  {
    id: 'desktop-1440',
    name: 'Desktop 1440',
    platform: 'desktop',
    category: 'desktop',
    pixelRatio: 2,
    touch: false,
    frameStyle: 'monitor',
    folded: geometry(1440, 900, { radius: 6, bezel: inset(14, 14, 14, 14) }),
    verification: { level: 'reference', source: 'Common desktop CSS viewport (1440×900).' },
    builtIn: true,
  },
  {
    id: 'desktop-1920',
    name: 'Full HD',
    platform: 'desktop',
    category: 'desktop',
    pixelRatio: 1,
    touch: false,
    frameStyle: 'monitor',
    folded: geometry(1920, 1080, { radius: 6, bezel: inset(14) }),
    verification: { level: 'reference', source: 'Full HD CSS viewport (1920×1080).' },
    builtIn: true,
  },
  {
    id: 'compact-360',
    name: 'Compact 360',
    platform: 'generic',
    category: 'custom',
    pixelRatio: 2,
    touch: true,
    frameStyle: 'bare',
    folded: geometry(360, 740, { radius: 0, bezel: inset(0) }),
    verification: { level: 'custom', source: 'Generic compact mobile breakpoint.' },
    builtIn: true,
  },
];

export const DEFAULT_DEVICE_ID = 'surface-duo';
export const RESPONSIVE_ID = 'responsive';

/** Free-form viewport whose size is dragged on the canvas (like a browser's responsive mode). */
let responsiveCache: { key: string; device: DeviceProfile } | null = null;

export function responsiveDevice(size: { width: number; height: number }): DeviceProfile {
  // Stable identity per size so store selectors do not re-render endlessly.
  const key = `${size.width}x${size.height}`;
  if (responsiveCache?.key === key) return responsiveCache.device;
  const device = makeResponsive(size);
  responsiveCache = { key, device };
  return device;
}

function makeResponsive(size: { width: number; height: number }): DeviceProfile {
  return {
    id: RESPONSIVE_ID,
    name: 'Responsive',
    platform: 'generic',
    category: 'custom',
    pixelRatio: 2,
    touch: false,
    frameStyle: 'bare',
    folded: geometry(size.width, size.height, { radius: 0, bezel: inset(0) }),
    verification: { level: 'custom', source: 'Free-form viewport sized on the canvas.' },
    builtIn: true,
  };
}

export function createCustomDevice(partial: Partial<DeviceProfile> & { name: string; width: number; height: number }): DeviceProfile {
  const { width, height, ...rest } = partial;
  return {
    id: `custom-${Math.random().toString(36).slice(2, 9)}`,
    platform: 'generic',
    category: 'custom',
    pixelRatio: 2,
    touch: true,
    frameStyle: 'bare',
    folded: geometry(width, height, { bezel: inset(0) }),
    verification: { level: 'custom', source: 'User-defined profile.' },
    builtIn: false,
    ...rest,
  };
}

export { geometry as makeGeometry, inset as makeInsets };
