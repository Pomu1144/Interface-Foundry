/**
 * Data + view settings for the 3D view hierarchy (module-local store).
 *
 * Boxes come from the agent's `layout.hierarchy3d` (getBoundingClientRect in
 * document coordinates, depth = DOM depth); the base texture is the agent's
 * `capture.raster` DOM rasterisation (approximate).
 */
import { useEffect } from "react";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { Hierarchy3DNode } from "@shared/protocol";
import { bus } from "@/lib/events";
import { studio, useStudio } from "@/store";
import { previews } from "@/modules/preview-runtime/registry";
import { boundsOf, clamp } from "./math";
import { DEFAULT_SPACING } from "./engine";

export const MAX_NODES = 1500;

export type Shot = { url: string; docW: number; docH: number; sig: string };

export type ViewSettings = {
  spacing: number;
  exploded: boolean;
  labels: boolean;
  wireframe: boolean;
  isolate: boolean;
  showShot: boolean;
  /** Inclusive depth range; null = everything. */
  range: [number, number] | null;
  hidden: number[];
  solo: number[];
};

export type H3DState = ViewSettings & {
  status: "idle" | "waiting" | "loading" | "ready" | "error";
  refreshing: boolean;
  error: string | null;
  nodes: Hierarchy3DNode[];
  /** Preview instance the node ids belong to. */
  sourceId: string | null;
  sig: string;
  route: string;
  capturedAt: number;
  shot: Shot | null;
  shotStatus: "idle" | "loading" | "ready" | "error";
  shotError: string | null;
};

const VIEW_KEY = "ifdy.hierarchy3d.view";
const PERSISTED: (keyof ViewSettings)[] = [
  "spacing",
  "labels",
  "wireframe",
  "showShot",
];

function loadView(): Partial<ViewSettings> {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as Partial<ViewSettings>;
    const out: Partial<ViewSettings> = {};
    if (typeof v.spacing === "number") out.spacing = clamp(v.spacing, 4, 120);
    if (typeof v.labels === "boolean") out.labels = v.labels;
    if (typeof v.wireframe === "boolean") out.wireframe = v.wireframe;
    if (typeof v.showShot === "boolean") out.showShot = v.showShot;
    return out;
  } catch {
    return {};
  }
}

const initialState = (): H3DState => ({
  spacing: DEFAULT_SPACING,
  exploded: true,
  labels: true,
  wireframe: false,
  isolate: false,
  showShot: true,
  range: null,
  hidden: [],
  solo: [],
  ...loadView(),
  status: "idle",
  refreshing: false,
  error: null,
  nodes: [],
  sourceId: null,
  sig: "",
  route: "",
  capturedAt: 0,
  shot: null,
  shotStatus: "idle",
  shotError: null,
});

export const useH3D = create<H3DState>()(
  subscribeWithSelector(() => initialState()),
);

const set = (patch: Partial<H3DState>) => useH3D.setState(patch);
const get = () => useH3D.getState();

useH3D.subscribe(
  (s) => PERSISTED.map((k) => s[k]).join("|"),
  () => {
    try {
      const s = get();
      localStorage.setItem(
        VIEW_KEY,
        JSON.stringify(Object.fromEntries(PERSISTED.map((k) => [k, s[k]]))),
      );
    } catch {
      /* storage unavailable */
    }
  },
);

export function setView(patch: Partial<ViewSettings>) {
  set(patch);
}

export function resetFilters() {
  set({ range: null, hidden: [], solo: [], isolate: false });
}

/**
 * Cheap layout signature: decides whether the texture must be re-captured
 * (`withIds` also detects a reload that produced the same layout).
 */
