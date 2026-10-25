/**
 * Pure math for the 3D view hierarchy: tree reconstruction from the agent's
 * pre-order node list, depth filtering, camera composition / projection and
 * fit computation. No DOM access — everything here is unit tested.
 *
 * Coordinate system (matches CSS): x right, y down, z toward the viewer.
 * A node at DOM depth `d` sits on the plane z = d × spacing, so deeper nodes
 * float above their ancestors.
 */
import type { Hierarchy3DNode } from '@shared/protocol';

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

export type Camera = {
  /** Turntable rotation around the page's vertical axis (degrees). */
  yaw: number;
  /** Tilt; positive looks down from above (degrees). */
  pitch: number;
  /** Screen magnification (applied after projection). */
  zoom: number;
  /** Screen-space offset from the stage centre (px). */
  panX: number;
  panY: number;
  /** Orbit pivot in document px (x, y) and fractional depth level. */
  tx: number;
  ty: number;
  td: number;
};

export type Angles = { yaw: number; pitch: number };
export type Vec3 = [number, number, number];
/** Column-major 4×4 matrix (the order CSS `matrix3d()` expects). */
export type Mat4 = number[];

export const MIN_ZOOM = 0.04;
export const MAX_ZOOM = 12;
export const MAX_PITCH = 89;

export const PRESETS = {
  front: { yaw: 0, pitch: 0 },
  left: { yaw: 36, pitch: 12 },
  right: { yaw: -36, pitch: 12 },
  top: { yaw: -8, pitch: 64 },
} satisfies Record<string, Angles>;
export type PresetName = keyof typeof PRESETS;

const RAD = Math.PI / 180;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const clampZoom = (z: number) => clamp(z, MIN_ZOOM, MAX_ZOOM);
export const clampPitch = (p: number) => clamp(p, -MAX_PITCH, MAX_PITCH);

/** Normalise an angle to (-180, 180]. */
export function wrapAngle(deg: number): number {
  let a = ((deg + 180) % 360 + 360) % 360 - 180;
  if (a === -180) a = 180;
  return a;
}

/** The equivalent of `to` closest to `from`, so tweens take the short way round. */
export function nearestAngle(from: number, to: number): number {
  return from + wrapAngle(to - from);
}

