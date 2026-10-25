import { describe, expect, it } from 'vitest';
import type { Hierarchy3DNode } from '@shared/protocol';
import {
  ancestorsOf,
  approach,
  boundsCorners,
  boundsOf,
  buildTree,
  compose,
  depthT,
  fitBounds,
  fitFrame,
  frameCorners,
  frameOf,
  fitPoints,
  hairline,
  identity,
  isInSubtree,
  isLevelVisible,
  labelPriority,
  matrixCss,
  multiply,
  nearestAngle,
  normalizeRange,
  perspectiveFor,
  project,
  projectWith,
  rotationX,
  rotationY,
  transformPoint,
  translation,
  unionBounds,
  visibleByDepth,
  visibleIndices,
  worldMatrix,
  wrapAngle,
  zoomAbout,
  type Camera,
  type DepthFilter,
  type Vec3,
} from '@/modules/view-hierarchy-3d/math';

const node = (id: number, depth: number, x: number, y: number, width: number, height: number, label = 'div'): Hierarchy3DNode => ({
  id,
  depth,
  rect: { x, y, width, height },
  label,
  bg: null,
  border: null,
  isImage: false,
});

/**
 * body(0)
 *   header(1)
 *     a(2)
 *       (zero-size span skipped by the agent)
 *         img(4)      ← nearest listed ancestor is a(2)
 *   main(1)
 *     section(2)
 *       button(3)
 */
const NODES: Hierarchy3DNode[] = [
  node(10, 0, 0, 0, 400, 1000, 'body'),
  node(11, 1, 0, 0, 400, 60, 'header.top'),
  node(12, 2, 10, 10, 100, 40, 'a.brand'),
  node(13, 4, 12, 12, 36, 36, 'img'),
  node(14, 1, 0, 60, 400, 900, 'main#content'),
  node(15, 2, 20, 80, 360, 300, 'section.card'),
  node(16, 3, 40, 300, 120, 40, 'button.primary'),
];

const ALL: DepthFilter = { min: 0, max: 99, hidden: [], solo: [] };
const cam = (patch: Partial<Camera> = {}): Camera => ({ yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0, tx: 0, ty: 0, td: 0, ...patch });
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('hierarchy tree', () => {
  const tree = buildTree(NODES);

  it('rebuilds parents from the pre-order list, skipping missing depths', () => {
    expect([...tree.parent]).toEqual([-1, 0, 1, 2, 0, 4, 5]);
    expect(ancestorsOf(tree, 3)).toEqual([2, 1, 0]);
    expect(ancestorsOf(tree, 0)).toEqual([]);
  });

  it('computes contiguous subtree ranges', () => {
    expect([...tree.end]).toEqual([7, 4, 4, 4, 7, 7, 7]);
    expect(isInSubtree(tree, 1, 3)).toBe(true);
    expect(isInSubtree(tree, 1, 4)).toBe(false);
    expect(isInSubtree(tree, 4, 6)).toBe(true);
  });

  it('counts levels and indexes ids', () => {
    expect(tree.levels).toEqual([
      { depth: 0, count: 1 },
      { depth: 1, count: 2 },
      { depth: 2, count: 2 },
      { depth: 3, count: 1 },
      { depth: 4, count: 1 },
    ]);
    expect(tree.minDepth).toBe(0);
    expect(tree.maxDepth).toBe(4);
    expect(tree.indexById.get(16)).toBe(6);
  });

  it('handles an empty list', () => {
    const t = buildTree([]);
    expect(t.levels).toEqual([]);
    expect(t.bounds).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0, d0: 0, d1: 0 });
  });
});

