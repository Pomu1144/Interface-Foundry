import { useCallback, useEffect, useRef } from 'react';
import { studio, useStudio } from '@/store';
import { bus } from '@/lib/events';

/** True while Space is held for temporary panning (read by device drag handlers). */
export const panKey = { down: false };

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Zoom around a point in canvas-local screen coordinates. */
export function zoomAt(factor: number, cx: number, cy: number) {
  const { camera, setCamera } = studio();
  const zoom = clampZoom(camera.zoom * factor);
  const k = zoom / camera.zoom;
  setCamera({ zoom, x: cx - (cx - camera.x) * k, y: cy - (cy - camera.y) * k });
}

/**
 * Canvas camera interactions: trackpad/wheel pan, ctrl/⌘ + wheel or pinch zoom,
 * space/middle-button drag to pan, and zoom gestures forwarded from previews.
 */
export function useCameraControls(ref: React.RefObject<HTMLDivElement | null>, onPanChange: (panning: boolean) => void) {
  const spaceDown = useRef(false);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const tool = useStudio((s) => s.tool);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022));
        zoomAt(factor, e.clientX - r.left, e.clientY - r.top);
      } else {
        const { camera, setCamera } = studio();
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        setCamera({ x: camera.x - dx, y: camera.y - dy });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    const offWheel = bus.on('agent-wheel', (w) => {
      // ctrl+wheel inside a preview: zoom around the preview element's pointer position.
      const frame = document.querySelector<HTMLElement>(`[data-instance="${w.instanceId}"]`);
      const r = el.getBoundingClientRect();
      if (!frame) return;
      const fr = frame.getBoundingClientRect();
      const scale = fr.width / (frame.offsetWidth || 1);
      const factor = Math.exp(-w.deltaY * 0.0022);
      zoomAt(factor, fr.left + w.clientX * scale - r.left, fr.top + w.clientY * scale - r.top);
    });
    return () => {
      el.removeEventListener('wheel', onWheel);
      offWheel();
    };
  }, [ref]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !isTyping(e)) {
        spaceDown.current = true;
        panKey.down = true;
        onPanChange(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown.current = false;
        panKey.down = false;
        if (!drag.current) onPanChange(studio().tool === 'pan');
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [onPanChange]);

  useEffect(() => onPanChange(tool === 'pan'), [tool, onPanChange]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const background = e.target === e.currentTarget || (e.target as HTMLElement).dataset.canvasBg !== undefined;
      if (e.button === 1 || spaceDown.current || studio().tool === 'pan' || (background && e.button === 0 && e.altKey)) {
        e.preventDefault();
        const { camera } = studio();
        drag.current = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        onPanChange(true);
        return true;
      }
      if (background && e.button === 0) {
        studio().select(null, null);
      }
      return false;
    },
    [onPanChange],
  );
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    studio().setCamera({ x: d.cx + (e.clientX - d.x), y: d.cy + (e.clientY - d.y) });
  }, []);
  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!drag.current) return;
      drag.current = null;
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      onPanChange(spaceDown.current || studio().tool === 'pan');
    },
    [onPanChange],
  );
  return { onPointerDown, onPointerMove, onPointerUp };
}

export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || Boolean(t.closest?.('.cm-editor'));
}
