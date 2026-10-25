import type { DeviceProfile, Posture, PostureGeometry } from '@shared/types';

/**
 * Layout for the 3D hinge animation of a two-panel foldable.
 *
 * One panel stays put and carries the live page while folded. The other swings
 * around the hinge from behind it (180°) to flat (0°). Once flat, the page
 * reflows to the expanded viewport and a cover slides off the second panel,
 * so the content appears to slide across the whole screen.
 *
 * All values are CSS px in the container's coordinate space. `u` runs across
 * the hinge (x for a vertical fold, y for a horizontal one), `v` runs along it.
 */

export type Rect = { x: number; y: number; width: number; height: number };

export type Fold3DLayout = {
  axis: 'vertical' | 'horizontal';
  /** Which side of the hinge swings: after = right/bottom (Duo), before = left/top (book foldables). */
  moving: 'before' | 'after';
  container: { width: number; height: number };
  /** Static panel body for each content posture. */
  staticPanel: Record<Posture, Rect>;
  movingPanel: Rect;
  /** Off screen area on the moving panel, relative to the moving panel. */
  movingScreen: Rect;
  /** Hinge cylinder (dual-screen devices), in container coordinates. */
  hinge: Rect | null;
  /** Where the screen (status bar + live viewport) sits for each content posture. */
  screen: Record<Posture, Rect>;
  /** Region of the expanded screen covered by the second panel, relative to the expanded screen. */
  reveal: Rect;
  /** Translation applied while folded so the visible device stays aligned to the slot origin. */
  foldedShift: { x: number; y: number };
};

const span = (g: PostureGeometry, axis: 'vertical' | 'horizontal') =>
  axis === 'vertical'
    ? { u: g.screen.width, v: g.screen.height, s0: g.bezel.left, s1: g.bezel.right, t0: g.bezel.top, t1: g.bezel.bottom }
    : { u: g.screen.height, v: g.screen.width, s0: g.bezel.top, s1: g.bezel.bottom, t0: g.bezel.left, t1: g.bezel.right };

/** Build a rect from (u, v) coordinates for the given axis. */
const rect = (axis: 'vertical' | 'horizontal', u: number, v: number, du: number, dv: number): Rect =>
  axis === 'vertical' ? { x: u, y: v, width: du, height: dv } : { x: v, y: u, width: dv, height: du };

export function fold3dLayout(device: DeviceProfile, folded: PostureGeometry, expanded: PostureGeometry): Fold3DLayout | null {
  const fold = expanded.fold;
  if (!fold) return null;
  const axis = fold.axis;
  const moving: 'before' | 'after' = device.frameStyle === 'dual-screen' ? 'after' : 'before';
  const E = span(expanded, axis);
  const F = span(folded, axis);
  const Ue = E.s0 + E.u + E.s1;
  const Ve = E.t0 + E.v + E.t1;
  const Uf = F.s0 + F.u + F.s1;
  const Vf = F.t0 + F.v + F.t1;
  const V = Math.max(Ve, Vf);
  const vE = (V - Ve) / 2;
  const vF = (V - Vf) / 2;
  // Hinge centre, measured from the expanded frame's leading edge.
  const c = E.s0 + fold.offset + fold.maskLength / 2;

  let eStart: number;
  let fStart: number;
  let U: number;
  if (moving === 'after') {
    eStart = 0;
    fStart = 0;
    U = Math.max(Ue, Uf);
  } else {
    // The folded panel is anchored to the trailing edge of the expanded frame.
    const base = Math.max(0, Uf - Ue);
    eStart = base;
    fStart = base + Ue - Uf;
    U = base + Ue;
  }

  const pivot = eStart + c;
  const staticExpanded = moving === 'after' ? rect(axis, eStart, vE, c, Ve) : rect(axis, pivot, vE, Ue - c, Ve);
  const staticFolded = rect(axis, fStart, vF, Uf, Vf);
  const movingPanel = moving === 'after' ? rect(axis, pivot, vE, Ue - c, Ve) : rect(axis, eStart, vE, c, Ve);

  // Screen part of the moving panel (outside the hinge mask), relative to the panel.
  const half = fold.maskLength / 2;
  const movingScreen =
    moving === 'after'
      ? rect(axis, half, E.t0, E.u - fold.offset - fold.maskLength, E.v)
      : rect(axis, E.s0, E.t0, fold.offset, E.v);

  const screenExpanded = rect(axis, eStart + E.s0, vE + E.t0, E.u, E.v);
  const screenFolded = rect(axis, fStart + F.s0, vF + F.t0, F.u, F.v);

  // The part of the expanded screen the slide reveals: everything beyond the static half.
  const reveal =
    moving === 'after'
      ? rect(axis, fold.offset, 0, E.u - fold.offset, E.v)
      : rect(axis, 0, 0, fold.offset + fold.maskLength, E.v);

  // The visible hinge is a slim barrel between the two slabs; the rest of the hidden
  // strip is the black glass edge of each panel.
  const barrel = Math.max(4, Math.round(fold.maskLength * 0.3));
  const hinge = fold.kind === 'hinge' && fold.maskLength > 0 ? rect(axis, pivot - barrel / 2, vE, barrel, Ve) : null;

  const shiftU = fStart === 0 ? 0 : -fStart;
  return {
    axis,
    moving,
    container: axis === 'vertical' ? { width: U, height: V } : { width: V, height: U },
    staticPanel: { folded: staticFolded, expanded: staticExpanded },
    movingPanel,
    movingScreen,
    hinge,
    screen: { folded: screenFolded, expanded: screenExpanded },
    reveal,
    foldedShift: axis === 'vertical' ? { x: shiftU, y: 0 } : { x: 0, y: shiftU },
  };
}
