import { Layers3, Maximize, Minus, Plus, RotateCcw, Square } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import type { Hierarchy3DNode } from '@shared/protocol';
import { IconButton, Segmented, Slider, Tooltip } from '@/ui';
import { studio, useStudio } from '@/store';
import { previews } from '@/modules/preview-runtime/registry';
import { refreshSelection, watchOverlayIds } from '@/modules/preview-runtime/sync';
import { DEFAULT_SPACING, engine, type LabelSpec } from './engine';
import { depthT, fillFor, isLevelVisible, perspectiveFor, PRESETS, textSizeFor, unionBounds, type Bounds, type DepthFilter, type PresetName, type Tree } from './math';
import { setView, useH3D } from './state';
import s from './hierarchy.module.css';

type PlaneState = '' | 'sel' | 'path';
const MAX_SPACING = 120;
const MAX_LABELS = 56;

/* ------------------------------------------------------------------ */
/* Planes                                                              */
/* ------------------------------------------------------------------ */

const Plane = memo(function Plane({ n, i, state }: { n: Hierarchy3DNode; i: number; state: PlaneState }) {
  const style: Record<string, string | number> = { left: n.rect.x, top: n.rect.y, width: n.rect.width, height: n.rect.height };
  const fill = fillFor(n.bg);
  if (fill) style['--fill'] = fill;
  if (n.isImage) style['--bp'] = `${-n.rect.x}px ${-n.rect.y}px`;
  return (
    <div
      className={s.plane}
      data-i={i}
      data-kind={n.isImage ? 'image' : n.text ? 'text' : 'box'}
      data-bgimg={n.bg === 'image' ? 'true' : undefined}
      data-state={state || undefined}
      style={style as CSSProperties}
    >
      {n.text && (
        <span className={s.text} style={{ fontSize: textSizeFor(n.rect.height) }}>
          {n.text}
        </span>
      )}
    </div>
  );
});

