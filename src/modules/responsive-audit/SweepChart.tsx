import { useMemo, useRef, useState } from 'react';
import { overflowZones, type SweepPoint } from './sweep-math';
import { useWidth } from './bits';
import s from './responsive-tab.module.css';

const X_MIN = 320;
const X_MAX = 1600;
const M = { top: 14, right: 12, bottom: 26, left: 38 };

function niceStep(max: number, count = 4) {
  const raw = max / count;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n >= 5 ? 10 : n >= 2 ? 5 : n >= 1 ? 2 : 1) * pow;
}

/** Split into runs of consecutive visible points so hidden widths show as gaps. */
function segments(points: SweepPoint[], key: 'width' | 'right') {
  const out: { vw: number; v: number }[][] = [];
  let cur: { vw: number; v: number }[] = [];
  for (const p of points) {
    if (p.visible) cur.push({ vw: p.vw, v: p[key] });
    else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

function hiddenRanges(points: SweepPoint[]) {
  const out: { from: number; to: number; absent: boolean }[] = [];
  let cur: { from: number; to: number; absent: boolean } | null = null;
  for (const p of points) {
    if (!p.visible) {
      if (!cur) cur = { from: p.vw, to: p.vw, absent: !p.present };
      else cur.to = p.vw;
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Responsive sweep: element width and right edge across viewport widths,
 * against the viewport edge (y = x). Overflow zones are shaded; device
 * profile widths are ticked; breakpoints are drawn as hairlines.
 */
export function SweepChart({
  points,
  devices,
  breakpoints,
  currentWidth,
  running,
}: {
  points: SweepPoint[];
  devices: { width: number; name: string }[];
  breakpoints: number[];
  currentWidth: number | null;
  running: boolean;
}) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<SweepPoint | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const W = Math.max(220, width);
  const H = 196;
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;

  const yMax = useMemo(() => {
    const m = points.reduce((a, p) => (p.visible ? Math.max(a, p.right, p.width) : a), 0);
    const step = niceStep(Math.max(80, m * 1.08));
    return Math.ceil((Math.max(80, m * 1.08)) / step) * step;
  }, [points]);
  const x = (vw: number) => M.left + ((vw - X_MIN) / (X_MAX - X_MIN)) * iw;
  const y = (v: number) => M.top + ih - (Math.min(v, yMax * 1.5) / yMax) * ih;
  const yStep = niceStep(yMax);
  const yTicks: number[] = [];
  for (let v = 0; v <= yMax + 0.1; v += yStep) yTicks.push(v);
  const xTicks = [320, 640, 960, 1280, 1600];

  const zones = overflowZones(points);
  const hidden = hiddenRanges(points);
  const step = points.length > 1 ? Math.min(...points.slice(1).map((p, i) => p.vw - points[i].vw)) : 40;
  const half = Math.max(4, (step / (X_MAX - X_MIN)) * iw * 0.5);
  const path = (seg: { vw: number; v: number }[]) => seg.map((p, i) => `${i ? 'L' : 'M'}${x(p.vw).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  // Viewport edge y = x, clipped to the plot.
  const edgeEnd = Math.min(X_MAX, yMax);

  const onMove = (e: React.PointerEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !points.length) return;
    const vw = X_MIN + ((e.clientX - r.left - M.left) / iw) * (X_MAX - X_MIN);
    let best = points[0];
    for (const p of points) if (Math.abs(p.vw - vw) < Math.abs(best.vw - vw)) best = p;
    setHover(best);
  };

  const device = hover ? devices.filter((d) => d.width === hover.vw) : [];
  const tipLeft = hover ? Math.min(W - 168, Math.max(0, x(hover.vw) + 10)) : 0;

  return (
    <div className={s.chartWrap} ref={wrap}>
      <svg
        ref={svgRef}
        width={W}
        height={H}
        className={s.chart}
        role="img"
        aria-label={`Element width and right edge across viewport widths ${X_MIN}–${X_MAX}px${zones.length ? `; overflows at ${zones.map((z) => `${z.from}–${z.to}px`).join(', ')}` : '; no overflow'}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <pattern id="sweep-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="5" className={s.hatch} />
          </pattern>
          <clipPath id="sweep-plot">
            <rect x={M.left} y={M.top} width={iw} height={ih} />
          </clipPath>
        </defs>

        {/* grid */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={M.left + iw} y1={y(v)} y2={y(v)} className={v === 0 ? s.axis : s.grid} />
            <text x={M.left - 6} y={y(v) + 3} className={s.tick} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {xTicks.map((v) => (
          <text key={v} x={x(v)} y={H - 8} className={s.tick} textAnchor={v === X_MIN ? 'start' : v === X_MAX ? 'end' : 'middle'}>
            {v}
          </text>
        ))}

        <g clipPath="url(#sweep-plot)">
          {/* overflow zones */}
          {zones.map((z) => (
            <rect key={z.from} x={x(z.from) - half} width={x(z.to) - x(z.from) + half * 2} y={M.top} height={ih} className={s.zone} />
          ))}
          {/* hidden ranges */}
          {hidden.map((h) => (
            <rect key={h.from} x={x(h.from) - half} width={x(h.to) - x(h.from) + half * 2} y={M.top} height={ih} fill="url(#sweep-hatch)" className={s.hidden} />
          ))}
          {/* breakpoints */}
          {breakpoints
            .filter((b) => b > X_MIN && b < X_MAX)
            .map((b) => (
              <line key={b} x1={x(b)} x2={x(b)} y1={M.top} y2={M.top + ih} className={s.bp} />
            ))}
          {/* viewport edge */}
          <line x1={x(X_MIN)} y1={y(X_MIN)} x2={x(edgeEnd)} y2={y(edgeEnd)} className={s.edge} />
          {/* series */}
          {segments(points, 'width').map((seg, i) => (
            <path key={`w${i}`} d={path(seg)} className={s.lineWidth} />
          ))}
          {segments(points, 'right').map((seg, i) => (
            <path key={`r${i}`} d={path(seg)} className={s.lineRight} />
          ))}
          {/* current canvas width */}
          {currentWidth !== null && currentWidth >= X_MIN && currentWidth <= X_MAX && (
            <g>
              <line x1={x(currentWidth)} x2={x(currentWidth)} y1={M.top} y2={M.top + ih} className={s.current} />
            </g>
          )}
          {/* hover crosshair */}
          {hover && (
            <g>
              <line x1={x(hover.vw)} x2={x(hover.vw)} y1={M.top} y2={M.top + ih} className={s.cross} />
              {hover.visible && (
                <>
                  <circle cx={x(hover.vw)} cy={y(hover.width)} r={4} className={s.dotWidth} />
                  <circle cx={x(hover.vw)} cy={y(hover.right)} r={4} className={s.dotRight} />
                </>
              )}
            </g>
          )}
        </g>

        {/* device profile ticks */}
        {devices.map((d) => (
          <line key={`${d.width}-${d.name}`} x1={x(d.width)} x2={x(d.width)} y1={M.top + ih + 1} y2={M.top + ih + 5} className={s.deviceTick} />
        ))}
        {currentWidth !== null && currentWidth >= X_MIN && currentWidth <= X_MAX && (
          <text x={x(currentWidth)} y={M.top - 4} className={s.currentLabel} textAnchor="middle">
            canvas {currentWidth}
          </text>
        )}
        {running && points.length > 0 && points.length < 999 && (
          <rect x={x(points[points.length - 1].vw)} y={M.top} width={Math.max(0, M.left + iw - x(points[points.length - 1].vw))} height={ih} className={s.pending} />
        )}
      </svg>

      {hover && (
        <div className={s.tip} style={{ left: tipLeft, top: 10 }}>
          <div className={s.tipHead}>
            Viewport <b>{hover.vw}px</b>
          </div>
          {device.length > 0 && <div className={s.tipDevice}>{device.map((d) => d.name).join(', ')}</div>}
          {!hover.present ? (
            <div className={s.tipMuted}>Not in the DOM at this width</div>
          ) : !hover.visible ? (
            <div className={s.tipMuted}>Hidden at this width</div>
          ) : (
            <>
              <div className={s.tipRow}>
                <span className={s.swWidth} />
                Width <b>{Math.round(hover.width)}</b>
              </div>
              <div className={s.tipRow}>
                <span className={s.swRight} />
                Right edge <b>{Math.round(hover.right)}</b>
              </div>
              <div className={s.tipRow} data-bad={hover.right - hover.vw > 1 ? 'true' : undefined}>
                <span className={s.swEdge} />
                {hover.right - hover.vw > 1 ? (
                  <>
                    Overflows by <b>{Math.round(hover.right - hover.vw)}px</b>
                  </>
                ) : (
                  <>
                    {Math.round(hover.vw - hover.right)}px to the edge
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
