import { useEffect } from 'react';
import { studio, useStudio } from '@/store';

/**
 * Single rAF driver for fold/unfold transitions. Progress is stored in the
 * studio so scrubbing, play/pause and every view share one source of truth.
 * The viewport posture flips when the animation lands.
 */
export function useTransitionDriver() {
  const playing = useStudio((s) => s.transition.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const s = studio();
      const t = s.transition;
      if (!t.playing) return;
      // rAF timestamps can precede the performance.now() taken when the effect ran.
      const dt = Math.max(0, Math.min(64, now - last));
      last = Math.max(last, now);
      let progress = t.progress + (dt / Math.max(120, t.duration)) * t.direction;
      const done = t.direction === 1 ? progress >= 1 : progress <= 0;
      if (done) {
        progress = progress >= 1 ? 1 : 0;
        if (t.loop) {
          s.setTransition({ progress, direction: (t.direction * -1) as 1 | -1 });
        } else {
          useStudio.setState({
            transition: { ...t, progress, playing: false },
            viewport: { ...s.viewport, posture: progress === 1 ? 'expanded' : 'folded' },
          });
          return;
        }
      } else {
        s.setTransition({ progress });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

/** Scrub to an explicit progress (pauses playback). Posture follows the nearest end. */
export function scrubTransition(progress: number) {
  const s = studio();
  const p = Math.min(1, Math.max(0, progress));
  useStudio.setState({
    transition: { ...s.transition, progress: p, playing: false },
    viewport: { ...s.viewport, posture: p >= 0.5 ? 'expanded' : 'folded' },
  });
}