const Layer = memo(function Layer({
  depth,
  t,
  indices,
  nodes,
  selIndex,
  path,
  hidden,
}: {
  depth: number;
  t: number;
  indices: number[];
  nodes: readonly Hierarchy3DNode[];
  selIndex: number | null;
  path: ReadonlySet<number>;
  hidden: boolean;
}) {
  const ref = useCallback((el: HTMLDivElement | null) => engine.layerRef(depth, el), [depth]);
  return (
    <div ref={ref} className={s.layer} data-depth={depth} style={{ '--t': t, display: hidden ? 'none' : undefined } as CSSProperties}>
      {indices.map((i) => (
        <Plane key={nodes[i].id} n={nodes[i]} i={i} state={i === selIndex ? 'sel' : path.has(i) ? 'path' : ''} />
      ))}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Stage                                                               */
/* ------------------------------------------------------------------ */

export type StageProps = {
  nodes: readonly Hierarchy3DNode[];
  tree: Tree;
  byDepth: Map<number, number[]>;
  filter: DepthFilter;
  selIndex: number | null;
  path: ReadonlySet<number>;
  /** Bounds of what is currently shown (fit / double-click on empty space). */
  visibleBounds: Bounds;
};

export function Stage({ nodes, tree, byDepth, filter, selIndex, path, visibleBounds }: StageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const hudZoomRef = useRef<HTMLSpanElement>(null);
  const hudAnglesRef = useRef<HTMLSpanElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);

  const shot = useH3D((st) => (st.showShot ? st.shot : null));
  const labels = useH3D((st) => st.labels);
  const wireframe = useH3D((st) => st.wireframe);
  const route = useH3D((st) => st.route);
  const reduced = useStudio((st) => st.settings.reducedMotion);
  const gridRef = useCallback((el: HTMLDivElement | null) => engine.gridRef(el), []);
  const baseRef = useCallback((el: HTMLDivElement | null) => engine.baseRef(el), []);

  // Latest values for imperative callbacks.
  const live = useRef({ selIndex, visibleBounds });
  live.current = { selIndex, visibleBounds };

  useLayoutEffect(() => {
    const stage = stageRef.current!;
    engine.attach(
      { stage, pan: panRef.current!, world: worldRef.current!, tip: tipRef.current!, hudZoom: hudZoomRef.current, hudAngles: hudAnglesRef.current },
      {
        onPick: (i) => pick(i),
        onFocusRequest: (i) => (i === null ? engine.fit(live.current.visibleBounds) : engine.focusNode(i)),
        onHover: () => {},
      },
    );
    return () => engine.release();
  }, []);

  useEffect(() => {
    engine.noMotion = reduced;
  }, [reduced]);

  useLayoutEffect(() => engine.setNodes(nodes), [nodes]);

  // Scene bounds: every box plus the screenshot plate one level below the root.
  const baseDepth = tree.minDepth - 1;
  const sceneBounds = useMemo(() => {
    const b = { ...tree.bounds, d0: baseDepth };
    return shot ? unionBounds(b, { x0: 0, y0: 0, x1: shot.docW, y1: shot.docH, d0: baseDepth, d1: baseDepth }) : b;
  }, [tree, baseDepth, shot]);
  const perspective = useMemo(() => perspectiveFor(sceneBounds, MAX_SPACING), [sceneBounds]);

  useLayoutEffect(() => {
    const st = useH3D.getState();
    engine.setScene(sceneBounds, baseDepth, route || 'page', perspective, { intro: true, exploded: st.exploded, spacing: st.spacing });
  }, [sceneBounds, baseDepth, perspective, route]);

  useEffect(() => {
    const offEx = useH3D.subscribe(
      (st) => st.exploded,
      (ex) => engine.setExploded(ex, useH3D.getState().spacing),
    );
    const offSp = useH3D.subscribe(
      (st) => st.spacing,
      (sp) => {
        if (useH3D.getState().exploded) engine.setSpacing(sp, false);
      },
    );
    return () => {
      offEx();
      offSp();
    };
  }, []);

  // Isolate / filter changes re-frame what is visible.
  const boundsKey = `${visibleBounds.x0}|${visibleBounds.y0}|${visibleBounds.x1}|${visibleBounds.y1}|${visibleBounds.d0}|${visibleBounds.d1}`;
  const firstBounds = useRef(true);
  useEffect(() => {
    if (firstBounds.current) {
      firstBounds.current = false;
      return;
    }
    engine.fit(live.current.visibleBounds);
  }, [boundsKey]);

  /* Labels ---------------------------------------------------------- */
  const labelSpecs = useMemo<(LabelSpec & { label: string; t: number; state: PlaneState })[]>(() => {
    if (!labels) return [];
    const cands: { i: number; prio: number }[] = [];
    for (const [d, idx] of byDepth) {
      if (!isLevelVisible(d, filter)) continue;
      for (const i of idx) {
        const r = nodes[i].rect;
        const area = r.width * r.height;
        const onPath = path.has(i);
        if (!onPath && (area < 1600 || r.width < 40)) continue;
        cands.push({ i, prio: (i === selIndex ? 4e9 : onPath ? 2e9 : 0) + area / Math.sqrt(1 + nodes[i].depth * 0.15) });
      }
    }
    cands.sort((a, b) => b.prio - a.prio);
    return cands.slice(0, MAX_LABELS).map(({ i }) => {
      const n = nodes[i];
      return { i, x: n.rect.x, y: n.rect.y, w: n.rect.width, depth: n.depth, label: n.label, t: depthT(n.depth, tree.minDepth, tree.maxDepth), state: i === selIndex ? 'sel' : path.has(i) ? 'path' : '' };
    });
  }, [labels, byDepth, filter, nodes, path, selIndex, tree]);

  useLayoutEffect(() => {
    const host = labelsRef.current;
    const els = host ? ([...host.children] as HTMLElement[]) : [];
    engine.setLabels(
      labelSpecs,
      els,
      els.map((el) => ({ w: el.offsetWidth, h: el.offsetHeight })),
    );
  }, [labelSpecs]);

  /* Keyboard -------------------------------------------------------- */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-ui]')) return;
    const mod = e.metaKey || e.ctrlKey;
    const step = e.shiftKey ? 45 : 15;
    let handled = true;
    if (mod) {
      if (e.key === '=' || e.key === '+') engine.zoomBy(1.25);
      else if (e.key === '-') engine.zoomBy(1 / 1.25);
      else handled = false;
    } else if (e.altKey) handled = false;
    else
      switch (e.key) {
        case 'ArrowLeft':
          engine.rotateBy(-step, 0);
          break;
        case 'ArrowRight':
          engine.rotateBy(step, 0);
          break;
        case 'ArrowUp':
          engine.rotateBy(0, step);
          break;
        case 'ArrowDown':
          engine.rotateBy(0, -step);
          break;
        case '+':
        case '=':
          engine.zoomBy(1.25);
          break;
        case '-':
        case '_':
          engine.zoomBy(1 / 1.25);
          break;
        case '0':
          engine.reset();
          break;
        case '!':
          engine.fit(live.current.visibleBounds);
          break;
        case '1':
        case '2':
        case '3':
        case '4':
          if (e.shiftKey) engine.fit(live.current.visibleBounds);
          else engine.preset((['front', 'left', 'right', 'top'] as const)[Number(e.key) - 1]);
          break;
        case 'f':
        case 'F':
          if (live.current.selIndex !== null) engine.focusNode(live.current.selIndex);
          else engine.fit(live.current.visibleBounds);
          break;
        case 'e':
        case 'E':
          setView({ exploded: !useH3D.getState().exploded });
          break;
        default:
          handled = false;
      }
    if (handled) e.preventDefault();
  };

  const levels = tree.levels;
  const stageStyle = shot ? ({ '--shot': `url("${shot.url}")`, '--shot-size': `${shot.docW}px ${shot.docH}px` } as CSSProperties) : undefined;
  const gridRect = {
    left: sceneBounds.x0 - (sceneBounds.x1 - sceneBounds.x0) * 0.9,
    top: sceneBounds.y0 - (sceneBounds.y1 - sceneBounds.y0) * 0.35,
    width: (sceneBounds.x1 - sceneBounds.x0) * 2.8,
    height: (sceneBounds.y1 - sceneBounds.y0) * 1.7,
  };

  return (
    <div
      ref={stageRef}
      className={s.stage}
      tabIndex={0}
      role="application"
      aria-label="3D view hierarchy. Drag to orbit, Shift-drag to pan, scroll to zoom, arrow keys rotate, F focuses the selection."
      data-testid="hierarchy-stage"
      data-wire={wireframe ? '' : undefined}
      data-shot={shot ? '' : undefined}
      data-sel={selIndex !== null ? '' : undefined}
      style={stageStyle}
      onKeyDown={onKeyDown}
    >
      <div className={s.vignette} />
      <div ref={panRef} className={s.pan}>
        <div ref={worldRef} className={s.world}>
          <div ref={gridRef} className={s.grid} style={gridRect} />
          <div
            ref={baseRef}
            className={s.base}
            style={{ width: shot?.docW ?? Math.max(1, tree.bounds.x1), height: shot?.docH ?? Math.max(1, tree.bounds.y1) }}
          >
            {shot ? <img src={shot.url} alt="" draggable={false} /> : <div className={s.baseEmpty} />}
          </div>
          {levels.map((l) => (
            <Layer
              key={l.depth}
              depth={l.depth}
              t={depthT(l.depth, tree.minDepth, tree.maxDepth)}
              indices={byDepth.get(l.depth) ?? EMPTY}
              nodes={nodes}
              selIndex={selIndex}
              path={path}
              hidden={!isLevelVisible(l.depth, filter)}
            />
          ))}
        </div>
      </div>

      <div ref={labelsRef} className={s.labels} aria-hidden>
        {labelSpecs.map((l) => (
          <div key={l.i} className={s.label} data-state={l.state || undefined} style={{ '--t': l.t } as CSSProperties}>
            <span className={s.labelDot} />
            <span className={s.labelText}>{l.label}</span>
          </div>
        ))}
      </div>

      <div ref={tipRef} className={s.tip} aria-hidden>
        <div className={s.tipHead}>
          <span className={s.tipSwatch} data-tip="fill" />
          <span className={s.tipLabel} data-tip="label" />
        </div>
        <div className={s.tipMeta}>
          <b data-tip="dims" />
          <span data-tip="depth" />
          <span data-tip="pos" />
          <span className={s.tipKind} data-tip="kind" />
        </div>
        <div className={s.tipText} data-tip="text" />
      </div>

      <Dock />

      <div className={s.hud} data-ui onPointerDown={(e) => e.stopPropagation()}>
        <span className={s.hudAngles} ref={hudAnglesRef} title="Yaw · pitch" />
        <IconButton size="sm" label="Zoom out" shortcut="-" tooltipSide="top" onClick={() => engine.zoomBy(1 / 1.25)}>
          <Minus size={13} />
        </IconButton>
        <span className={s.hudValue} ref={hudZoomRef} />
        <IconButton size="sm" label="Zoom in" shortcut="+" tooltipSide="top" onClick={() => engine.zoomBy(1.25)}>
          <Plus size={13} />
        </IconButton>
        <IconButton size="sm" label="Fit to view" shortcut="Shift+1" tooltipSide="top" onClick={() => engine.fit(live.current.visibleBounds)}>
          <Maximize size={12} />
        </IconButton>
      </div>

      <div className={s.hint} aria-hidden>
        <span>
          <kbd>drag</kbd> orbit
        </span>
        <span>
          <kbd>⇧ drag</kbd> pan
        </span>
        <span>
          <kbd>scroll</kbd> zoom
        </span>
        <span>
          <kbd>double-click</kbd> focus
        </span>
      </div>
    </div>
  );
}