describe('depth-range filtering', () => {
  const tree = buildTree(NODES);

  it('applies the inclusive range', () => {
    const f: DepthFilter = { min: 1, max: 2, hidden: [], solo: [] };
    expect([0, 1, 2, 3].map((d) => isLevelVisible(d, f))).toEqual([false, true, true, false]);
    expect(visibleIndices(NODES, tree, f)).toEqual([1, 2, 4, 5]);
  });

  it('hides levels and lets solo override hide (but not the range)', () => {
    expect(isLevelVisible(2, { ...ALL, hidden: [2] })).toBe(false);
    expect(isLevelVisible(2, { ...ALL, hidden: [2], solo: [2] })).toBe(true);
    expect(isLevelVisible(1, { ...ALL, solo: [2] })).toBe(false);
    expect(isLevelVisible(2, { min: 3, max: 4, hidden: [], solo: [2] })).toBe(false);
  });

  it('groups by depth and isolates a subtree', () => {
    const all = visibleByDepth(NODES, tree, ALL);
    expect([...all.entries()]).toEqual([
      [0, [0]],
      [1, [1, 4]],
      [2, [2, 5]],
      [3, [6]],
      [4, [3]],
    ]);
    const iso = visibleByDepth(NODES, tree, ALL, 4);
    expect(iso.get(1)).toEqual([4]);
    expect(iso.get(2)).toEqual([5]);
    expect(iso.get(4)).toEqual([]);
    expect(visibleIndices(NODES, tree, { ...ALL, hidden: [3] }, 4)).toEqual([4, 5]);
  });

  it('normalises ranges', () => {
    expect(normalizeRange([5, 1], 0, 4)).toEqual([1, 4]);
    expect(normalizeRange([-3, 2.6], 0, 4)).toEqual([0, 3]);
  });

  it('maps depth onto the colour gradient', () => {
    expect(depthT(0, 0, 4)).toBe(0);
    expect(depthT(2, 0, 4)).toBe(0.5);
    expect(depthT(9, 0, 4)).toBe(1);
    expect(depthT(3, 3, 3)).toBe(0);
  });
});

describe('camera transform composition', () => {
  it('matches CSS rotateX / rotateY conventions (y down, z toward viewer)', () => {
    // rotateY(90deg): +x goes away from the viewer, +z comes to the right.
    const ry = transformPoint(rotationY(90), [1, 0, 0]);
    close(ry[0], 0);
    close(ry[2], -1);
    const rz = transformPoint(rotationY(90), [0, 0, 1]);
    close(rz[0], 1);
    // rotateX(90deg): +z (toward viewer) goes up the screen (−y).
    const rx = transformPoint(rotationX(90), [0, 0, 1]);
    close(rx[1], -1);
  });

  it('composes in CSS order (rightmost applies first)', () => {
    const m = compose(rotationY(90), translation(10, 0, 0));
    const p = transformPoint(m, [0, 0, 0]);
    // translate first → (10,0,0), then rotate → (0,0,-10)
    close(p[0], 0);
    close(p[2], -10);
    expect(compose()).toEqual(identity());
    const a = rotationX(20);
    const b = rotationY(-35);
    const c = translation(3, -4, 5);
    const left = multiply(multiply(a, b), c);
    const right = multiply(a, multiply(b, c));
    left.forEach((v, i) => close(v, right[i], 1e-9));
  });

  it('puts the pivot at the origin and spaces depth levels along z', () => {
    const c = cam({ yaw: 33, pitch: -12, tx: 50, ty: 70, td: 3 });
    const m = worldMatrix(c, 40);
    const o = transformPoint(m, [50, 70, 120]);
    o.forEach((v) => close(v, 0, 1e-9));
    expect(matrixCss(worldMatrix(cam(), 0))).toBe('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)');
  });

  it('projects with zoom/pan applied after perspective', () => {
    const c = cam({ zoom: 2, panX: 5, panY: -7 });
    const flat = project(c, 30, 1000, [10, 20, 0]);
    close(flat.x, 5 + 2 * 10);
    close(flat.y, -7 + 2 * 20);
    // Nearer planes (z toward the viewer) are magnified by P / (P - z).
    const near = project(cam(), 30, 1000, [10, 0, 100]);
    close(near.x, 10 * (1000 / 900));
    expect(near.k).toBeGreaterThan(1);
    // projectWith with a precomputed matrix is identical.
    const m = worldMatrix(c, 30);
    expect(projectWith(m, c, 1000, [10, 20, 0])).toEqual(flat);
  });

  it('zooms about a fixed screen point', () => {
    const c = cam({ zoom: 1.5, panX: 40, panY: -10 });
    const p: Vec3 = [30, 60, 0];
    const before = project(c, 0, 2000, p);
    const z = zoomAbout(c, 1.8, before.x, before.y);
    const after = project({ ...c, ...z }, 0, 2000, p);
    close(after.x, before.x, 1e-9);
    close(after.y, before.y, 1e-9);
    close(z.zoom, 2.7);
    expect(zoomAbout(c, 1e6, 0, 0).zoom).toBe(12);
  });

  it('wraps angles and tweens the short way round', () => {
    expect(wrapAngle(190)).toBe(-170);
    expect(wrapAngle(-180)).toBe(180);
    expect(wrapAngle(540)).toBe(180);
    expect(nearestAngle(170, -170)).toBe(190);
    expect(nearestAngle(-10, 350)).toBe(-10);
  });

  it('eases frame-rate independently', () => {
    const once = approach(0, 100, 32, 120);
    const twice = approach(approach(0, 100, 16, 120), 100, 16, 120);
    close(once, twice, 1e-9);
    expect(approach(0, 100, 10_000, 120)).toBeCloseTo(100, 6);
    expect(approach(5, 100, 16, 0)).toBe(100);
  });

  it('keeps borders about one device pixel', () => {
    expect(hairline(1)).toBe(1);
    expect(hairline(0.25)).toBeCloseTo(4, 3);
    expect(hairline(0.3)).toBeGreaterThan(2.5);
    expect(hairline(0.3)).toBeLessThan(4.1);
    expect(hairline(100)).toBe(0.5);
  });
});

