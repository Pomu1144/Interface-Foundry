import { create } from 'zustand';
import type { Orientation } from '@shared/types';
import { DEFAULT_SET, type TileKey } from './presets';

export type Density = 'fit' | 's' | 'm' | 'l';

export type WallSettings = {
  keys: TileKey[];
  density: Density;
  orientation: Orientation;
  mirrorScroll: boolean;
  mirrorInput: boolean;
  issues: boolean;
};

const STORAGE_KEY = 'ifdy.wall.v1';

function load(): WallSettings {
  const base: WallSettings = { keys: DEFAULT_SET, density: 'fit', orientation: 'portrait', mirrorScroll: true, mirrorInput: false, issues: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const v = JSON.parse(raw) as Partial<WallSettings>;
    return {
      keys: Array.isArray(v.keys) ? v.keys.filter((k): k is string => typeof k === 'string') : base.keys,
      density: v.density && ['fit', 's', 'm', 'l'].includes(v.density) ? v.density : base.density,
      orientation: v.orientation === 'landscape' ? 'landscape' : 'portrait',
      mirrorScroll: v.mirrorScroll ?? base.mirrorScroll,
      mirrorInput: v.mirrorInput ?? base.mirrorInput,
      issues: v.issues ?? base.issues,
    };
  } catch {
    return base;
  }
}

type WallStore = WallSettings & {
  set: (p: Partial<WallSettings>) => void;
  toggleKey: (k: TileKey) => void;
  /** Tile the user is driving (mirroring source). */
  leader: string | null;
  setLeader: (id: string | null) => void;
};

/** Device-wall preferences, remembered per browser (not part of the project). */
export const useWall = create<WallStore>()((set, get) => ({
  ...load(),
  leader: null,
  set: (p) => {
    set(p);
    const { keys, density, orientation, mirrorScroll, mirrorInput, issues } = get();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ keys, density, orientation, mirrorScroll, mirrorInput, issues }));
    } catch {
      /* storage unavailable */
    }
  },
  toggleKey: (k) => {
    const keys = get().keys;
    get().set({ keys: keys.includes(k) ? keys.filter((x) => x !== k) : [...keys, k] });
  },
  setLeader: (leader) => {
    if (get().leader !== leader) set({ leader });
  },
}));