const EMPTY: number[] = [];

/** Select the clicked element in the studio (or clear on empty space). */
function pick(i: number | null) {
  const st = useH3D.getState();
  if (i === null) {
    if (studio().selection.nodeId !== null) studio().select(null, null);
    return;
  }
  const n = st.nodes[i];
  if (!n) return;
  const instanceId = st.sourceId ?? previews.primary()?.id ?? 'primary';
  studio().select(instanceId, n.id);
  void refreshSelection();
  watchOverlayIds();
}

/* ------------------------------------------------------------------ */
/* Dock                                                                */
/* ------------------------------------------------------------------ */

const PRESET_OPTIONS: { value: PresetName; label: string; title: string }[] = [
  { value: 'front', label: 'Front', title: 'Front (1)' },
  { value: 'left', label: '¾ Left', title: '¾ left (2)' },
  { value: 'right', label: '¾ Right', title: '¾ right (3)' },
  { value: 'top', label: 'Top', title: 'Top (4)' },
];

function Dock() {
  const exploded = useH3D((st) => st.exploded);
  const spacing = useH3D((st) => st.spacing);
  return (
    <div className={s.dock} data-ui onPointerDown={(e) => e.stopPropagation()} data-testid="hierarchy-dock">
      <PresetButtons />
      <span className={s.dockDiv} />
      <Segmented
        ariaLabel="Flatten or explode"
        value={exploded ? 'explode' : 'flat'}
        onChange={(v) => setView({ exploded: v === 'explode' })}
        options={[
          { value: 'flat', label: 'Flatten', icon: <Square size={12} />, title: 'Flatten to 2D (E)' },
          { value: 'explode', label: 'Explode', icon: <Layers3 size={12} />, title: 'Explode layers (E)' },
        ]}
      />
      <span className={s.dockDiv} />
      <div className={s.spacingCtl} title="Distance between depth levels">
        <div className={s.spacingSlider}>
          <Slider
            ariaLabel="Layer spacing"
            min={4}
            max={MAX_SPACING}
            step={1}
            value={exploded ? spacing : 4}
            onChange={(v) => setView(exploded ? { spacing: v } : { spacing: v, exploded: true })}
          />
        </div>
        <span className={s.dockValue}>{exploded ? `${Math.round(spacing)}px` : 'flat'}</span>
      </div>
      <span className={s.dockDiv} />
      <IconButton
        size="sm"
        label="Reset camera"
        shortcut="0"
        tooltipSide="top"
        onClick={() => {
          if (!useH3D.getState().exploded) setView({ exploded: true, spacing: useH3D.getState().spacing || DEFAULT_SPACING });
          engine.reset();
        }}
      >
        <RotateCcw size={13} />
      </IconButton>
    </div>
  );
}

/** Camera presets, each with a tiny CSS-3D glyph of the stack seen from that angle. */
function PresetButtons() {
  return (
    <div className={s.presets} role="group" aria-label="Camera presets">
      {PRESET_OPTIONS.map((p) => {
        const a = PRESETS[p.value];
        return (
          <Tooltip key={p.value} content={p.title} side="top">
            <button type="button" className={s.presetBtn} onClick={() => engine.preset(p.value)} aria-label={p.title}>
              <span className={s.glyph} aria-hidden>
                <span className={s.glyphWorld} style={{ transform: `rotateX(${a.pitch}deg) rotateY(${a.yaw}deg)` }}>
                  {[0, 1, 2].map((k) => (
                    <span key={k} className={s.glyphPlane} style={{ '--t': k / 2, transform: `translateZ(${(k - 1) * 3.2}px)` } as CSSProperties} />
                  ))}
                </span>
              </span>
              <span className={s.presetLabel}>{p.label}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
