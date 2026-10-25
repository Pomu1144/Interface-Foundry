import type { IosDeps } from './deps';

/**
 * Xcode's `simctl` (through `xcrun`): discovery, device matching, boot and
 * shutdown. Parsing is kept pure so it can be tested against recorded
 * `simctl list -j` output.
 */

export type SimRuntime = { identifier: string; name: string; version: string; isAvailable: boolean; supportedDeviceTypes?: { identifier: string; name: string }[] };
export type SimDeviceType = { identifier: string; name: string; productFamily?: string };
export type SimDevice = { udid: string; name: string; state: string; isAvailable: boolean; deviceTypeIdentifier?: string; runtime: string };
export type SimInventory = { runtimes: SimRuntime[]; deviceTypes: SimDeviceType[]; devices: SimDevice[] };

export const SIMCTL_TIMEOUT = 30_000;
export const BOOT_TIMEOUT = 240_000;
/** Name prefix of simulators IFDY creates; IFDY never touches devices without it except to read them. */
export const IFDY_PREFIX = 'IFDY ';

export const simctl = (deps: IosDeps, args: string[], timeoutMs = SIMCTL_TIMEOUT) => deps.exec('xcrun', ['simctl', ...args], { timeoutMs });

/** Parse `xcrun simctl list -j devices runtimes devicetypes`. Tolerates missing sections. */
export function parseInventory(json: string): SimInventory {
  let raw: { runtimes?: unknown; devicetypes?: unknown; devices?: unknown };
  try {
    raw = JSON.parse(json) as typeof raw;
  } catch {
    throw new Error('simctl returned output that is not JSON.');
  }
  const runtimes = (Array.isArray(raw.runtimes) ? raw.runtimes : [])
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
    .map((r) => ({
      identifier: String(r.identifier ?? ''),
      name: String(r.name ?? ''),
      version: String(r.version ?? ''),
      // Older Xcodes reported `availability: "(available)"` instead of `isAvailable`.
      isAvailable: r.isAvailable === true || r.availability === '(available)',
      supportedDeviceTypes: Array.isArray(r.supportedDeviceTypes)
        ? (r.supportedDeviceTypes as Record<string, unknown>[]).map((t) => ({ identifier: String(t.identifier ?? ''), name: String(t.name ?? '') }))
        : undefined,
    }));
  const deviceTypes = (Array.isArray(raw.devicetypes) ? raw.devicetypes : [])
    .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === 'object')
    .map((t) => ({ identifier: String(t.identifier ?? ''), name: String(t.name ?? ''), productFamily: typeof t.productFamily === 'string' ? t.productFamily : undefined }));
  const devices: SimDevice[] = [];
  if (raw.devices && typeof raw.devices === 'object') {
    for (const [runtime, list] of Object.entries(raw.devices as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      for (const d of list as Record<string, unknown>[]) {
        if (!d || typeof d.udid !== 'string') continue;
        devices.push({
          udid: d.udid,
          name: String(d.name ?? ''),
          state: String(d.state ?? 'Unknown'),
          isAvailable: d.isAvailable === true || d.availability === '(available)',
          deviceTypeIdentifier: typeof d.deviceTypeIdentifier === 'string' ? d.deviceTypeIdentifier : undefined,
          runtime,
        });
      }
    }
  }
  return { runtimes, deviceTypes, devices };
}

export async function listInventory(deps: IosDeps): Promise<SimInventory> {
  const { stdout } = await simctl(deps, ['list', '-j', 'devices', 'runtimes', 'devicetypes']);
  return parseInventory(stdout);
}

const versionKey = (v: string) =>
  v
    .split('.')
    .map((n) => Number(n) || 0)
    .concat([0, 0, 0])
    .slice(0, 3);
