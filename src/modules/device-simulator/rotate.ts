import type { Orientation } from '@shared/types';
import { studio } from '@/store';
import { animateOrbit, easeInOutCubic, motion, normalizeAngle, pendingRotation } from './motion';

let rotating = false;

/**
 * Turn the primary device to `to` (or the other orientation): spin the frame
 * 90° in place, then swap to the rotated geometry. The stage hides the swap by
 * resetting the spin and gliding from the old centre in the same frame.
 */
export async function rotateDevice(to?: Orientation) {
  const s = studio();
  const target = to ?? (s.viewport.orientation === 'portrait' ? 'landscape' : 'portrait');
  if (target === s.viewport.orientation) {
    await animateOrbit({ spin: 0 }, 280);
    return;
  }
  if (s.settings.reducedMotion) {
    s.setViewport({ orientation: target });
    return;
  }
  if (rotating) return;
  rotating = true;
  try {
    // Landscape geometry is the portrait device turned clockwise.
    await animateOrbit({ spin: target === 'landscape' ? 90 : -90, yaw: 0, pitch: 0 }, 460, easeInOutCubic);
    const el = document.querySelector<HTMLElement>('[data-device-stage="primary"]');
    const r = el?.getBoundingClientRect();
    pendingRotation.center = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    studio().setViewport({ orientation: target });
  } finally {
    rotating = false;
  }
}

/** Turn the device over to show its back, or back to the screen. */
export async function flipDevice() {
  const yaw = normalizeAngle(motion.orbit.yaw);
  motion.setOrbit({ yaw });
  const showingBack = Math.abs(yaw) > 90;
  const ms = studio().settings.reducedMotion ? 0 : 900;
  await animateOrbit({ yaw: showingBack ? 0 : yaw < 0 ? -180 : 180, pitch: 0 }, ms, easeInOutCubic);
}
