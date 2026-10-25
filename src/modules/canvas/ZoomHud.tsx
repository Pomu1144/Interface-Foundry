import { Maximize, Minus, Plus } from 'lucide-react';
import { IconButton, Menu } from '@/ui';
import { studio, useStudio } from '@/store';
import { zoomAt } from './useCamera';
import s from './canvas.module.css';

function zoomCenter(factor: number) {
  const el = document.querySelector<HTMLElement>('[data-ifdy-canvas]') ?? document.body;
  const r = el.getBoundingClientRect();
  zoomAt(factor, r.width / 2, r.height / 2);
}

export function setZoom(z: number) {
  const cur = studio().camera.zoom;
  zoomCenter(z / cur);
}

export function ZoomHud() {
  const zoom = useStudio((st) => st.camera.zoom);
  return (
    <div className={s.zoomHud} onPointerDown={(e) => e.stopPropagation()}>
      <IconButton size="sm" label="Zoom out" shortcut="Mod+-" tooltipSide="top" onClick={() => zoomCenter(1 / 1.25)}>
        <Minus size={13} />
      </IconButton>
      <Menu
        side="top"
        align="end"
        trigger={<button className={s.zoomValue}>{Math.round(zoom * 100)}%</button>}
        items={[
          { label: 'Zoom to fit', shortcut: 'Shift+1', onSelect: () => studio().fitCamera() },
          { label: 'Zoom to 50%', onSelect: () => setZoom(0.5) },
          { label: 'Zoom to 100%', shortcut: 'Shift+0', onSelect: () => setZoom(1) },
          { label: 'Zoom to 200%', onSelect: () => setZoom(2) },
        ]}
      />
      <IconButton size="sm" label="Zoom in" shortcut="Mod+=" tooltipSide="top" onClick={() => zoomCenter(1.25)}>
        <Plus size={13} />
      </IconButton>
      <IconButton size="sm" label="Zoom to fit" shortcut="Shift+1" tooltipSide="top" onClick={() => studio().fitCamera()}>
        <Maximize size={12} />
      </IconButton>
    </div>
  );
}
