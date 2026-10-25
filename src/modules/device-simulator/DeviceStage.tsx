import { FlipHorizontal2, RotateCw } from 'lucide-react';
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { Orientation, Posture } from '@shared/types';
import { studio } from '@/store';
import { panKey } from '@/modules/canvas/useCamera';
import { animateOrbit, easeInOutCubic, easeOutBack, foldVars, motion, normalizeAngle, pendingRotation, stopOrbitTween } from './motion';
import { flipDevice, rotateDevice } from './rotate';
import s from './DeviceFrame.module.css';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 3D stage around a device frame.
 *
 * The primary device is driven by the motion engine (fold progress, orbit,
 * spin) through CSS variables. Dragging the hardware (bezel, body, hinge)
 * orbits the phone in 3D and springs back on release; the rotate handle spins
 * it in-plane and snaps to landscape or portrait.
 */
export function DeviceStage({
  live,
  posture,
  orientation,
  zoom,
  children,
}: {
  /** Primary device: attached to the motion engine and interactive. */
  live: boolean;
  posture: Posture;
  orientation: Orientation;
  zoom: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: 'orbit' | 'spin'; x: number; y: number; cx: number; cy: number; a0: number; spin0: number; yaw0: number; moved: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!live || !ref.current) return;
    return motion.attach(ref.current);
  }, [live]);

  // Orientation swapped after a spin: reset the spin and glide from where the device was.
  useLayoutEffect(() => {
    if (!live) return;
    const c = pendingRotation.center;
    if (!c || !ref.current) return;
    pendingRotation.center = null;
    motion.setOrbit({ spin: 0, flipX: 0, flipY: 0 });
    const r = ref.current.getBoundingClientRect();
    const k = Math.max(0.05, zoom);
    motion.setOrbit({ flipX: (c.x - (r.left + r.width / 2)) / k, flipY: (c.y - (r.top + r.height / 2)) / k });
    void animateOrbit({ flipX: 0, flipY: 0 }, 420, easeInOutCubic);
  }, [orientation, live, zoom]);

  // Static devices (compare partner) show their posture without animation.
  const staticVars: CSSProperties | undefined = live
    ? undefined
    : (() => {
        const v = foldVars(posture === 'expanded' ? 1 : 0);
        return {
          ['--fold-angle' as string]: `${v.angle}deg`,
          ['--fold-open' as string]: v.open,
          ['--fold-lift' as string]: 0,
          ['--fold-slide' as string]: v.slide,
        };
      })();

  const onPointerDown = (e: React.PointerEvent) => {
    if (!live || e.button !== 0 || panKey.down || studio().tool !== 'select') return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-orbit]')) return;
    const spin = Boolean(target.closest('[data-rotate-handle]'));
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    stopOrbitTween();
    const r = ref.current!.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    drag.current = { kind: spin ? 'spin' : 'orbit', x: e.clientX, y: e.clientY, cx, cy, a0: Math.atan2(e.clientY - cy, e.clientX - cx), spin0: motion.orbit.spin, yaw0: motion.orbit.yaw, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    if (d.kind === 'orbit') {
      // Yaw turns freely so the device can be turned over to see its back.
      motion.setOrbit({ yaw: d.yaw0 + dx * 0.45, pitch: clamp(-dy * 0.32, -55, 55) });
    } else {
      const a = Math.atan2(e.clientY - d.cy, e.clientX - d.cx);
      let deg = d.spin0 + ((a - d.a0) * 180) / Math.PI;
      deg = ((deg + 540) % 360) - 180;
      motion.setOrbit({ spin: clamp(deg, -120, 120) });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (d.kind === 'orbit') {
      // Settle on whichever side faces the viewer: the screen or the back.
      const yaw = normalizeAngle(motion.orbit.yaw);
      motion.setOrbit({ yaw });
      void animateOrbit({ yaw: Math.abs(yaw) > 90 ? Math.sign(yaw) * 180 : 0, pitch: 0 }, 700, easeOutBack);
      return;
    }
    // Rotate handle: a click turns the device; a drag past 40° snaps to the other orientation.
    if (!d.moved || Math.abs(motion.orbit.spin) >= 40) void rotateDevice();
    else void animateOrbit({ spin: 0 }, 420, easeOutBack);
  };

  return (
    <div
      className={s.stageWrap}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        if (!live || (e.target as HTMLElement).closest('[data-no-orbit],[data-rotate-handle]')) return;
        void animateOrbit({ yaw: 0, pitch: 0, spin: 0 }, 420, easeOutBack);
      }}
    >
      <div ref={ref} className={s.stage} data-device-stage={live ? 'primary' : 'static'} style={staticVars}>
        {children}
      </div>
      {live && (
        <div className={s.stageHandles} style={{ transform: `scale(${1 / Math.max(0.35, zoom)})` }}>
          <button
            type="button"
            className={s.rotateHandle}
            data-rotate-handle
            aria-label={orientation === 'portrait' ? 'Rotate to landscape (drag or click)' : 'Rotate to portrait (drag or click)'}
            title={orientation === 'portrait' ? 'Drag to rotate · click for landscape (R)' : 'Drag to rotate · click for portrait (R)'}
            onClick={(e) => {
              // Pointer clicks are handled on pointer-up; this covers keyboard activation.
              if (e.detail === 0) void rotateDevice();
            }}
          >
            <RotateCw size={15} />
          </button>
          <button type="button" className={s.rotateHandle} data-no-orbit aria-label="Show the back of the device" title="Turn over to see the back (B) · or drag the device" onClick={() => void flipDevice()}>
            <FlipHorizontal2 size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
