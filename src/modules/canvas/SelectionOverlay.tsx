import { BookmarkPlus, Code2, Copy, Eye, EyeOff, Puzzle, Ruler, Sparkles, Type } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { NodeId, Rect } from '@shared/types';
import { IconButton } from '@/ui';
import { bus } from '@/lib/events';
import { studio, useStudio } from '@/store';
import { useOverlay } from '@/modules/preview-runtime/overlay-store';
import { previews } from '@/modules/preview-runtime/registry';
import { cancelPreview, isHidden, previewStyles, setStyles, toggleHidden } from '@/modules/change-manager/edit';
import { planResize } from './resize';
import { copyText, cssForInfo } from './clipboard';
import { saveSelectionAsStyle } from '@/modules/style-inspector/presets';
import { isMoving, useDeviceMoving } from '@/modules/device-simulator/motion';
import s from './canvas.module.css';

type ScreenRect = { left: number; top: number; width: number; height: number };
type FrameGeom = { left: number; top: number; scale: number };

function frameGeom(instanceId: string, container: DOMRect): FrameGeom | null {
  const el = document.querySelector<HTMLElement>(`[data-instance="${instanceId}"]`);
  if (!el || !el.offsetWidth) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left - container.left, top: r.top - container.top, scale: r.width / el.offsetWidth };
}

const toScreen = (g: FrameGeom, r: Rect): ScreenRect => ({ left: g.left + r.x * g.scale, top: g.top + r.y * g.scale, width: r.width * g.scale, height: r.height * g.scale });

/**
 * Screen-space overlay for the canvas: hover outline, selection with handles,
 * spacing (margin/padding) shading, Alt-measurement redlines, mirrored
 * selections in compare views, and the contextual toolbar.
 */
