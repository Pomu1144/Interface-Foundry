import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DeviceProfile, Orientation, Posture, PostureGeometry } from '@shared/types';
import { studio, useStudio } from '@/store';
import { resolveTransition, resolveViewport, fitScale } from '@/modules/device-simulator/viewport';
import { RESPONSIVE_ID, BUILT_IN_DEVICES } from '@/modules/device-simulator/devices';
import { Artboard } from './Artboard';
import { FoldDock } from './FoldDock';
import { SelectionOverlay } from './SelectionOverlay';
import { ZoomHud } from './ZoomHud';
import { BreakpointBar } from './BreakpointBar';
import { useCameraControls } from './useCamera';
import s from './canvas.module.css';

const GAP = 140;

type BoardSpec = {
  instanceId: string;
  role: 'primary' | 'compare';
  device: DeviceProfile;
  posture: Posture;
  orientation: Orientation;
  geometry: PostureGeometry;
  progress: number;
  animating: boolean;
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
  const transition = useStudio((st) => st.transition);
  const compare = useStudio((st) => st.compare);
  const customDevices = useStudio((st) => st.customDevices);
  const responsiveSize = useStudio((st) => st.responsiveSize);
  const source = useStudio((st) => st.source);
  const tool = useStudio((st) => st.tool);

  const device = useMemo(() => studio().device(), [viewport.deviceId, customDevices, responsiveSize]); // eslint-disable-line react-hooks/exhaustive-deps

  const boards = useMemo<BoardSpec[]>(() => {
    const list: BoardSpec[] = [];
    const inFlight = Boolean(device.expanded) && (transition.playing || (transition.progress > 0 && transition.progress < 1));
    const geometry = inFlight
      ? resolveTransition(device, viewport.orientation, transition.progress, transition.mode)
      : resolveViewport(device, viewport.posture, viewport.orientation).geometry;
    const bare = device.frameStyle === 'bare';
    const slotW = Math.max(
      frameDims(resolveViewport(device, 'folded', viewport.orientation).geometry, bare).w,
      device.expanded ? frameDims(resolveViewport(device, 'expanded', viewport.orientation).geometry, bare).w : 0,
    );
    list.push({
      instanceId: 'primary',
      role: 'primary',
      device,
      posture: viewport.posture,
      orientation: viewport.orientation,
      geometry,
      progress: inFlight ? transition.progress : viewport.posture === 'expanded' ? 1 : 0,
      animating: inFlight,
      slotWidth: slotW,
      frameHeight: frameDims(geometry, bare).h,
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
        device: pd,
        posture: pd.expanded ? compare.partner.posture : 'folded',
        orientation: compare.partner.orientation,
        geometry: pg,
        progress: compare.partner.posture === 'expanded' ? 1 : 0,
        animating: false,
        slotWidth: frameDims(pg, pd.frameStyle === 'bare').w,
        frameHeight: frameDims(pg, pd.frameStyle === 'bare').h,
      });
    }
    return list;
  }, [device, viewport, transition.playing, transition.progress, transition.mode, compare, customDevices]);

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
    <div
      ref={ref}
      className={s.canvas}
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
      <FoldDock />
      <ZoomHud />
    </div>
  );
}

export type { BoardSpec };
