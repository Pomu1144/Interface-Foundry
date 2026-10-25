import { useSyncExternalStore } from 'react';

/**
 * Per-frame device motion, kept outside the React store.
 *
 * The fold animation and the drag-to-orbit gesture change every frame. Writing
 * them into the studio store re-rendered the canvas, toolbar and dock on every
 * frame and resized the live page continuously. Instead, progress and camera
 * angles live here and are written straight onto registered device elements
 * as CSS custom properties, so the browser only recomposites transforms.
 * Small widgets that display the values subscribe with `useFoldProgress`.
 */

/** Fraction of the transition spent swinging the hinge; the rest slides the content across. */
export const SWING_END = 0.78;

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export type FoldVars = {
  /** Hinge angle in degrees: 180 = folded away behind, 0 = flat open. */
  angle: number;
  /** 0 → 1 as the hinge opens (eased). */
  open: number;
  /** 0 → 1 → 0 bell over the swing, used for camera lift and shading. */
  lift: number;
  /** 0 → 1 as the expanded content slides across the second panel. */
  slide: number;
};

export function foldVars(progress: number): FoldVars {
  const swing = clamp01(progress / SWING_END);
  const open = easeInOutCubic(swing);
  const slide = easeOutCubic(clamp01((progress - SWING_END) / (1 - SWING_END)));
  return { angle: 180 * (1 - open), open, lift: Math.sin(Math.PI * swing), slide };
}

/** Content posture implied by a progress value in the 3D hinge style. */
export const contentPostureAt = (progress: number) => (progress >= SWING_END ? 'expanded' : 'folded');

/** Camera-style rotation of the whole device, plus a glide offset used when orientation changes. */
type Orbit = { yaw: number; pitch: number; spin: number; flipX: number; flipY: number };

let progress = 0;
let orbit: Orbit = { yaw: 0, pitch: 0, spin: 0, flipX: 0, flipY: 0 };
const elements = new Set<HTMLElement>();
const listeners = new Set<() => void>();

function write(el: HTMLElement) {
  const v = foldVars(progress);
  el.style.setProperty('--fold-angle', `${v.angle.toFixed(3)}deg`);
  el.style.setProperty('--fold-open', v.open.toFixed(4));
  el.style.setProperty('--fold-lift', v.lift.toFixed(4));
  el.style.setProperty('--fold-slide', v.slide.toFixed(4));
  el.style.setProperty('--orbit-yaw', `${orbit.yaw.toFixed(2)}deg`);
  el.style.setProperty('--orbit-pitch', `${orbit.pitch.toFixed(2)}deg`);
  el.style.setProperty('--orbit-spin', `${orbit.spin.toFixed(2)}deg`);
  el.style.setProperty('--flip-x', `${orbit.flipX.toFixed(2)}px`);
  el.style.setProperty('--flip-y', `${orbit.flipY.toFixed(2)}px`);
  el.dataset.motion = isMoving() ? 'active' : 'rest';
}

function emit() {
  for (const el of elements) write(el);
  for (const fn of listeners) fn();
}

export function isMoving() {
  return (progress > 0 && progress < 1) || orbit.yaw !== 0 || orbit.pitch !== 0 || orbit.spin !== 0 || orbit.flipX !== 0 || orbit.flipY !== 0;
}

export const motion = {
  get progress() {
    return progress;
  },
  get orbit(): Readonly<Orbit> {
    return orbit;
  },
  setProgress(p: number) {
    const next = clamp01(p);
    if (next === progress) return;
    progress = next;
    emit();
  },
  setOrbit(o: Partial<Orbit>) {
    orbit = { ...orbit, ...o };
    emit();
  },
  /** Register a device element; returns an unregister function. */
  attach(el: HTMLElement) {
    elements.add(el);
    write(el);
    return () => void elements.delete(el);
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
};

/* ------------------------------------------------------------------ */
/* Orbit tweens                                                        */
/* ------------------------------------------------------------------ */

export const easeOutBack = (t: number) => {
  const c1 = 1.4;
  return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

let tweenRaf = 0;

/** Animate orbit values to `target`; cancels any orbit tween in flight. */
export function animateOrbit(target: Partial<Orbit>, ms: number, ease: (t: number) => number = easeInOutCubic): Promise<void> {
  cancelAnimationFrame(tweenRaf);
  const from = { ...orbit };
  const keys = Object.keys(target) as (keyof Orbit)[];
  if (ms <= 0) {
    motion.setOrbit(target);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - t0) / ms));
      const e = ease(k);
      const next: Partial<Orbit> = {};
      for (const key of keys) next[key] = k >= 1 ? target[key]! : from[key] + (target[key]! - from[key]) * e;
      motion.setOrbit(next);
      if (k < 1) tweenRaf = requestAnimationFrame(step);
      else resolve();
    };
    tweenRaf = requestAnimationFrame(step);
  });
}

export function stopOrbitTween() {
  cancelAnimationFrame(tweenRaf);
}

/**
 * Pending orientation change: the device has been spun ±90° in place and the
 * stage must swap to the new geometry without a visible jump. The stage reads
 * this in a layout effect, resets the spin and glides from the old centre.
 */
export const pendingRotation: { center: { x: number; y: number } | null } = { center: null };

/** Re-render only the calling widget when fold progress changes. */
export function useFoldProgress(): number {
  return useSyncExternalStore(motion.subscribe, () => progress);
}

/** True while the device is folding, orbiting or rotating (overlays can't track 3D transforms). */
export function useDeviceMoving(): boolean {
  return useSyncExternalStore(motion.subscribe, isMoving);
}