export function SelectionOverlay({ container }: { container: React.RefObject<HTMLDivElement | null> }) {
  const [, force] = useState(0);
  const geoms = useRef<Record<string, FrameGeom | null>>({});
  const [alt, setAlt] = useState(false);
  const interaction = useStudio((st) => st.interaction);
  const selection = useStudio((st) => st.selection);
  const changesCount = useStudio((st) => st.changes.length);
  const hover = useOverlay((o) => o.hover);
  const rects = useOverlay((o) => o.rects);
  const mirrors = useOverlay((o) => o.mirrors);
  // Outlines are drawn in screen space and can't follow a device that is folding or turning in 3D.
  const moving = useDeviceMoving();

  // Track frame positions every animation frame (camera moves, fold transitions, resizes).
  useEffect(() => {
    let raf = 0;
    let lastKey = '';
    const loop = () => {
      const c = isMoving() ? null : container.current?.getBoundingClientRect();
      if (c) {
        const ids = new Set<string>(Object.keys(studio().instances));
        const next: Record<string, FrameGeom | null> = {};
        for (const id of ids) next[id] = frameGeom(id, c);
        const key = JSON.stringify(next);
        if (key !== lastKey) {
          lastKey = key;
          geoms.current = next;
          force((n) => n + 1);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [container]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => e.key === 'Alt' && setAlt(true);
    const up = (e: KeyboardEvent) => e.key === 'Alt' && setAlt(false);
    const blur = () => setAlt(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  if (moving) return null;
  const selGeom = selection.instanceId ? geoms.current[selection.instanceId] : null;
  const selRectRaw: Rect | null = selection.nodeId !== null && selection.instanceId ? rects[selection.instanceId]?.[selection.nodeId] ?? selection.info?.rect ?? null : null;
  const sel = selGeom && selRectRaw ? toScreen(selGeom, selRectRaw) : null;
  const hovGeom = hover ? geoms.current[hover.instanceId] : null;
  const hov = hover && hovGeom && interaction === 'inspect' && !(hover.nodeId === selection.nodeId && hover.instanceId === selection.instanceId) ? toScreen(hovGeom, hover.rect) : null;
  const info = selection.info;

  return (
    <div className={s.overlay} aria-hidden={false}>
      {/* Mirrored selection in other previews */}
      {Object.entries(mirrors).map(([iid, nid]) => {
        if (nid === null || iid === selection.instanceId) return null;
        const g = geoms.current[iid];
        const r = rects[iid]?.[nid as NodeId];
        if (!g || !r) return null;
        const sr = toScreen(g, r);
        return <div key={iid} className={s.mirror} style={sr} />;
      })}

      {/* Spacing visualisation for the selection */}
      {sel && info && selGeom && <SpacingShade info={info} rect={selRectRaw!} geom={selGeom} />}

      {hov && hover && (
        <>
          <div className={s.hover} style={hov} />
          {!alt && (
            <div className={s.hoverLabel} style={{ left: hov.left, top: Math.max(0, hov.top - 22) }}>
              <span className={s.hoverTag}>{hover.label}</span>
              <span className={s.hoverDims}>
                {Math.round(hover.rect.width)}×{Math.round(hover.rect.height)}
              </span>
            </div>
          )}
        </>
      )}

      {sel && (
        <>
          <div className={s.selection} style={sel} data-hidden={info && isHidden(info.selector) ? 'true' : undefined} />
          {info && <Handles rect={sel} scale={selGeom!.scale} />}
          <div className={s.dimBadge} style={{ left: sel.left + sel.width / 2, top: sel.top + sel.height + 8 }}>
            {Math.round(selRectRaw!.width)} × {Math.round(selRectRaw!.height)}
          </div>
          {info && <ContextToolbar rect={sel} key={`${info.id}-${changesCount}`} />}
        </>
      )}

      {alt && sel && hov && <Measure a={sel} b={hov} scale={selGeom!.scale} />}
    </div>
  );
}

function SpacingShade({ info, rect, geom }: { info: NonNullable<ReturnType<typeof studio>['selection']['info']>; rect: Rect; geom: FrameGeom }) {
  const { margin: m, padding: p, border: b } = info.box;
  const k = geom.scale;
  const outer = toScreen(geom, { x: rect.x - m.left, y: rect.y - m.top, width: rect.width + m.left + m.right, height: rect.height + m.top + m.bottom });
  const box = toScreen(geom, rect);
  const inner = toScreen(geom, {
    x: rect.x + b.left + p.left,
    y: rect.y + b.top + p.top,
    width: Math.max(0, rect.width - b.left - b.right - p.left - p.right),
    height: Math.max(0, rect.height - b.top - b.bottom - p.top - p.bottom),
  });
  const hasMargin = m.top || m.right || m.bottom || m.left;
  const hasPadding = p.top || p.right || p.bottom || p.left;
  return (
    <>
      {hasMargin ? (
        <div
          className={s.marginShade}
          style={{
            left: outer.left,
            top: outer.top,
            width: outer.width,
            height: outer.height,
            borderWidth: `${m.top * k}px ${m.right * k}px ${m.bottom * k}px ${m.left * k}px`,
          }}
        />
      ) : null}
      {hasPadding ? (
        <div
          className={s.paddingShade}
          style={{
            left: box.left + b.left * k,
            top: box.top + b.top * k,
            width: inner.width + (p.left + p.right) * k,
            height: inner.height + (p.top + p.bottom) * k,
            borderWidth: `${p.top * k}px ${p.right * k}px ${p.bottom * k}px ${p.left * k}px`,
          }}
        />
      ) : null}
    </>
  );
}

function Handles({ rect, scale }: { rect: ScreenRect; scale: number }) {
  const drag = useRef<{ axis: 'x' | 'y' | 'xy'; sx: number; sy: number; w: number; h: number } | null>(null);
  const start = (axis: 'x' | 'y' | 'xy') => (e: React.PointerEvent) => {
    const info = studio().selection.info;
    if (!info) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { axis, sx: e.clientX, sy: e.clientY, w: info.rect.width, h: info.rect.height };
  };
  const plan = (e: React.PointerEvent) => {
    const d = drag.current;
    const info = studio().selection.info;
    if (!d || !info) return null;
    const vw = studio().instances[studio().selection.instanceId ?? '']?.viewport?.width ?? 0;
    const edits = [];
    if (d.axis !== 'y') edits.push(...planResize(info, 'x', d.w + (e.clientX - d.sx) / scale, vw));
    if (d.axis !== 'x') edits.push(...planResize(info, 'y', d.h + (e.clientY - d.sy) / scale, vw));
    return edits.map((x) => ({ property: x.property, value: x.value }));
  };
  const move = (e: React.PointerEvent) => {
    const edits = plan(e);
    if (edits) previewStyles(edits, 'canvas');
  };
  const end = (e: React.PointerEvent) => {
    const edits = plan(e);
    drag.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    if (edits && (Math.abs(e.clientX) > 0 || Math.abs(e.clientY) > 0)) {
      cancelPreview();
      setStyles(edits, 'canvas');
    }
  };
  const props = (axis: 'x' | 'y' | 'xy') => ({ onPointerDown: start(axis), onPointerMove: move, onPointerUp: end });
  const { left, top, width, height } = rect;
  return (
    <>
      {[
        [left, top],
        [left + width, top],
        [left, top + height],
      ].map(([x, y], i) => (
        <span key={i} className={s.handle} style={{ left: x, top: y }} />
      ))}
      <span className={s.handle} data-resize="xy" style={{ left: left + width, top: top + height, cursor: 'nwse-resize' }} {...props('xy')} title="Drag to resize" />
      <span className={s.edgeHandle} style={{ left: left + width, top: top + height / 2, cursor: 'ew-resize' }} {...props('x')} title="Drag to change width" />
      <span className={s.edgeHandle} data-axis="y" style={{ left: left + width / 2, top: top + height, cursor: 'ns-resize' }} {...props('y')} title="Drag to change height" />
    </>
  );
}

function Measure({ a, b, scale }: { a: ScreenRect; b: ScreenRect; scale: number }) {
  const lines: { x1: number; y1: number; x2: number; y2: number; label: number }[] = [];
  const aR = a.left + a.width;
  const bR = b.left + b.width;
  const aB = a.top + a.height;
  const bB = b.top + b.height;
  const midY = (Math.max(a.top, b.top) + Math.min(aB, bB)) / 2;
  const midX = (Math.max(a.left, b.left) + Math.min(aR, bR)) / 2;
  const cy = Number.isFinite(midY) && Math.max(a.top, b.top) < Math.min(aB, bB) ? midY : a.top + a.height / 2;
  const cx = Number.isFinite(midX) && Math.max(a.left, b.left) < Math.min(aR, bR) ? midX : a.left + a.width / 2;
  if (bR <= a.left) lines.push({ x1: bR, y1: cy, x2: a.left, y2: cy, label: (a.left - bR) / scale });
  else if (b.left >= aR) lines.push({ x1: aR, y1: cy, x2: b.left, y2: cy, label: (b.left - aR) / scale });
  else {
    if (b.left !== a.left) lines.push({ x1: Math.min(a.left, b.left), y1: cy, x2: Math.max(a.left, b.left), y2: cy, label: Math.abs(b.left - a.left) / scale });
    if (bR !== aR) lines.push({ x1: Math.min(aR, bR), y1: cy + 10, x2: Math.max(aR, bR), y2: cy + 10, label: Math.abs(bR - aR) / scale });
  }
  if (bB <= a.top) lines.push({ x1: cx, y1: bB, x2: cx, y2: a.top, label: (a.top - bB) / scale });
  else if (b.top >= aB) lines.push({ x1: cx, y1: aB, x2: cx, y2: b.top, label: (b.top - aB) / scale });
  else {
    if (b.top !== a.top) lines.push({ x1: cx, y1: Math.min(a.top, b.top), x2: cx, y2: Math.max(a.top, b.top), label: Math.abs(b.top - a.top) / scale });
    if (bB !== aB) lines.push({ x1: cx + 10, y1: Math.min(aB, bB), x2: cx + 10, y2: Math.max(aB, bB), label: Math.abs(bB - aB) / scale });
  }
  return (
    <svg className={s.measure}>
      <rect x={b.left} y={b.top} width={b.width} height={b.height} className={s.measureTarget} />
      {lines.map((l, i) => (
        <g key={i}>
          <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
          <foreignObject x={(l.x1 + l.x2) / 2 - 24} y={(l.y1 + l.y2) / 2 - 9} width={48} height={18}>
            <div className={s.measureLabel}>{Math.round(l.label)}</div>
          </foreignObject>
        </g>
      ))}
    </svg>
  );
}

function ContextToolbar({ rect }: { rect: ScreenRect }) {
  const info = useStudio((st) => st.selection.info);
  const instanceId = useStudio((st) => st.selection.instanceId);
  if (!info) return null;
  const above = rect.top > 52;
  const hidden = isHidden(info.selector);
  return (
    <div
      className={s.contextBar}
      role="toolbar"
      aria-label="Selection"
      style={{ left: Math.max(8, rect.left), top: above ? rect.top - 44 : rect.top + rect.height + 34 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className={s.contextLabel}>{info.component?.name ?? info.label}</span>
      {info.editableText && (
        <IconButton size="sm" label="Edit text" shortcut="Enter" onClick={() => previews.get(instanceId)?.call('text.beginEdit', { id: info.id })}>
          <Type size={13} />
        </IconButton>
      )}
      <IconButton size="sm" label="Inspect CSS" onClick={() => studio().setRightTab('styles')}>
        <Code2 size={13} />
      </IconButton>
      <IconButton size="sm" label="Adjust spacing" onClick={() => studio().setRightTab('box')}>
        <Ruler size={13} />
      </IconButton>
      <IconButton size="sm" label="Copy selector" onClick={() => copyText(info.selector, 'Selector copied')}>
        <Copy size={13} />
      </IconButton>
      <IconButton size="sm" label="Copy CSS" onClick={() => copyText(cssForInfo(info), 'CSS copied')}>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '-0.02em' }}>CSS</span>
      </IconButton>
      <IconButton size="sm" label={hidden ? 'Show in preview' : 'Hide in preview'} active={hidden} onClick={() => toggleHidden(info)}>
        {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
      </IconButton>
      <IconButton size="sm" label="Save as reusable style" onClick={() => saveSelectionAsStyle()}>
        <BookmarkPlus size={13} />
      </IconButton>
      {info.component && (
        <IconButton size="sm" label="Component mapping" onClick={() => studio().setRightTab('component')}>
          <Puzzle size={13} />
        </IconButton>
      )}
      <IconButton size="sm" label="Diagnose with AI" tone="violet" onClick={() => bus.emit('ai-diagnose', { nodeId: info.id })}>
        <Sparkles size={13} />
      </IconButton>
    </div>
  );
}
