import type { DeviceProfile, Orientation, Posture, PostureGeometry } from '@shared/types';
import { resolveViewport } from '@/modules/device-simulator/viewport';

/** One tile on the wall: a device at a posture. Key format: `<deviceId>:<posture>`. */
export type TileKey = string;

export type TileSpec = {
  key: TileKey;
  /** Preview instance id (`wall-<deviceId>-<posture>`). */
  instanceId: string;
  device: DeviceProfile;
  posture: Posture;
  orientation: Orientation;
  geometry: PostureGeometry;
};

export const tileKey = (deviceId: string, posture: Posture): TileKey => `${deviceId}:${posture}`;
export const tileInstanceId = (deviceId: string, posture: Posture) => `wall-${deviceId}-${posture}`;
export const isWallInstance = (id: string | null | undefined) => Boolean(id?.startsWith('wall-'));

export function parseKey(key: TileKey): { deviceId: string; posture: Posture } {
  const i = key.lastIndexOf(':');
  const posture = key.slice(i + 1) === 'expanded' ? 'expanded' : 'folded';
  return { deviceId: key.slice(0, i), posture };
}

/** The launch set: both postures of the two reference foldables, two phones, a tablet, a laptop. */
export const DEFAULT_SET: TileKey[] = [
  'surface-duo:folded',
  'surface-duo:expanded',
  'galaxy-z-fold-5:folded',
  'galaxy-z-fold-5:expanded',
  'iphone-16-pro:folded',
  'pixel-8:folded',
  'ipad-mini:folded',
  'laptop-13:folded',
];

export type PresetId = 'launch' | 'foldables' | 'phones' | 'tablets' | 'desktop' | 'everything';

export const PRESETS: { id: PresetId; label: string; hint: string }[] = [
  { id: 'launch', label: 'Launch set', hint: 'Foldables in both postures, phones, tablet, laptop' },
  { id: 'foldables', label: 'Foldables', hint: 'Every foldable, folded and expanded' },
  { id: 'phones', label: 'Phones', hint: 'Phones plus folded foldables (cover screens)' },
  { id: 'tablets', label: 'Tablets', hint: 'Tablets plus expanded foldables' },
  { id: 'desktop', label: 'Desktop', hint: 'Laptop and desktop viewports' },
  { id: 'everything', label: 'Everything', hint: 'Every device and posture' },
];

/** All selectable tiles for a device list (foldables contribute two postures). */
export function allKeys(devices: DeviceProfile[]): TileKey[] {
  return devices.flatMap((d) => (d.expanded ? [tileKey(d.id, 'folded'), tileKey(d.id, 'expanded')] : [tileKey(d.id, 'folded')]));
}

export function presetKeys(id: PresetId, devices: DeviceProfile[]): TileKey[] {
  const known = new Set(devices.map((d) => d.id));
  switch (id) {
    case 'launch':
      return DEFAULT_SET.filter((k) => known.has(parseKey(k).deviceId));
    case 'foldables':
      return devices.filter((d) => d.expanded).flatMap((d) => [tileKey(d.id, 'folded'), tileKey(d.id, 'expanded')]);
    case 'phones':
      return [...devices.filter((d) => d.category === 'phone').map((d) => tileKey(d.id, 'folded')), ...devices.filter((d) => d.expanded).map((d) => tileKey(d.id, 'folded'))];
    case 'tablets':
      return [...devices.filter((d) => d.category === 'tablet').map((d) => tileKey(d.id, 'folded')), ...devices.filter((d) => d.expanded).map((d) => tileKey(d.id, 'expanded'))];
    case 'desktop':
      return devices.filter((d) => d.category === 'desktop').map((d) => tileKey(d.id, 'folded'));
    case 'everything':
      return allKeys(devices);
  }
}

/** Which preset (if any) exactly matches a selection. */
export function matchingPreset(keys: TileKey[], devices: DeviceProfile[]): PresetId | null {
  const set = new Set(keys);
  for (const p of PRESETS) {
    const k = presetKeys(p.id, devices);
    if (k.length === set.size && k.every((x) => set.has(x))) return p.id;
  }
  return null;
}

const CATEGORY_ORDER: Record<string, number> = { foldable: 0, phone: 1, tablet: 2, desktop: 3, custom: 4 };

/** Resolve a selection into ordered tile specs (foldables first, folded before expanded). */
export function buildTiles(keys: TileKey[], devices: DeviceProfile[], orientation: Orientation): TileSpec[] {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const index = new Map(devices.map((d, i) => [d.id, i]));
  const seen = new Set<string>();
  const tiles: TileSpec[] = [];
  for (const key of keys) {
    const { deviceId, posture } = parseKey(key);
    const device = byId.get(deviceId);
    if (!device || (posture === 'expanded' && !device.expanded) || seen.has(key)) continue;
    seen.add(key);
    tiles.push({
      key,
      instanceId: tileInstanceId(deviceId, posture),
      device,
      posture,
      orientation,
      geometry: resolveViewport(device, posture, orientation).geometry,
    });
  }
  return tiles.sort(
    (a, b) =>
      (CATEGORY_ORDER[a.device.category] ?? 9) - (CATEGORY_ORDER[b.device.category] ?? 9) ||
      (index.get(a.device.id) ?? 0) - (index.get(b.device.id) ?? 0) ||
      (a.posture === 'folded' ? 0 : 1) - (b.posture === 'folded' ? 0 : 1),
  );
}

/**
 * Outer box of a device frame in CSS px, including hardware drawn outside the
 * frame (laptop base overhang, monitor stand). `offsetX` positions the frame in it.
 */
export function frameBox(device: DeviceProfile, g: PostureGeometry): { width: number; height: number; offsetX: number } {
  const bare = device.frameStyle === 'bare';
  const b = bare ? { left: 0, right: 0, top: 0, bottom: 0 } : g.bezel;
  const w = g.screen.width + b.left + b.right;
  const h = g.screen.height + b.top + b.bottom;
  if (device.frameStyle === 'laptop') return { width: Math.round(w * 1.16), height: h + 16, offsetX: Math.round(w * 0.08) };
  if (device.frameStyle === 'monitor') return { width: w, height: h + 82, offsetX: 0 };
  return { width: w, height: h, offsetX: 0 };
}
