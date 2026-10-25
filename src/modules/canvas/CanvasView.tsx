import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DeviceProfile, Orientation, Posture, PostureGeometry, PreviewEngine } from '@shared/types';
import { studio, useStudio } from '@/store';
import { resolveTransition, resolveViewport, fitScale } from '@/modules/device-simulator/viewport';
import { RESPONSIVE_ID, BUILT_IN_DEVICES } from '@/modules/device-simulator/devices';
import { Artboard } from './Artboard';
import { FoldDock } from './FoldDock';
import { SelectionOverlay } from './SelectionOverlay';
import { ZoomHud } from './ZoomHud';
import { Rulers } from './Rulers';
import { BreakpointBar } from './BreakpointBar';
import { useCameraControls } from './useCamera';
import { CanvasContextMenu } from './CanvasContextMenu';
import s from './canvas.module.css';

const GAP = 140;

type BoardSpec = {
  instanceId: string;
  role: 'primary' | 'compare';
  device: DeviceProfile;
  posture: Posture;
  orientation: Orientation;
  geometry: PostureGeometry;
  /** Both postures, for the 3D hinge frame of foldables. */
  folded: PostureGeometry;
  expanded: PostureGeometry | null;
  progress: number;
  animating: boolean;
  /** Set for "Duplicate into" copies of the view. */
  duplicateId?: string;
  engine: PreviewEngine;
  /** Width reserved in the layout (max of folded/expanded) so boards never overlap mid-animation. */
  slotWidth: number;
  frameHeight: number;
};

function frameDims(g: PostureGeometry, bare: boolean) {
  const b = bare ? { left: 0, right: 0, top: 0, bottom: 0 } : g.bezel;
  return { w: g.screen.width + b.left + b.right, h: g.screen.height + b.top + b.bottom };
}

