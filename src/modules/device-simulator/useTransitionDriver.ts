import { useEffect } from 'react';
import { studio, useStudio } from '@/store';
import { contentPostureAt, motion } from './motion';

/** How often the store's copy of the progress is refreshed while animating (ms). */
const STORE_INTERVAL = 120;

/**
 * Single rAF driver for fold/unfold transitions.
 *
 * Progress lives in the motion engine and reaches the frame as CSS variables,
 * so a frame costs a style update, not a React render. The store keeps a
 * throttled copy for readers such as the toolbar, and the content posture
 * (which decides the live page's viewport) flips once: when the hinge is fully
 * open in the 3D style, or at the midpoint/continuously in the flat style.
 */
export function useTransitionDriver() {
  const playing = useStudio((s) => s.transition.playing);

  // At rest, the motion engine follows the store (posture changes, scrubbing, device switches).
  useEffect(() => {
    motion.setProgress(studio().transition.progress);
    return useStudio.subscribe((s, prev) => {
      if (!s.transition.playing && (s.transition.progress !== prev.transition.progress || prev.transition.playing)) motion.setProgress(s.transition.progress);
    });
  }, []);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let lastStore = 0;
    const tick = (now: number) => {
      const s = studio();
      const t = s.transition;
      if (!t.playing) return;
      // rAF timestamps can precede the performance.now() taken when the effect ran.
      const dt = Math.max(0, Math.min(64, now - last));
      last = Math.max(last, now);
      let progress = motion.progress + (dt / Math.max(120, t.duration)) * t.direction;
      const done = t.direction === 1 ? progress >= 1 : progress <= 0;
      if (done) progress = progress >= 1 ? 1 : 0;
      motion.setProgress(progress);

      if (done) {
        if (t.loop) {
          s.setTransition({ progress, direction: (t.direction * -1) as 1 | -1 });
        } else {
          useStudio.setState({
            transition: { ...t, progress, playing: false },
            viewport: { ...s.viewport, posture: progress === 1 ? 'expanded' : 'folded' },
          });
          return;
        }
      } else if (t.style === 'reflow') {
        // Flat style reflows the page with the frame, so the canvas needs every frame.
        s.setTransition({ progress });
      } else {
        const posture = contentPostureAt(progress);
        if (posture !== s.viewport.posture) useStudio.setState({ viewport: { ...s.viewport, posture } });
        if (now - lastStore > STORE_INTERVAL) {
          lastStore = now;
          s.setTransition({ progress });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

/** Scrub to an explicit progress (pauses playback). The content posture follows the frame. */
export function scrubTransition(progress: number) {
  const s = studio();
  const p = Math.min(1, Math.max(0, progress));
  const posture = s.transition.style === 'reflow' ? (p >= 0.5 ? 'expanded' : 'folded') : contentPostureAt(p);
  useStudio.setState({
    transition: { ...s.transition, progress: p, playing: false },
    viewport: { ...s.viewport, posture },
  });
}