export function identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** a · b (column-major). */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function translation(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

/** CSS `rotateX(deg)`. */
export function rotationX(deg: number): Mat4 {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}

/** CSS `rotateY(deg)`. */
export function rotationY(deg: number): Mat4 {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

/** Compose transforms in CSS order: `compose(A, B, C)` ≡ `transform: A B C` (C applies first). */
export function compose(...ms: Mat4[]): Mat4 {
  return ms.reduce((acc, m) => multiply(acc, m), identity());
}

/**
 * World transform: `rotateX(pitch) rotateY(yaw) translate3d(-pivot)`.
 * Zoom and pan are applied by the (2D) wrapper after perspective, so zooming
 * is pure magnification and never changes the perspective distortion.
 */
export function worldMatrix(cam: Camera, spacing: number): Mat4 {
  return compose(rotationX(cam.pitch), rotationY(cam.yaw), translation(-cam.tx, -cam.ty, -cam.td * spacing));
}

export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const [x, y, z] = p;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
}

/** Round to 4 decimals for CSS strings (keeps style writes short and stable). */
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

export function matrixCss(m: Mat4): string {
  return `matrix3d(${m.map(r4).join(',')})`;
}

export function wrapperCss(cam: Camera): string {
  return `translate3d(${r4(cam.panX)}px,${r4(cam.panY)}px,0) scale(${r4(cam.zoom)})`;
}

/**
 * Screen position (relative to the stage centre) of a world point
 * (x, y in document px, z = depth × spacing), given a world matrix.
 * Mirrors the DOM: wrapper(translate(pan) scale(zoom)) · perspective(P) · world.
 */
export function projectWith(m: Mat4, cam: Pick<Camera, 'zoom' | 'panX' | 'panY'>, perspective: number, p: Vec3): { x: number; y: number; z: number; k: number } {
  const v = transformPoint(m, p);
  const k = perspective / Math.max(1e-6, perspective - v[2]);
  return { x: cam.panX + cam.zoom * v[0] * k, y: cam.panY + cam.zoom * v[1] * k, z: v[2], k };
}

export function project(cam: Camera, spacing: number, perspective: number, p: Vec3): { x: number; y: number; z: number; k: number } {
  return projectWith(worldMatrix(cam, spacing), cam, perspective, p);
}

/** Zoom by `factor` keeping the screen point (mx, my) — relative to the stage centre — fixed. */
export function zoomAbout(cam: Pick<Camera, 'zoom' | 'panX' | 'panY'>, factor: number, mx: number, my: number): Pick<Camera, 'zoom' | 'panX' | 'panY'> {
  const zoom = clampZoom(cam.zoom * factor);
  const k = zoom / cam.zoom;
  return { zoom, panX: mx + (cam.panX - mx) * k, panY: my + (cam.panY - my) * k };
}

/** Distance at which the perspective never inverts for this scene (camera stays outside it). */
export function perspectiveFor(b: Bounds, maxSpacing: number): number {
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const d = (b.d1 - b.d0 + 2) * maxSpacing;
  return Math.max(1400, Math.round(1.3 * Math.hypot(w, h, d)));
}

/* ------------------------------------------------------------------ */
/* Easing                                                              */
/* ------------------------------------------------------------------ */

/** Frame-rate independent exponential approach towards `target`. */
export function approach(current: number, target: number, dtMs: number, tauMs: number): number {
  if (tauMs <= 0) return target;
  return target + (current - target) * Math.exp(-dtMs / tauMs);
}

/** Exponential decay of an inertial velocity. */
export function decay(v: number, dtMs: number, tauMs: number): number {
  return v * Math.exp(-dtMs / tauMs);
}

/** Quantised border width (document px) that renders ≈1 device px at `zoom`. */
export function hairline(zoom: number): number {
  const ideal = clamp(1 / Math.max(zoom, 1e-3), 0.5, 10);
  const step = Math.round(Math.log2(ideal) * 3) / 3;
  return r4(2 ** step);
}

/* ------------------------------------------------------------------ */
/* Tree                                                                */
/* ------------------------------------------------------------------ */

export type Bounds = { x0: number; y0: number; x1: number; y1: number; d0: number; d1: number };

export type Level = { depth: number; count: number };

export type Tree = {
  /** Nearest *listed* ancestor of each node (-1 for roots). */
  parent: Int32Array;
  /** Exclusive end index of each node's subtree (pre-order ⇒ subtree = [i, end[i])). */
  end: Int32Array;
  indexById: Map<number, number>;
  levels: Level[];
  minDepth: number;
  maxDepth: number;
  bounds: Bounds;
};

/**
 * Rebuild parent/subtree relations from the agent's pre-order (DFS) list.
 * Nodes without a box are skipped by the agent while their children are still
 * walked, so the "parent" here is the nearest visible ancestor.
 */
export function buildTree(nodes: readonly Hierarchy3DNode[]): Tree {
  const n = nodes.length;
  const parent = new Int32Array(n).fill(-1);
  const end = new Int32Array(n).fill(n);
  const indexById = new Map<number, number>();
  const counts = new Map<number, number>();
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = nodes[i].depth;
    while (stack.length && nodes[stack[stack.length - 1]].depth >= d) end[stack.pop()!] = i;
    parent[i] = stack.length ? stack[stack.length - 1] : -1;
    stack.push(i);
    indexById.set(nodes[i].id, i);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const levels = [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([depth, count]) => ({ depth, count }));
  return {
    parent,
    end,
    indexById,
    levels,
    minDepth: levels.length ? levels[0].depth : 0,
    maxDepth: levels.length ? levels[levels.length - 1].depth : 0,
    bounds: boundsOf(nodes),
  };
}

/** Bounding box (document px + depth range) of the given nodes (all when `indices` is omitted). */
export function boundsOf(nodes: readonly Hierarchy3DNode[], indices?: Iterable<number>): Bounds {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let d0 = Infinity;
  let d1 = -Infinity;
  const visit = (nd: Hierarchy3DNode) => {
    x0 = Math.min(x0, nd.rect.x);
    y0 = Math.min(y0, nd.rect.y);
    x1 = Math.max(x1, nd.rect.x + nd.rect.width);
    y1 = Math.max(y1, nd.rect.y + nd.rect.height);
    d0 = Math.min(d0, nd.depth);
    d1 = Math.max(d1, nd.depth);
  };
  if (indices) for (const i of indices) visit(nodes[i]);
  else for (const nd of nodes) visit(nd);
  if (x0 === Infinity) return { x0: 0, y0: 0, x1: 0, y1: 0, d0: 0, d1: 0 };
  return { x0, y0, x1, y1, d0, d1 };
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), d0: Math.min(a.d0, b.d0), d1: Math.max(a.d1, b.d1) };
}

/** Ancestor chain of node `i` (nearest first), excluding `i`. */
export function ancestorsOf(tree: Tree, i: number): number[] {
  const out: number[] = [];
  for (let p = tree.parent[i]; p >= 0; p = tree.parent[p]) out.push(p);
  return out;
}

export function isInSubtree(tree: Tree, root: number, i: number): boolean {
  return i >= root && i < tree.end[root];
}

/* ------------------------------------------------------------------ */
/* Filtering                                                           */
/* ------------------------------------------------------------------ */

export type DepthFilter = {
  /** Inclusive depth range. */
  min: number;
  max: number;
  hidden: readonly number[];
  /** When non-empty only these levels are shown (solo overrides hide). */
  solo: readonly number[];
};

export function isLevelVisible(depth: number, f: DepthFilter): boolean {
  if (depth < f.min || depth > f.max) return false;
  if (f.solo.length) return f.solo.includes(depth);
  return !f.hidden.includes(depth);
}

/**
 * Indices of the nodes to draw, grouped by depth (ascending), honouring the
 * depth filter and an optional isolated subtree root.
 */