export function layoutSignature(
  nodes: readonly Hierarchy3DNode[],
  withIds = false,
): string {
  let h = 0;
  for (const n of nodes) {
    const r = n.rect;
    h =
      (h * 31 +
        Math.round(r.x) * 7 +
        Math.round(r.y) * 13 +
        Math.round(r.width) * 17 +
        Math.round(r.height) * 19 +
        n.depth +
        (withIds ? n.id * 23 : 0)) |
      0;
  }
  return `${nodes.length}:${h >>> 0}`;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.slice(5, comma);
  const mime = meta.split(";")[0] || "image/png";
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

let seq = 0;
let shotBusy = false;
let shotAgain = false;

/**
 * Re-read the element boxes from the primary preview. The texture is
 * re-captured when asked (`force`) or when the layout signature changed.
 */
export async function refresh(opts: { forceShot?: boolean } = {}) {
  const my = ++seq;
  const conn = previews.primary();
  if (!conn?.ready) {
    set({
      status: get().nodes.length ? get().status : "waiting",
      refreshing: false,
    });
    return;
  }
  set({
    refreshing: true,
    error: null,
    status: get().nodes.length ? get().status : "loading",
  });
  try {
    const nodes = await conn.call(
      "layout.hierarchy3d",
      { maxNodes: MAX_NODES },
      15_000,
    );
    if (my !== seq) return;
    const sig = layoutSignature(nodes);
    const same =
      get().sourceId === conn.id &&
      layoutSignature(get().nodes, true) === layoutSignature(nodes, true);
    set({
      nodes: same ? get().nodes : nodes,
      sig,
      sourceId: conn.id,
      status: "ready",
      refreshing: false,
      capturedAt: Date.now(),
      route: studio().currentRoute,
    });
    const st = get();
    if (st.showShot && (opts.forceShot || !st.shot || st.shot.sig !== sig))
      void refreshShot();
  } catch (e) {
    if (my !== seq) return;
    set({
      status: get().nodes.length ? "ready" : "error",
      error: message(e),
      refreshing: false,
    });
  }
}

/** Capture the full-page DOM raster used as the base plane's texture. */
export async function refreshShot() {
  if (shotBusy) {
    shotAgain = true;
    return;
  }
  const conn = previews.primary();
  const st = get();
  if (!conn?.ready || !st.nodes.length) return;
  shotBusy = true;
  set({ shotStatus: "loading", shotError: null });
  const sig = st.sig;
  try {
    const b = boundsOf(st.nodes);
    const w = Math.max(1, b.x1);
    const h = Math.max(1, b.y1);
    const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
    const scale = clamp(
      Math.min(Math.max(1.5, dpr), 2400 / w, 9000 / h),
      0.25,
      2,
    );
    const res = await conn.call(
      "capture.raster",
      { fullPage: true, scale },
      45_000,
    );
    const url = URL.createObjectURL(dataUrlToBlob(res.dataUrl));
    const prev = get().shot;
    set({
      shot: { url, docW: res.width / scale, docH: res.height / scale, sig },
      shotStatus: "ready",
    });
    if (prev) setTimeout(() => URL.revokeObjectURL(prev.url), 2000);
  } catch (e) {
    set({ shotStatus: "error", shotError: message(e) });
  } finally {
    shotBusy = false;
    if (shotAgain) {
      shotAgain = false;
      void refreshShot();
    }
  }
}

const primaryInstance = () =>
  Object.values(studio().instances).find((i) => i.role === "primary");

/**
 * Keep the data fresh while the document is open: on mount, when the primary
 * preview (re)connects, and when the route, viewport, edits or DOM change.
 */
export function useAutoRefresh() {
  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let force = false;
    const later = (ms: number, forceShot = false) => {
      force ||= forceShot;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const f = force;
        force = false;
        void refresh({ forceShot: f });
      }, ms);
    };
    const viewportKey = () => {
      const v = primaryInstance()?.viewport;
      return v ? `${v.width}x${v.height}@${v.dpr}` : "";
    };
    const offs = [
      bus.on("preview-hello", ({ instanceId }) => {
        if (
          studio().instances[instanceId]?.role === "primary" ||
          previews.primary()?.id === instanceId
        )
          later(350, true);
      }),
      useStudio.subscribe(
        (s) => s.currentRoute,
        () => later(450, true),
      ),
      useStudio.subscribe(
        (s) =>
          `${s.viewport.deviceId}|${s.viewport.posture}|${s.viewport.orientation}|${s.responsiveSize.width}x${s.responsiveSize.height}`,
        () => later(600, true),
      ),
      useStudio.subscribe(
        () => viewportKey(),
        () => later(450, true),
      ),
      useStudio.subscribe(
        (s) => `${s.fontScale}|${s.colorScheme}`,
        () => later(600, true),
      ),
      useStudio.subscribe(
        (s) => s.changes,
        () => later(900),
      ),
      useStudio.subscribe(
        (s) => s.domVersion,
        () => later(1200),
      ),
      useH3D.subscribe(
        (s) => s.showShot,
        (on) => {
          const st = get();
          if (on && (!st.shot || st.shot.sig !== st.sig)) void refreshShot();
        },
      ),
    ];
    return () => {
      clearTimeout(timer);
      offs.forEach((off) => off());
    };
  }, []);
}
