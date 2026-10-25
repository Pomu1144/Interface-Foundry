import { create } from 'zustand';
import type { NodeId, Rect } from '@shared/types';

/**
 * High-frequency geometry (selection/hover rects, scroll) kept out of the main
 * store so pointer movement never re-renders the whole studio.
 */
type OverlayState = {
  rects: Record<string, Record<NodeId, Rect | null>>;
  hover: { instanceId: string; rect: Rect; label: string; nodeId: NodeId } | null;
  /** Mirrored selection in other instances (compare/wall), resolved by selector. */
  mirrors: Record<string, NodeId | null>;
  setRects: (instanceId: string, rects: Record<NodeId, Rect | null>) => void;
  setHover: (h: OverlayState['hover']) => void;
  setMirror: (instanceId: string, id: NodeId | null) => void;
  clear: (instanceId: string) => void;
};

export const useOverlay = create<OverlayState>()((set) => ({
  rects: {},
  hover: null,
  mirrors: {},
  setRects: (instanceId, rects) => set((s) => ({ rects: { ...s.rects, [instanceId]: { ...s.rects[instanceId], ...rects } } })),
  setHover: (hover) => set({ hover }),
  setMirror: (instanceId, id) => set((s) => ({ mirrors: { ...s.mirrors, [instanceId]: id } })),
  clear: (instanceId) =>
    set((s) => {
      const rects = { ...s.rects };
      delete rects[instanceId];
      return { rects, hover: s.hover?.instanceId === instanceId ? null : s.hover };
    }),
}));

/** Last heartbeat per instance (not reactive). */
export const heartbeats = new Map<string, number>();
