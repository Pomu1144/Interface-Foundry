/**
 * Pure helpers that turn the studio's emulation request into Chrome DevTools
 * Protocol parameters. No Playwright imports so they are unit-testable.
 */
import type { DisplayFeatureMethod, EmulationParams, RemoteDevice, RemoteFold } from '../../src/modules/preview-runtime/remote/protocol';

const clamp = (n: unknown, min: number, max: number, fallback: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.min(max, Math.max(min, v));
};

/** Validate and clamp a device description coming from the studio. */
export function sanitizeDevice(d: Partial<RemoteDevice> | undefined): RemoteDevice {
  const width = Math.round(clamp(d?.width, 120, 4096, 390));
  const height = Math.round(clamp(d?.height, 120, 4096, 844));
  const screenW = Math.round(clamp(d?.screen?.width, width, 4096, width));
  const screenH = Math.round(clamp(d?.screen?.height, height, 4096, height));
  const ua = typeof d?.userAgent === 'string' && d.userAgent.length <= 512 && !/[\r\n]/.test(d.userAgent) ? d.userAgent : undefined;
  return {
    width,
    height,
    dpr: Math.round(clamp(d?.dpr, 0.5, 4, 1) * 1000) / 1000,
    mobile: Boolean(d?.mobile),
    touch: Boolean(d?.touch),
    userAgent: ua,
    screen: { width: screenW, height: screenH },
    orientation: d?.orientation === 'landscape' ? 'landscape' : d?.orientation === 'portrait' ? 'portrait' : width > height ? 'landscape' : 'portrait',
  };
}

/** A fold is only valid if it splits the viewport into two non-empty segments. */
export function sanitizeFold(f: Partial<RemoteFold> | null | undefined, device: RemoteDevice): RemoteFold | null {
  if (!f || (f.axis !== 'vertical' && f.axis !== 'horizontal')) return null;
  const extent = f.axis === 'vertical' ? device.width : device.height;
  const offset = Math.round(clamp(f.offset, 0, extent, -1));
  const maskLength = Math.round(clamp(f.maskLength, 0, extent, 0));
  if (offset <= 0 || offset + maskLength >= extent) return null;
  return { axis: f.axis, offset, maskLength };
}

export function sanitizeEmulation(e: Partial<EmulationParams>): EmulationParams {
  const device = sanitizeDevice(e.device);
  return {
    device,
    fold: sanitizeFold(e.fold, device),
    colorScheme: e.colorScheme === 'dark' || e.colorScheme === 'light' ? e.colorScheme : null,
    reducedMotion: Boolean(e.reducedMotion),
  };
}

export type CdpDisplayFeature = { orientation: 'vertical' | 'horizontal'; offset: number; maskLength: number };

export function displayFeatureFor(fold: RemoteFold): CdpDisplayFeature {
  return { orientation: fold.axis, offset: fold.offset, maskLength: fold.maskLength };
}

/** `Emulation.setDeviceMetricsOverride` parameters. */
export function deviceMetricsParams(device: RemoteDevice, fold: RemoteFold | null, method: DisplayFeatureMethod) {
  const landscape = device.orientation === 'landscape';
  return {
    width: device.width,
    height: device.height,
    deviceScaleFactor: device.dpr,
    mobile: device.mobile,
    screenWidth: device.screen?.width ?? device.width,
    screenHeight: device.screen?.height ?? device.height,
    screenOrientation: landscape ? { type: 'landscapePrimary' as const, angle: 90 } : { type: 'portraitPrimary' as const, angle: 0 },
    // Older Chromium builds only honour the (deprecated) inline display feature.
    ...(fold && method === 'deviceMetrics' ? { displayFeature: displayFeatureFor(fold) } : {}),
  };
}

/** Desktop Chrome UA for the bundled Chromium version (never "HeadlessChrome", which many sites block). */
export function defaultUserAgent(browserVersion: string, platform: NodeJS.Platform = process.platform): string {
  const major = /^(\d+)/.exec(browserVersion)?.[1] ?? '130';
  const os = platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

export type UserAgentMetadata = {
  brands: { brand: string; version: string }[];
  fullVersion: string;
  platform: string;
  platformVersion: string;
  architecture: string;
  model: string;
  mobile: boolean;
};

/** User-Agent Client Hints that agree with the overridden UA string. */
export function userAgentMetadataFor(ua: string, browserVersion: string, mobile: boolean): UserAgentMetadata {
  const major = /^(\d+)/.exec(browserVersion)?.[1] ?? '130';
  let platform = 'Linux';
  let platformVersion = '';
  let model = '';
  const android = /Android\s+([\d.]+)?;?\s*([^;)]*)/.exec(ua);
  if (android) {
    platform = 'Android';
    platformVersion = android[1] ?? '';
    model = (android[2] ?? '').replace(/\s*Build\/.*$/, '').trim();
  } else if (/iPhone|iPad|iPod/.test(ua)) {
    platform = 'iOS';
    platformVersion = (/OS (\d+[_\d]*)/.exec(ua)?.[1] ?? '').replace(/_/g, '.');
  } else if (/Windows/.test(ua)) {
    platform = 'Windows';
    platformVersion = '10.0.0';
  } else if (/Mac OS X/.test(ua)) {
    platform = 'macOS';
    platformVersion = (/Mac OS X (\d+[_\d]*)/.exec(ua)?.[1] ?? '').replace(/_/g, '.');
  }
  return {
    brands: [
      { brand: 'Chromium', version: major },
      { brand: 'Not=A?Brand', version: '24' },
    ],
    fullVersion: browserVersion,
    platform,
    platformVersion,
    architecture: mobile ? '' : 'x86',
    model,
    mobile,
  };
}

/** `Emulation.setEmulatedMedia` features (empty value = no override). */
export function mediaFeatures(colorScheme: EmulationParams['colorScheme'], reducedMotion: boolean) {
  return [
    { name: 'prefers-color-scheme', value: colorScheme ?? '' },
    { name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : '' },
  ];
}

/** Stable key used to skip redundant CDP calls. */
export const emulationKey = {
  metrics: (d: RemoteDevice, fold: RemoteFold | null) => `${d.width}x${d.height}@${d.dpr}|${d.mobile}|${d.screen?.width}x${d.screen?.height}|${d.orientation}|${fold ? `${fold.axis}:${fold.offset}:${fold.maskLength}` : '-'}`,
  ua: (d: RemoteDevice) => `${d.userAgent ?? ''}|${d.mobile}`,
  media: (e: EmulationParams) => `${e.colorScheme ?? ''}|${e.reducedMotion}`,
};
