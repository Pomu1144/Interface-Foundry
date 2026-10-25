import type {
  DeviceProfile,
  FoldGeometry,
  Insets,
  Orientation,
  Posture,
  PostureGeometry,
  ResolvedViewport,
  Size,
  ViewportContext,
} from '@shared/types';

/** Geometry for a posture, falling back to folded for single-posture devices. */
export function postureGeometry(device: DeviceProfile, posture: Posture): PostureGeometry {
  return posture === 'expanded' && device.expanded ? device.expanded : device.folded;
}

export function canFold(device: DeviceProfile): boolean {
  return Boolean(device.expanded);
}

const rotateInsets = (i: Insets): Insets => ({ top: i.left, right: i.top, bottom: i.right, left: i.bottom });
const swap = (s: Size): Size => ({ width: s.height, height: s.width });

/**
 * Rotate a natural-orientation geometry 90° clockwise into landscape.
 * Safe areas rotate with the hardware (status bar ends up on the left edge),
 * and a vertical fold becomes a horizontal one.
 */
export function rotateGeometry(g: PostureGeometry): PostureGeometry {
  const fold: FoldGeometry | undefined = g.fold
    ? { ...g.fold, axis: g.fold.axis === 'vertical' ? 'horizontal' : 'vertical' }
    : undefined;
  const safe = rotateInsets(g.safeArea);
  const screen = swap(g.screen);
  return {
    screen,
    viewport: {
      width: screen.width - safe.left - safe.right,
      height: screen.height - safe.top - safe.bottom - g.browserChrome.top - g.browserChrome.bottom,
    },
    safeArea: safe,
    browserChrome: g.browserChrome,
    cornerRadius: g.cornerRadius,
    bezel: rotateInsets(g.bezel),
    fold: fold && adjustFoldForSafeArea(fold, safe),
  };
}

/** Fold offsets are relative to the screen; the viewport may be inset by safe areas. */
function adjustFoldForSafeArea(fold: FoldGeometry, _safe: Insets): FoldGeometry {
  return fold;
}

export function resolveViewport(device: DeviceProfile, posture: Posture, orientation: Orientation): ResolvedViewport {
  const base = postureGeometry(device, posture);
  const geometry = orientation === 'landscape' ? rotateGeometry(base) : base;
  return {
    device,
    posture: canFold(device) ? posture : 'folded',
    orientation,
    geometry,
    frame: frameSize(geometry),
  };
}

export function frameSize(g: PostureGeometry): Size {
  return {
    width: g.screen.width + g.bezel.left + g.bezel.right,
    height: g.screen.height + g.bezel.top + g.bezel.bottom,
  };
}

/**
 * Fold position relative to the viewport (not the screen), or null if the
 * fold does not intersect the viewport.
 */
export function foldInViewport(g: PostureGeometry): FoldGeometry | null {
  if (!g.fold) return null;
  const shift = g.fold.axis === 'vertical' ? g.safeArea.left : g.safeArea.top + g.browserChrome.top;
  const offset = g.fold.offset - shift;
  const limit = g.fold.axis === 'vertical' ? g.viewport.width : g.viewport.height;
  if (offset < 0 || offset > limit) return null;
  return { ...g.fold, offset };
}

/* ------------------------------------------------------------------ */
/* Interpolation (fold / unfold transitions)                           */
/* ------------------------------------------------------------------ */

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const lerpSize = (a: Size, b: Size, t: number): Size => ({
  width: lerp(a.width, b.width, t),
  height: lerp(a.height, b.height, t),
});

const lerpInsets = (a: Insets, b: Insets, t: number): Insets => ({
  top: lerp(a.top, b.top, t),
  right: lerp(a.right, b.right, t),
  bottom: lerp(a.bottom, b.bottom, t),
  left: lerp(a.left, b.left, t),
});

export type TransitionMode = 'continuous' | 'midpoint';

/** Smooth ease used for both frame motion and continuous viewport interpolation. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Geometry at transition progress `t` (0 = folded, 1 = expanded).
 *
 * The frame (screen, bezel, radius) always interpolates smoothly. The viewport
 * either interpolates continuously, forcing the real page to reflow at every
 * frame, or switches once at the midpoint.
 */
export function interpolateGeometry(
  folded: PostureGeometry,
  expanded: PostureGeometry,
  t: number,
  mode: TransitionMode,
): PostureGeometry {
  const k = Math.min(1, Math.max(0, t));
  const e = easeInOutCubic(k);
  const viewport =
    mode === 'continuous'
      ? roundSize(lerpSize(folded.viewport, expanded.viewport, e))
      : k < 0.5
        ? folded.viewport
        : expanded.viewport;
  const screen = roundSize(lerpSize(folded.screen, expanded.screen, e));
  const safeArea = lerpInsets(folded.safeArea, expanded.safeArea, e);
  return {
    screen:
      mode === 'continuous'
        ? screen
        : // In midpoint mode the screen still animates but must contain the viewport.
          {
            width: Math.max(screen.width, viewport.width + safeArea.left + safeArea.right),
            height: Math.max(screen.height, viewport.height + safeArea.top + safeArea.bottom),
          },
    viewport,
    safeArea,
    browserChrome: {
      top: lerp(folded.browserChrome.top, expanded.browserChrome.top, e),
      bottom: lerp(folded.browserChrome.bottom, expanded.browserChrome.bottom, e),
    },
    cornerRadius: lerp(folded.cornerRadius, expanded.cornerRadius, e),
    bezel: lerpInsets(folded.bezel, expanded.bezel, e),
    fold: anchoredFold(expanded, screen, e),
  };
}

/** Keep the hinge proportionally anchored while the screen changes size. */
function anchoredFold(expanded: PostureGeometry, screen: Size, e: number): FoldGeometry | undefined {
  if (!expanded.fold || e <= 0.02) return undefined;
  const vertical = expanded.fold.axis === 'vertical';
  const full = vertical ? expanded.screen.width : expanded.screen.height;
  const now = vertical ? screen.width : screen.height;
  return { ...expanded.fold, offset: (expanded.fold.offset / full) * now };
}

const roundSize = (s: Size): Size => ({ width: Math.round(s.width), height: Math.round(s.height) });

/** Resolve the geometry for an in-flight transition, honouring orientation. */
export function resolveTransition(
  device: DeviceProfile,
  orientation: Orientation,
  progress: number,
  mode: TransitionMode,
): PostureGeometry {
  if (!device.expanded) return resolveViewport(device, 'folded', orientation).geometry;
  const a = resolveViewport(device, 'folded', orientation).geometry;
  const b = resolveViewport(device, 'expanded', orientation).geometry;
  return interpolateGeometry(a, b, progress, mode);
}

export function viewportContext(device: DeviceProfile, posture: Posture, orientation: Orientation): ViewportContext {
  const r = resolveViewport(device, posture, orientation);
  return {
    deviceId: device.id,
    deviceName: device.name,
    posture: r.posture,
    orientation,
    width: r.geometry.viewport.width,
    height: r.geometry.viewport.height,
  };
}

export function describeViewport(ctx: ViewportContext): string {
  const posture = ctx.posture === 'expanded' ? ' · expanded' : '';
  return `${ctx.deviceName}${posture} · ${ctx.width}×${ctx.height}`;
}

/** Scale that fits `content` into `container` with padding, never upscaling past `max`. */
export function fitScale(content: Size, container: Size, padding = 48, max = 1): number {
  const sx = (container.width - padding * 2) / content.width;
  const sy = (container.height - padding * 2) / content.height;
  return Math.max(0.05, Math.min(max, sx, sy));
}
