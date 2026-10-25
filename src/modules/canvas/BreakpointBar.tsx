import { useEffect, useState } from 'react';
import type { BreakpointInfo } from '@shared/protocol';
import { Tooltip } from '@/ui';
import { bus } from '@/lib/events';
import { studio, useStudio } from '@/store';
import { RESPONSIVE_ID } from '@/modules/device-simulator/devices';
import { callPrimary } from '@/modules/preview-runtime/registry';
import s from './canvas.module.css';

/**
 * Media-query bar above the primary device (like DevTools' media query bar):
 * every width breakpoint found in the page's CSS, with the current width marked.
 * Clicking a breakpoint switches to the Responsive device at that width.
 */
export function BreakpointBar({ width, zoom, offset = 0 }: { width: number; zoom: number; offset?: number }) {
  const [bps, setBps] = useState<BreakpointInfo[]>([]);
  const showRulers = useStudio((st) => st.settings.showRulers);
  useEffect(() => {
    const load = () => callPrimary('layout.breakpoints').then(setBps).catch(() => {});
    load();
    return bus.on('preview-hello', ({ instanceId }) => instanceId === 'primary' && load());
  }, []);
  if (!showRulers || !bps.length) return null;
  const marks = new Set<number>();
  for (const b of bps) {
    if (b.min) marks.add(b.min);
    if (b.max) marks.add(b.max);
  }
  const values = [...marks].filter((v) => v > 0 && v <= width + 1).sort((a, b) => a - b);
  const k = 1 / Math.max(0.35, zoom);
  return (
    <div className={s.bpBar} style={{ width, marginLeft: offset, transform: `translateY(${-30 * k}px)` }}>
      <div className={s.bpTrack} style={{ height: 6 * Math.min(2, k) }}>
        {values.map((v) => {
          const active = width >= v;
          return (
            <Tooltip key={v} content={`${v}px — ${bps.filter((b) => b.min === v || b.max === v).map((b) => b.query).join(', ')}`}>
              <button
                className={s.bpMark}
                data-active={active ? 'true' : undefined}
                style={{ left: v, height: 14 * Math.min(2, k), width: 2 * Math.min(2, k) }}
                onClick={() => {
                  const s2 = studio();
                  s2.setResponsiveSize({ width: v, height: s2.instances.primary?.viewport?.height ?? 900 });
                  s2.setViewport({ deviceId: RESPONSIVE_ID });
                }}
                aria-label={`Breakpoint ${v}px`}
              />
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