export function CanvasView() {
  const ref = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState(false);
  const camera = useStudio((st) => st.camera);
  const viewport = useStudio((st) => st.viewport);
  // In the 3D hinge style the frame animates through CSS variables (motion.ts), so the
  // canvas only re-renders when the content posture flips, not on every frame.
  const style = useStudio((st) => st.transition.style);
  const mode = useStudio((st) => st.transition.mode);
  const playing = useStudio((st) => st.transition.playing);
  const flatProgress = useStudio((st) => (st.transition.style === 'reflow' ? st.transition.progress : -1));
  const compare = useStudio((st) => st.compare);
  const duplicates = useStudio((st) => st.duplicates);
  const customDevices = useStudio((st) => st.customDevices);
  const responsiveSize = useStudio((st) => st.responsiveSize);
  const source = useStudio((st) => st.source);
  const tool = useStudio((st) => st.tool);
  const showRulers = useStudio((st) => st.settings.showRulers);

  const device = useMemo(() => studio().device(), [viewport.deviceId, customDevices, responsiveSize]); // eslint-disable-line react-hooks/exhaustive-deps

  const boards = useMemo<BoardSpec[]>(() => {
    const list: BoardSpec[] = [];
    const flat = style === 'reflow';
    const inFlight = flat && Boolean(device.expanded) && (playing || (flatProgress > 0 && flatProgress < 1));
    const geometry = inFlight
      ? resolveTransition(device, viewport.orientation, flatProgress, mode)
      : resolveViewport(device, viewport.posture, viewport.orientation).geometry;
    const foldedG = resolveViewport(device, 'folded', viewport.orientation).geometry;
    const expandedG = device.expanded ? resolveViewport(device, 'expanded', viewport.orientation).geometry : null;
    const bare = device.frameStyle === 'bare';
    const slotW = Math.max(
      frameDims(resolveViewport(device, 'folded', viewport.orientation).geometry, bare).w,
      device.expanded ? frameDims(resolveViewport(device, 'expanded', viewport.orientation).geometry, bare).w : 0,
    );
    list.push({
      instanceId: 'primary',
      role: 'primary',
      engine: viewport.engine ?? 'auto',
      device,
      posture: viewport.posture,
      orientation: viewport.orientation,
      geometry,
      folded: foldedG,
      expanded: expandedG,
      progress: inFlight ? flatProgress : viewport.posture === 'expanded' ? 1 : 0,
      animating: inFlight || (!flat && playing),
      slotWidth: slotW,
      frameHeight: Math.max(frameDims(geometry, bare).h, frameDims(foldedG, bare).h, expandedG ? frameDims(expandedG, bare).h : 0),
    });
    if (compare.enabled) {
      const pd =
        compare.partner.deviceId === RESPONSIVE_ID
          ? device
          : [...BUILT_IN_DEVICES, ...customDevices].find((d) => d.id === compare.partner.deviceId) ?? device;
      const pg = resolveViewport(pd, compare.partner.posture, compare.partner.orientation).geometry;
      list.push({
        instanceId: 'compare',
        role: 'compare',
        engine: compare.partner.engine ?? 'auto',
        device: pd,
        posture: pd.expanded ? compare.partner.posture : 'folded',
        orientation: compare.partner.orientation,
        geometry: pg,
        folded: resolveViewport(pd, 'folded', compare.partner.orientation).geometry,
        expanded: pd.expanded ? resolveViewport(pd, 'expanded', compare.partner.orientation).geometry : null,
        progress: compare.partner.posture === 'expanded' ? 1 : 0,
        animating: false,
        slotWidth: frameDims(pg, pd.frameStyle === 'bare').w,
        frameHeight: frameDims(pg, pd.frameStyle === 'bare').h,
      });
    }
    const all = [...BUILT_IN_DEVICES, ...customDevices];
    for (const dup of duplicates) {
      const dd = dup.deviceId === RESPONSIVE_ID ? device : all.find((d) => d.id === dup.deviceId);
      if (!dd) continue;
      const posture = dd.expanded ? dup.posture : 'folded';
      const dg = resolveViewport(dd, posture, dup.orientation).geometry;
      const fg = resolveViewport(dd, 'folded', dup.orientation).geometry;
      const eg = dd.expanded ? resolveViewport(dd, 'expanded', dup.orientation).geometry : null;
      const b = dd.frameStyle === 'bare';
      list.push({
        instanceId: `dup-${dup.id}`,
        role: 'compare',
        duplicateId: dup.id,
        engine: dup.engine ?? 'auto',
        device: dd,
        posture,
        orientation: dup.orientation,
        geometry: dg,
        folded: fg,
        expanded: eg,
        progress: posture === 'expanded' ? 1 : 0,
        animating: false,
        slotWidth: Math.max(frameDims(dg, b).w, frameDims(fg, b).w, eg ? frameDims(eg, b).w : 0),
        frameHeight: Math.max(frameDims(dg, b).h, frameDims(fg, b).h, eg ? frameDims(eg, b).h : 0),
      });
    }
    return list;
  }, [device, viewport, style, mode, playing, flatProgress, compare, duplicates, customDevices]);

  // Fit the boards into view when asked (device change, compare toggle, Shift+1).
  const contentSize = useMemo(() => {
    const width = boards.reduce((sum, b, i) => sum + b.slotWidth + (i ? GAP : 0), 0);
    const height = Math.max(...boards.map((b) => b.frameHeight)) + 120;
    return { width, height };
  }, [boards]);
  const lastFit = useRef(-1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (lastFit.current === camera.fitNonce) return;
    lastFit.current = camera.fitNonce;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const zoom = fitScale(contentSize, { width: r.width, height: r.height - 70 }, 56, 1);
    studio().setCamera({
      zoom,
      x: (r.width - contentSize.width * zoom) / 2,
      y: Math.max(40, (r.height - 70 - contentSize.height * zoom) / 2 + 30),
    });
  }, [camera.fitNonce, contentSize]);

  // Initial fit once the canvas has a size.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (lastFit.current <= 0) studio().fitCamera();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onPan = useCallback((p: boolean) => setPanning(p), []);
  const handlers = useCameraControls(ref, onPan);

  const gridSize = 24 * camera.zoom;
  let x = 0;
  return (
    <CanvasContextMenu>
      <div
        ref={ref}
        className={s.canvas}
        data-ifdy-canvas
        data-panning={panning ? 'true' : undefined}
        data-tool={tool}
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        style={{
          backgroundSize: `${gridSize}px ${gridSize}px`,
          backgroundPosition: `${camera.x}px ${camera.y}px`,
        }}
      >
        <div className={s.vignette} data-canvas-bg />
        <div className={s.world} style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }} data-canvas-bg>
          {source &&
            boards.map((b, i) => {
              const left = x;
              x += b.slotWidth + GAP;
              void i;
              return (
                <div key={b.instanceId} className={s.boardSlot} style={{ left, width: b.slotWidth }}>
                  {b.role === 'primary' && <BreakpointBar width={b.geometry.viewport.width} zoom={camera.zoom} offset={(b.device.frameStyle === 'bare' ? 0 : b.geometry.bezel.left) + b.geometry.safeArea.left} />}
                  <Artboard spec={b} interactive={!panning} zoom={camera.zoom} />
                </div>
              );
            })}
        </div>
        <SelectionOverlay container={ref} />
        {showRulers && source && <Rulers container={ref} />}
        <FoldDock />
        <ZoomHud />
      </div>
    </CanvasContextMenu>
  );
}

export type { BoardSpec };