export function visibleByDepth(nodes: readonly Hierarchy3DNode[], tree: Tree, f: DepthFilter, isolateRoot: number | null = null): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const l of tree.levels) out.set(l.depth, []);
  const from = isolateRoot ?? 0;
  const to = isolateRoot === null ? nodes.length : tree.end[isolateRoot];
  for (let i = from; i < to; i++) {
    const d = nodes[i].depth;
    if (!isLevelVisible(d, f)) continue;
    out.get(d)!.push(i);
  }
  return out;
}

/** Flat list of visible node indices (pre-order). */
export function visibleIndices(nodes: readonly Hierarchy3DNode[], tree: Tree, f: DepthFilter, isolateRoot: number | null = null): number[] {
  const from = isolateRoot ?? 0;
  const to = isolateRoot === null ? nodes.length : tree.end[isolateRoot];
  const out: number[] = [];
  for (let i = from; i < to; i++) if (isLevelVisible(nodes[i].depth, f)) out.push(i);
  return out;
}

/** Clamp a [min, max] depth range to the levels present, keeping min ≤ max. */
export function normalizeRange(range: [number, number], minDepth: number, maxDepth: number): [number, number] {
  const lo = clamp(Math.round(Math.min(range[0], range[1])), minDepth, maxDepth);
  const hi = clamp(Math.round(Math.max(range[0], range[1])), minDepth, maxDepth);
  return [lo, hi];
}

/** 0 → 1 position of a depth along the colour gradient (accent → molten). */
export function depthT(depth: number, minDepth: number, maxDepth: number): number {
  return maxDepth > minDepth ? clamp((depth - minDepth) / (maxDepth - minDepth), 0, 1) : 0;
}

/* ------------------------------------------------------------------ */
/* Fit                                                                 */
/* ------------------------------------------------------------------ */

export type Insets = { top: number; right: number; bottom: number; left: number };
export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export function boundsCorners(b: Bounds, spacing: number): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const d of [b.d0, b.d1]) out.push([x, y, d * spacing]);
  return out;
}

/** Projected 2D extent (zoom 1, no pan) of world points for the given angles/pivot. */
export function projectedExtent(cam: Camera, spacing: number, perspective: number, points: Vec3[]): { x0: number; y0: number; x1: number; y1: number } {
  const m = worldMatrix(cam, spacing);
  const unit = { zoom: 1, panX: 0, panY: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    const q = projectWith(m, unit, perspective, p);
    x0 = Math.min(x0, q.x);
    y0 = Math.min(y0, q.y);
    x1 = Math.max(x1, q.x);
    y1 = Math.max(y1, q.y);
  }
  return { x0, y0, x1, y1 };
}

/**
 * Zoom + pan that frame `points` inside a `view` (stage size) minus `insets`
 * (floating chrome) and `padding`. Exact for perspective because zoom/pan are
 * applied after projection.
 */
export function fitPoints(
  cam: Camera,
  spacing: number,
  perspective: number,
  points: Vec3[],
  view: { width: number; height: number },
  insets: Insets = NO_INSETS,
  padding = 32,
  maxZoom = MAX_ZOOM,
): Pick<Camera, 'zoom' | 'panX' | 'panY'> {
  const e = projectedExtent(cam, spacing, perspective, points);
  const availW = Math.max(40, view.width - insets.left - insets.right - padding * 2);
  const availH = Math.max(40, view.height - insets.top - insets.bottom - padding * 2);
  const w = Math.max(1, e.x1 - e.x0);
  const h = Math.max(1, e.y1 - e.y0);
  const zoom = clamp(Math.min(availW / w, availH / h), MIN_ZOOM, maxZoom);
  return {
    zoom,
    panX: (insets.left - insets.right) / 2 - zoom * (e.x0 + e.x1) / 2,
    panY: (insets.top - insets.bottom) / 2 - zoom * (e.y0 + e.y1) / 2,
  };
}

/** Camera that orbits around the centre of `b` and frames it. */
export function fitBounds(
  angles: Angles,
  b: Bounds,
  spacing: number,
  perspective: number,
  view: { width: number; height: number },
  insets: Insets = NO_INSETS,
  padding = 32,
  maxZoom = MAX_ZOOM,
): Camera {
  const base: Camera = { yaw: angles.yaw, pitch: angles.pitch, zoom: 1, panX: 0, panY: 0, tx: (b.x0 + b.x1) / 2, ty: (b.y0 + b.y1) / 2, td: (b.d0 + b.d1) / 2 };
  return { ...base, ...fitPoints(base, spacing, perspective, boundsCorners(b, spacing), view, insets, padding, maxZoom) };
}

/* ------------------------------------------------------------------ */
/* Appearance helpers                                                  */
/* ------------------------------------------------------------------ */

/** Faint fill tinted by the node's own background colour (user content). */
export function fillFor(bg: string | null, amount = 16): string | undefined {
  if (!bg || bg === 'image') return undefined;
  return `color-mix(in srgb, ${bg} ${amount}%, transparent)`;
}

/** Font size (document px) for a text preview inside a box of height `h`. */
export function textSizeFor(h: number): number {
  return Math.round(clamp(h * 0.5, 5, 12) * 10) / 10;
}
