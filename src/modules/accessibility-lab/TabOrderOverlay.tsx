import { useEffect, useRef, useState } from 'react';
import type { NodeId, Rect } from '@shared/types';
import { useStudio } from '@/store';
import { previews } from '@/modules/preview-runtime/registry';
import { lastScroll } from '@/modules/responsive-audit/scroll';
import { bus } from '@/lib/events';
import { useA11yLab } from './runner';
import s from './overlay.module.css';

type Geom = { left: number; top: number; scale: number; clip: { left: number; top: number; right: number; bottom: number } };

/** Screen geometry of the primary preview, clipped by every scrolling/clipping ancestor (canvas, panels). */
function primaryGeom(): Geom | null {
  const el = document.querySelector<HTMLElement>('[data-instance="primary"]');
  if (!el || !el.offsetWidth) return null;
  const r = el.getBoundingClientRect();
  const clip = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.visibility === 'hidden') return null;
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
      const pr = p.getBoundingClientRect();
      clip.left = Math.max(clip.left, pr.left);
      clip.top = Math.max(clip.top, pr.top);
      clip.right = Math.min(clip.right, pr.right);
      clip.bottom = Math.min(clip.bottom, pr.bottom);
    }
  }
  if (clip.right <= clip.left || clip.bottom <= clip.top) return null;
  return { left: r.left, top: r.top, scale: r.width / el.offsetWidth, clip };
}

/** Re-measure tab stops (after scroll, resize, fold or DOM changes). */
async function refreshRects() {
  const lab = useA11yLab.getState();
  const conn = previews.primary();
  if (!lab.keyboard || !conn?.ready) return;
  const ids = lab.keyboard.order.map((o) => o.id);
  const boxes = await Promise.all(ids.map((id) => conn.call('node.box', { id }, 4000).catch(() => null)));
  const rects: Record<NodeId, Rect | null> = {};
  ids.forEach((id, i) => (rects[id] = boxes[i]?.borderBox ?? null));
  useA11yLab.setState({ rects, rectsScroll: lastScroll.get(conn.id) ?? { x: 0, y: 0 } });
}

/**
 * Numbered tab-order overlay drawn over the canvas preview, using the same
 * screen mapping as the selection overlay (preview rect / offsetWidth).
 */
export function TabOrderOverlay() {
  const on = useA11yLab((l) => l.overlay);
  const keyboard = useA11yLab((l) => l.keyboard);
  const rects = useA11yLab((l) => l.rects);
  const rectsScroll = useA11yLab((l) => l.rectsScroll);
  const activeDoc = useStudio((st) => st.activeDocId);
  const vp = useStudio((st) => st.instances.primary?.viewport);
  const [geom, setGeom] = useState<Geom | null>(null);
  const [scroll, setScroll] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastKey = useRef('');

  const visible = on && Boolean(keyboard) && activeDoc === 'canvas';

  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    const loop = () => {
      const g = primaryGeom();
      const key = JSON.stringify(g);
      if (key !== lastKey.current) {
        lastKey.current = key;
        setGeom(g);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  // Follow page scroll immediately, re-measure once it settles.
  useEffect(() => {
    if (!visible) return;
    const conn = previews.primary();
    setScroll(lastScroll.get(conn?.id ?? 'primary') ?? { x: 0, y: 0 });
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = bus.on('agent-scroll', (e) => {
      if (e.instanceId !== (previews.primary()?.id ?? 'primary')) return;
      setScroll({ x: e.x, y: e.y });
      if (t) clearTimeout(t);
      t = setTimeout(() => void refreshRects(), 160);
    });
    const interval = setInterval(() => void refreshRects(), 2000);
    void refreshRects();
    return () => {
      off();
      clearInterval(interval);
      if (t) clearTimeout(t);
    };
  }, [visible]);

  useEffect(() => {
    if (visible) void refreshRects();
  }, [visible, vp?.width, vp?.height]);

  if (!visible || !keyboard || !geom) return null;
  const k = geom.scale;
  const dx = rectsScroll.x - scroll.x;
  const dy = rectsScroll.y - scroll.y;
  const stops = keyboard.order
    .map((o, i) => ({ o, i, r: rects[o.id] ?? null }))
    .filter((x): x is { o: typeof x.o; i: number; r: Rect } => Boolean(x.r && x.r.width + x.r.height > 0))
    .map(({ o, i, r }) => ({ o, i, x: (r.x + dx) * k, y: (r.y + dy) * k, w: r.width * k, h: r.height * k }));
  const path = stops.map((p) => `${p.x + p.w / 2},${p.y + p.h / 2}`).join(' ');

  return (
    <div
      className={s.clip}
      style={{ left: geom.clip.left, top: geom.clip.top, width: geom.clip.right - geom.clip.left, height: geom.clip.bottom - geom.clip.top }}
      aria-hidden
      data-testid="tab-order-overlay"
    >
      <div className={s.layer} style={{ left: geom.left - geom.clip.left, top: geom.top - geom.clip.top }}>
        <svg className={s.path} style={{ overflow: 'visible' }}>
          <polyline points={path} />
        </svg>
        {stops.map(({ o, i, x, y, w, h }) => (
          <div key={o.id} className={s.stop} data-warn={o.visibleFocus ? undefined : 'true'} style={{ left: x, top: y, width: w, height: h }}>
            <span className={s.badge}>{i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
