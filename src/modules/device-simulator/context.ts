import type { ViewportContext } from '@shared/types';
import { studio } from '@/store';
import { foldInViewport, resolveTransition, resolveViewport, viewportContext } from './viewport';

/** Viewport context of the primary canvas device right now. */
export function currentViewportContext(): ViewportContext {
  const s = studio();
  const d = s.device();
  return viewportContext(d, s.viewport.posture, s.viewport.orientation);
}

/** Geometry of the primary device, honouring an in-flight fold transition. */
export function currentGeometry() {
  const s = studio();
  const d = s.device();
  if (d.expanded && (s.transition.playing || (s.transition.progress > 0 && s.transition.progress < 1))) {
    return resolveTransition(d, s.viewport.orientation, s.transition.progress, s.transition.mode);
  }
  return resolveViewport(d, s.viewport.posture, s.viewport.orientation).geometry;
}

/** Fold geometry relative to the current viewport (for audits), or null. */
export function currentFold() {
  return foldInViewport(currentGeometry());
}
