import { useEffect, useRef } from 'react';
import { studio } from '@/store';
import { useOverlay } from '@/modules/preview-runtime/overlay-store';
import s from './canvas.module.css';

const SIZE = 18;
const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];

/**
 * Pixel rulers along the canvas edges, in CSS px of the primary preview's
 * viewport (origin at its top-left), with the selection extent highlighted.
 */
export function Rulers({ container }: { container: React.RefObject<HTMLDivElement | null> }) {
  const top = useRef<HTMLCanvasElement>(null);
  const left = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    let lastKey = '';
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const host = container.current;
      const frame = document.querySelector<HTMLElement>('[data-instance="primary"]');
      if (!host || !top.current || !left.current) return;
      const hr = host.getBoundingClientRect();
      const fr = frame?.getBoundingClientRect();
      const scale = frame && frame.offsetWidth ? fr!.width / frame.offsetWidth : studio().camera.zoom;
      const ox = fr ? fr.left - hr.left : 0;
      const oy = fr ? fr.top - hr.top : 0;
      const st = studio();
      const sel = st.selection.instanceId === 'primary' && st.selection.nodeId !== null ? useOverlay.getState().rects.primary?.[st.selection.nodeId] ?? st.selection.info?.rect ?? null : null;
      const theme = document.documentElement.dataset.theme;
      const key = [hr.width, hr.height, ox, oy, scale, sel?.x, sel?.y, sel?.width, sel?.height, theme, devicePixelRatio].join('|');
      if (key === lastKey) return;
      lastKey = key;
      const css = getComputedStyle(document.documentElement);
      const colors = {
        bg: css.getPropertyValue('--bg-1').trim() || '#101114',
        line: css.getPropertyValue('--line-2').trim() || 'rgba(255,255,255,.1)',
        tick: css.getPropertyValue('--text-3').trim() || '#5b5e68',
        text: css.getPropertyValue('--text-2').trim() || '#81848e',
        accent: css.getPropertyValue('--accent').trim() || '#5b8dff',
      };
      paint(top.current, hr.width, SIZE, 'x', ox, scale, sel ? [sel.x, sel.x + sel.width] : null, colors);
      paint(left.current, SIZE, hr.height, 'y', oy, scale, sel ? [sel.y, sel.y + sel.height] : null, colors);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [container]);

  return (
    <>
      <canvas ref={top} className={s.rulerTop} aria-hidden />
      <canvas ref={left} className={s.rulerLeft} aria-hidden />
      <span className={s.rulerCorner} aria-hidden />
    </>
  );
}

function paint(
  c: HTMLCanvasElement,
  w: number,
  h: number,
  axis: 'x' | 'y',
  origin: number,
  scale: number,
  range: [number, number] | null,
  colors: { bg: string; line: string; tick: string; text: string; accent: string },
) {
  const dpr = devicePixelRatio || 1;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
  }
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = colors.bg;
  g.fillRect(0, 0, w, h);
  const len = axis === 'x' ? w : h;
  if (range) {
    const a = origin + range[0] * scale;
    const b = origin + range[1] * scale;
    g.fillStyle = colors.accent;
    g.globalAlpha = 0.22;
    if (axis === 'x') g.fillRect(a, 0, b - a, h);
    else g.fillRect(0, a, w, b - a);
    g.globalAlpha = 1;
  }
  const step = STEPS.find((st) => st * scale >= 56) ?? 5000;
  const minor = step / (step % 5 === 0 ? 5 : 2);
  const start = Math.floor(-origin / scale / minor) * minor;
  const end = (len - origin) / scale;
  g.font = '9.5px "Geist Mono Variable", ui-monospace, monospace';
  g.textBaseline = 'top';
  for (let v = start; v <= end; v += minor) {
    const p = Math.round(origin + v * scale) + 0.5;
    const major = Math.abs(v % step) < 1e-6;
    g.strokeStyle = major ? colors.text : colors.tick;
    g.beginPath();
    if (axis === 'x') {
      g.moveTo(p, major ? 6 : 12);
      g.lineTo(p, h);
    } else {
      g.moveTo(major ? 6 : 12, p);
      g.lineTo(w, p);
    }
    g.stroke();
    if (major) {
      g.fillStyle = colors.text;
      const label = String(Math.round(v));
      if (axis === 'x') g.fillText(label, p + 3, 2);
      else {
        g.save();
        g.translate(2, p - 3);
        g.rotate(-Math.PI / 2);
        g.fillText(label, 0, 0);
        g.restore();
      }
    }
  }
  if (range) {
    g.fillStyle = colors.accent;
    for (const v of range) {
      const p = Math.round(origin + v * scale);
      if (axis === 'x') g.fillRect(p, 0, 1, h);
      else g.fillRect(0, p, w, 1);
    }
  }
  g.strokeStyle = colors.line;
  g.beginPath();
  if (axis === 'x') {
    g.moveTo(0, h - 0.5);
    g.lineTo(w, h - 0.5);
  } else {
    g.moveTo(w - 0.5, 0);
    g.lineTo(w - 0.5, h);
  }
  g.stroke();
}