describe('bounding box & fit', () => {
  it('computes bounds and unions', () => {
    const b = boundsOf(NODES);
    expect(b).toEqual({ x0: 0, y0: 0, x1: 400, y1: 1000, d0: 0, d1: 4 });
    expect(boundsOf(NODES, [2, 3])).toEqual({ x0: 10, y0: 10, x1: 110, y1: 50, d0: 2, d1: 4 });
    expect(unionBounds(b, { x0: -5, y0: 0, x1: 10, y1: 1200, d0: -1, d1: -1 })).toEqual({ x0: -5, y0: 0, x1: 400, y1: 1200, d0: -1, d1: 4 });
    expect(boundsCorners(b, 10)).toHaveLength(8);
  });

  it('fits the front view exactly (height-limited)', () => {
    const b = { x0: 0, y0: 0, x1: 100, y1: 200, d0: 0, d1: 0 };
    const c = fitBounds({ yaw: 0, pitch: 0 }, b, 0, 2000, { width: 400, height: 400 }, undefined, 0);
    close(c.zoom, 2);
    close(c.panX, 0);
    close(c.panY, 0);
    expect([c.tx, c.ty, c.td]).toEqual([50, 100, 0]);
  });

  it('offsets the framing for asymmetric chrome insets', () => {
    const b = { x0: 0, y0: 0, x1: 100, y1: 100, d0: 0, d1: 0 };
    const c = fitBounds({ yaw: 0, pitch: 0 }, b, 0, 2000, { width: 300, height: 300 }, { top: 0, right: 0, bottom: 100, left: 0 }, 0);
    close(c.zoom, 2);
    close(c.panY, -50);
  });

  it('keeps every projected corner inside the available area at any angle', () => {
    const b = { x0: -20, y0: -60, x1: 540, y1: 1400, d0: -1, d1: 12 };
    const view = { width: 900, height: 700 };
    const insets = { top: 40, right: 8, bottom: 58, left: 8 };
    const spacing = 36;
    const P = perspectiveFor(b, 120);
    for (const yaw of [-170, -60, -36, 0, 20, 89]) {
      for (const pitch of [-80, -20, 0, 12, 64]) {
        const c = fitBounds({ yaw, pitch }, b, spacing, P, view, insets, 24);
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const p of boundsCorners(b, spacing)) {
          const q = project(c, spacing, P, p);
          minX = Math.min(minX, q.x + view.width / 2);
          maxX = Math.max(maxX, q.x + view.width / 2);
          minY = Math.min(minY, q.y + view.height / 2);
          maxY = Math.max(maxY, q.y + view.height / 2);
        }
        expect(minX).toBeGreaterThanOrEqual(insets.left + 24 - 1e-6);
        expect(maxX).toBeLessThanOrEqual(view.width - insets.right - 24 + 1e-6);
        expect(minY).toBeGreaterThanOrEqual(insets.top + 24 - 1e-6);
        expect(maxY).toBeLessThanOrEqual(view.height - insets.bottom - 24 + 1e-6);
        // …and touches at least one side (tight fit).
        const slackX = Math.min(minX - insets.left - 24, view.width - insets.right - 24 - maxX);
        const slackY = Math.min(minY - insets.top - 24, view.height - insets.bottom - 24 - maxY);
        expect(Math.min(Math.abs(slackX), Math.abs(slackY))).toBeLessThan(1e-6);
      }
    }
  });

  it('frames a single plane around its own pivot with a zoom cap', () => {
    const n = NODES[6];
    const base = cam({ yaw: -30, pitch: 10, tx: n.rect.x + n.rect.width / 2, ty: n.rect.y + n.rect.height / 2, td: n.depth });
    const z = n.depth * 36;
    const { x, y, width, height } = n.rect;
    const pts: Vec3[] = [
      [x, y, z],
      [x + width, y, z],
      [x, y + height, z],
      [x + width, y + height, z],
    ];
    const v = fitPoints(base, 36, 2000, pts, { width: 800, height: 600 }, undefined, 72, 6);
    expect(v.zoom).toBeLessThanOrEqual(6);
    expect(v.zoom).toBeGreaterThan(1);
    // Centred: the projected extent is symmetric around the stage centre.
    const qs = pts.map((p) => project({ ...base, ...v }, 36, 2000, p));
    close(Math.min(...qs.map((q) => q.x)) + Math.max(...qs.map((q) => q.x)), 0, 1e-6);
    close(Math.min(...qs.map((q) => q.y)) + Math.max(...qs.map((q) => q.y)), 0, 1e-6);
  });

  it('chooses a perspective distance that keeps the camera outside the scene', () => {
    const b = { x0: 0, y0: 0, x1: 540, y1: 1400, d0: -1, d1: 12 };
    const P = perspectiveFor(b, 120);
    expect(P).toBeGreaterThan(Math.hypot(540, 1400, 14 * 120));
  });
});

