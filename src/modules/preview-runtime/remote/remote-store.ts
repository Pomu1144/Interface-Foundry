import { create } from 'zustand';

/** Per-instance facts about controlled-browser previews, for labels and badges. */
export type RemoteInfo = {
  phase: 'connecting' | 'opening' | 'loading' | 'streaming' | 'error' | 'unavailable';
  /** Fold emulation outcome reported by the companion for the current emulation. */
  displayFeature: 'applied' | 'unsupported' | 'none';
  detail?: string;
  touchNeedsReload?: boolean;
  frames: number;
  httpStatus?: number | null;
};

type RemoteStore = {
  info: Record<string, RemoteInfo>;
  patch: (id: string, p: Partial<RemoteInfo>) => void;
  remove: (id: string) => void;
};

export const useRemoteInfo = create<RemoteStore>()((set) => ({
  info: {},
  patch: (id, p) =>
    set((s) => {
      const prev: RemoteInfo = s.info[id] ?? { phase: 'connecting', displayFeature: 'none', frames: 0 };
      const next = { ...prev, ...p };
      if (Object.keys(p).every((k) => prev[k as keyof RemoteInfo] === next[k as keyof RemoteInfo]) && s.info[id]) return s;
      return { info: { ...s.info, [id]: next } };
    }),
  remove: (id) =>
    set((s) => {
      if (!s.info[id]) return s;
      const info = { ...s.info };
      delete info[id];
      return { info };
    }),
}));