export const compareVersions = (a: string, b: string) => {
  const x = versionKey(a);
  const y = versionKey(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

/** Installed, available iOS runtimes, newest first. */
export function iosRuntimes(inv: SimInventory): SimRuntime[] {
  return inv.runtimes
    .filter((r) => r.isAvailable && (/\.iOS-/.test(r.identifier) || /^iOS\b/.test(r.name)))
    .sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * IFDY device profile -> simulator device type names, most faithful first. Later
 * entries are close substitutes for older Xcodes that do not ship the newest models.
 */
export const DEVICE_TYPE_PREFERENCES: Record<string, string[]> = {
  'iphone-16-pro': ['iPhone 16 Pro', 'iPhone 15 Pro', 'iPhone 16', 'iPhone 15'],
  'iphone-16-pro-max': ['iPhone 16 Pro Max', 'iPhone 15 Pro Max', 'iPhone 16 Plus', 'iPhone 15 Plus'],
  'iphone-se': ['iPhone SE (3rd generation)', 'iPhone SE (2nd generation)'],
  'ipad-pro-13': ['iPad Pro 13-inch (M4)', 'iPad Pro (12.9-inch) (6th generation)', 'iPad Pro (12.9-inch) (5th generation)', 'iPad Air 13-inch (M2)'],
  'ipad-mini': ['iPad mini (A17 Pro)', 'iPad mini (6th generation)'],
};
const DEFAULT_PHONE = ['iPhone 16 Pro', 'iPhone 16', 'iPhone 15 Pro', 'iPhone 15'];
const DEFAULT_TABLET = ['iPad Pro 13-inch (M4)', 'iPad Air 13-inch (M2)', 'iPad Pro (12.9-inch) (6th generation)', 'iPad (10th generation)'];

export type DeviceChoice = {
  runtime: SimRuntime;
  deviceType: SimDeviceType;
  family: 'iPhone' | 'iPad';
  /** The device type is not what the profile asked for (no exact match installed). */
  substitute: boolean;
  /** What the profile asked for (first preference). */
  wanted: string;
};

/**
 * Choose the runtime + device type for an IFDY device profile: the first preferred
 * type supported by the newest runtime that has one, else any device of the right
 * family (newest-listed), marked as a substitute.
 */
export function chooseDeviceType(inv: SimInventory, deviceId: string | undefined, viewport: { width: number; height: number }): DeviceChoice | null {
  const id = typeof deviceId === 'string' ? deviceId : '';
  const tablet = id.startsWith('ipad') || (!DEVICE_TYPE_PREFERENCES[id] && Math.min(viewport.width, viewport.height) >= 600);
  const prefs = DEVICE_TYPE_PREFERENCES[id] ?? (tablet ? DEFAULT_TABLET : DEFAULT_PHONE);
  const family: 'iPhone' | 'iPad' = tablet ? 'iPad' : 'iPhone';
  const runtimes = iosRuntimes(inv);
  const supported = (r: SimRuntime, t: SimDeviceType) => !r.supportedDeviceTypes || r.supportedDeviceTypes.some((s) => s.identifier === t.identifier);
  const byName = new Map(inv.deviceTypes.map((t) => [t.name, t]));
  const exact = DEVICE_TYPE_PREFERENCES[id] !== undefined;
  for (const [i, name] of prefs.entries()) {
    const t = byName.get(name);
    if (!t) continue;
    const r = runtimes.find((rt) => supported(rt, t));
    if (r) return { runtime: r, deviceType: t, family, substitute: !exact || i > 0, wanted: prefs[0] };
  }
  const isFamily = (t: SimDeviceType) => (t.productFamily ? t.productFamily === family : t.name.startsWith(family));
  for (const r of runtimes) {
    const candidates = inv.deviceTypes.filter((t) => isFamily(t) && supported(r, t));
    const t = candidates[candidates.length - 1];
    if (t) return { runtime: r, deviceType: t, family, substitute: true, wanted: prefs[0] };
  }
  return null;
}

/** IFDY's own simulator for a device type + runtime, if one was created before. */
export function findIfdyDevice(inv: SimInventory, choice: DeviceChoice): SimDevice | null {
  const name = `${IFDY_PREFIX}${choice.deviceType.name}`;
  return (
    inv.devices.find(
      (d) => d.runtime === choice.runtime.identifier && d.isAvailable && d.name === name && (!d.deviceTypeIdentifier || d.deviceTypeIdentifier === choice.deviceType.identifier),
    ) ?? null
  );
}

export async function createDevice(deps: IosDeps, choice: DeviceChoice): Promise<string> {
  const { stdout } = await simctl(deps, ['create', `${IFDY_PREFIX}${choice.deviceType.name}`, choice.deviceType.identifier, choice.runtime.identifier], 120_000);
  const udid = stdout.trim().split('\n').pop()?.trim() ?? '';
  if (!/^[0-9A-F-]{36}$/i.test(udid)) throw new Error(`simctl create returned an unexpected device id "${udid.slice(0, 60)}".`);
  return udid;
}

/** Boot (idempotent) and wait until the device has finished booting. */
export async function bootDevice(deps: IosDeps, udid: string): Promise<void> {
  try {
    await simctl(deps, ['boot', udid], 120_000);
  } catch (err) {
    // "Unable to boot device in current state: Booted" is success for us.
    if (!/current state: Booted/i.test((err as Error).message)) throw err;
  }
  await simctl(deps, ['bootstatus', udid, '-b'], BOOT_TIMEOUT);
}

export async function shutdownDevice(deps: IosDeps, udid: string): Promise<void> {
  try {
    await simctl(deps, ['shutdown', udid], 60_000);
  } catch (err) {
    if (!/current state: Shutdown/i.test((err as Error).message)) throw err;
  }
}

export const openUrl = (deps: IosDeps, udid: string, url: string) => simctl(deps, ['openurl', udid, url], 30_000);

export const setAppearance = (deps: IosDeps, udid: string, mode: 'light' | 'dark') => simctl(deps, ['ui', udid, 'appearance', mode], 15_000);

/** Width/height of a baseline or progressive JPEG (SOF0..SOF15 except DHT/JPG/DAC markers). */
export function jpegSize(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    const len = (buf[i + 2] << 8) | buf[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (buf[i + 5] << 8) | buf[i + 6], width: (buf[i + 7] << 8) | buf[i + 8] };
    }
    i += 2 + len;
  }
  return null;
}

/** Width/height from a PNG's IHDR chunk. */
export function pngSize(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { width: dv.getUint32(16, false), height: dv.getUint32(20, false) };
}
