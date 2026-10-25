import type { DeviceProfile, FoldGeometry, ViewportContext, ViewportState } from '@shared/types';
import { studio } from '@/store';
import { RESPONSIVE_ID, responsiveDevice } from '@/modules/device-simulator/devices';
import { canFold, foldInViewport, resolveViewport, viewportContext } from '@/modules/device-simulator/viewport';

/** A viewport the audit/sweep/capture can run at. */
export type ResolvedProfile = { state: ViewportState; device: DeviceProfile; ctx: ViewportContext; fold: FoldGeometry | null };

export function findDevice(id: string): DeviceProfile | undefined {
  const s = studio();
  if (id === RESPONSIVE_ID) return responsiveDevice(s.responsiveSize);
  return s.allDevices().find((d) => d.id === id);
}

export function resolveProfile(state: ViewportState): ResolvedProfile | null {
  const device = findDevice(state.deviceId);
  if (!device) return null;
  const posture = canFold(device) ? state.posture : 'folded';
  const r = resolveViewport(device, posture, state.orientation);
  return { state: { ...state, posture }, device, ctx: viewportContext(device, posture, state.orientation), fold: foldInViewport(r.geometry) };
}

export const stateKey = (s: ViewportState) => `${s.deviceId}|${s.posture}|${s.orientation}`;

export function parseStateKey(key: string): ViewportState | null {
  const [deviceId, posture, orientation] = key.split('|');
  if (!deviceId || (posture !== 'folded' && posture !== 'expanded') || (orientation !== 'portrait' && orientation !== 'landscape')) return null;
  return { deviceId, posture, orientation };
}

/* ------------------------------------------------------------------ */
/* Profile selection (persisted per browser)                           */
/* ------------------------------------------------------------------ */

const EXTRA_KEY = 'ifdy.audit.extraProfiles';
export const DEFAULT_EXTRAS = ['desktop-1440|folded|portrait'];

/** Reference viewports offered in the audit's viewport menu. */
export const REFERENCE_PROFILES: string[] = [
  'compact-360|folded|portrait',
  'galaxy-z-fold-5|folded|portrait',
  'galaxy-z-fold-5|expanded|portrait',
  'iphone-16-pro|folded|portrait',
  'ipad-mini|folded|portrait',
  'laptop-13|folded|portrait',
  'desktop-1440|folded|portrait',
];

export function loadExtraProfiles(): string[] {
  try {
    const raw = localStorage.getItem(EXTRA_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : DEFAULT_EXTRAS;
    return Array.isArray(list) ? list.filter((k) => parseStateKey(k)) : DEFAULT_EXTRAS;
  } catch {
    return DEFAULT_EXTRAS;
  }
}

export function saveExtraProfiles(keys: string[]) {
  try {
    localStorage.setItem(EXTRA_KEY, JSON.stringify(keys));
  } catch {
    /* storage unavailable */
  }
}

/** The canvas device in every posture (foldables: folded AND expanded), then extras. */
export function defaultProfiles(extras = loadExtraProfiles()): ViewportState[] {
  const s = studio();
  const d = s.device();
  const own: ViewportState[] = canFold(d)
    ? [
        { deviceId: d.id, posture: 'folded', orientation: s.viewport.orientation },
        { deviceId: d.id, posture: 'expanded', orientation: s.viewport.orientation },
      ]
    : [{ deviceId: d.id, posture: 'folded', orientation: s.viewport.orientation }];
  const seen = new Set(own.map(stateKey));
  const out = [...own];
  for (const k of extras) {
    const st = parseStateKey(k);
    if (st && !seen.has(k) && findDevice(st.deviceId)) {
      seen.add(k);
      out.push(st);
    }
  }
  return out;
}

/** Widths for the responsive sweep: a regular grid plus every device-profile width in range. */
export function sweepWidths(min = 320, max = 1600, step = 40): { widths: number[]; devices: { width: number; name: string }[] } {
  const devices: { width: number; name: string }[] = [];
  for (const d of studio().allDevices()) {
    for (const posture of d.expanded ? (['folded', 'expanded'] as const) : (['folded'] as const)) {
      const w = resolveViewport(d, posture, 'portrait').geometry.viewport.width;
      if (w >= min && w <= max) devices.push({ width: w, name: `${d.name}${posture === 'expanded' ? ' (expanded)' : ''}` });
    }
  }
  const set = new Set<number>();
  for (let w = min; w <= max; w += step) set.add(w);
  for (const d of devices) set.add(d.width);
  return { widths: [...set].sort((a, b) => a - b), devices: devices.sort((a, b) => a.width - b.width) };
}