describe('frame (per-level hull) fit', () => {
  it('builds one rectangle per depth level plus extras', () => {
    const f = frameOf(NODES, undefined, [{ d: -1, x0: 0, y0: 0, x1: 420, y1: 1000 }]);
    expect(f.levels.map((l) => l.d)).toEqual([-1, 0, 1, 2, 3, 4]);
    expect(f.levels.find((l) => l.d === 2)).toEqual({ d: 2, x0: 10, y0: 10, x1: 380, y1: 380 });
    expect(f.bounds).toEqual({ x0: 0, y0: 0, x1: 420, y1: 1000, d0: -1, d1: 4 });
    expect(frameCorners(f, 10)).toHaveLength(24);
    expect(frameOf(NODES, [6]).levels).toEqual([{ d: 3, x0: 40, y0: 300, x1: 160, y1: 340 }]);
  });

  it('frames tighter than the 3D bounding box and still contains every level', () => {
    const f = frameOf(NODES);
    const view = { width: 800, height: 600 };
    const angles = { yaw: -36, pitch: 12 };
    const spacing = 60;
    const P = perspectiveFor(f.bounds, 120);
    const loose = fitBounds(angles, f.bounds, spacing, P, view, undefined, 20);
    const tight = fitFrame(angles, f, spacing, P, view, undefined, 20);
    expect(tight.zoom).toBeGreaterThanOrEqual(loose.zoom - 1e-9);
    for (const p of frameCorners(f, spacing)) {
      const q = project(tight, spacing, P, p);
      expect(Math.abs(q.x)).toBeLessThanOrEqual(view.width / 2 - 20 + 1e-6);
      expect(Math.abs(q.y)).toBeLessThanOrEqual(view.height / 2 - 20 + 1e-6);
    }
  });
});

describe('labels', () => {
  it('prefers landmarks over generic boxes of the same size', () => {
    const r = { x: 0, y: 0, width: 200, height: 100 };
    expect(labelPriority({ label: 'header.top', rect: r })).toBeGreaterThan(labelPriority({ label: 'div.wrap', rect: r }));
    expect(labelPriority({ label: 'div#app', rect: r })).toBeGreaterThan(labelPriority({ label: 'div.app', rect: r }));
  });
});
