import type { DeviceProfile, ViewportContext, ViewportState } from '@shared/types';
import { BUILT_IN_DEVICES } from '@/modules/device-simulator/devices';
import { canFold, viewportContext } from '@/modules/device-simulator/viewport';

/** The suite's reference matrix (spec §5): two Duo postures, Fold cover, a phone, a desktop. */
export const DEFAULT_SUITE_MATRIX: ViewportState[] = [
  { deviceId: 'surface-duo', posture: 'folded', orientation: 'portrait' },
  { deviceId: 'surface-duo', posture: 'expanded', orientation: 'portrait' },
  { deviceId: 'galaxy-z-fold-5', posture: 'folded', orientation: 'portrait' },
  { deviceId: 'iphone-16-pro', posture: 'folded', orientation: 'portrait' },
  { deviceId: 'desktop-1440', posture: 'folded', orientation: 'portrait' },
];

export const viewportKey = (v: Pick<ViewportState, 'deviceId' | 'posture' | 'orientation'>) => `${v.deviceId}|${v.posture}|${v.orientation}`;

export function findDevice(id: string, devices: DeviceProfile[] = BUILT_IN_DEVICES): DeviceProfile | undefined {
  return devices.find((d) => d.id === id);
}

/** Resolve a matrix entry into the viewport context a run reports. */
export function contextFor(v: ViewportState, devices: DeviceProfile[] = BUILT_IN_DEVICES): ViewportContext | null {
  const d = findDevice(v.deviceId, devices);
  if (!d) return null;
  return viewportContext(d, canFold(d) ? v.posture : 'folded', v.orientation);
}

/** Normalise an entry for a device (single-posture devices are always "folded"). */
export function normalizeEntry(v: ViewportState, devices: DeviceProfile[] = BUILT_IN_DEVICES): ViewportState {
  const d = findDevice(v.deviceId, devices);
  return { ...v, posture: d && canFold(d) ? v.posture : 'folded' };
}

export function dedupeMatrix(list: ViewportState[], devices: DeviceProfile[] = BUILT_IN_DEVICES): ViewportState[] {
  const seen = new Set<string>();
  const out: ViewportState[] = [];
  for (const v of list.map((x) => normalizeEntry(x, devices))) {
    const k = viewportKey(v);
    if (seen.has(k) || !findDevice(v.deviceId, devices)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** "Surface Duo · expanded" style label (posture only for foldables). */
export function viewportLabel(ctx: Pick<ViewportContext, 'deviceName' | 'posture' | 'orientation' | 'deviceId'>, devices: DeviceProfile[] = BUILT_IN_DEVICES): string {
  const d = findDevice(ctx.deviceId, devices);
  const posture = d?.expanded ? ` · ${ctx.posture}` : '';
  return `${ctx.deviceName}${posture}${ctx.orientation === 'landscape' ? ' · landscape' : ''}`;
}
