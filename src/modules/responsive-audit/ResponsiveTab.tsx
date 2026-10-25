import { Activity, Play, Square } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { BreakpointInfo } from '@shared/protocol';
import type { StylesPayload } from '@shared/types';
import { Badge, Button, Notice, Section, Spinner, Tooltip } from '@/ui';
import { useStudio } from '@/store';
import { describeViewport } from '@/modules/device-simulator/viewport';
import { previews } from '@/modules/preview-runtime/registry';
import { ruleLabel } from './classify';
import { ClassBadge, SevDot, timeAgo } from './bits';
import { isCurrentViewport, revealIn } from './reveal';
import { overflowZones, runSweep, cancelSweep, sweepKey, useSweeps } from './sweep';
import { SweepChart } from './SweepChart';
import { sweepWidths } from './profiles';
import { workerSupport } from './worker';
import s from './responsive-tab.module.css';

type MediaRow = { media: string; selector: string; active: boolean; source: string; props: string[] };

export function ResponsiveTab() {
  const info = useStudio((st) => st.selection.info);
  const instanceId = useStudio((st) => st.selection.instanceId);
  const vpWidth = useStudio((st) => st.instances[st.selection.instanceId ?? 'primary']?.viewport?.width ?? null);
  const route = useStudio((st) => st.currentRoute);
  const changeCount = useStudio((st) => st.changes.length);
  const issues = useStudio((st) => st.responsiveIssues);
  const [styles, setStyles] = useState<StylesPayload | null>(null);
  const [bps, setBps] = useState<BreakpointInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!info) return;
    const conn = previews.get(instanceId) ?? previews.primary();
    if (!conn?.ready) return;
    let alive = true;
    setLoadError(null);
    Promise.all([conn.call('node.styles', { id: info.id }), conn.call('layout.breakpoints')])
      .then(([st, b]) => {
        if (!alive) return;
        setStyles(st);
        setBps(b);
      })
      .catch((e: Error) => alive && setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, [info?.id, instanceId, vpWidth, changeCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const media = useMemo<MediaRow[]>(() => {
    if (!styles) return [];
    const active = new Set(styles.activeMedia);
    const rows: MediaRow[] = [];
    for (const r of [...styles.matched, ...styles.inherited.flatMap((i) => i.rules)]) {
      if (!r.media?.length) continue;
      const q = r.media.join(' and ');
      rows.push({
        media: q,
        selector: r.selector,
        active: r.media.every((m) => active.has(m)),
        source: `${r.source.label}${r.source.line ? `:${r.source.line}` : ''}`,
        props: r.declarations.map((d) => d.property),
      });
    }
    return rows;
  }, [styles]);

  const own = useMemo(() => (info ? issues.filter((i) => i.selector === info.selector || (i.nodeId === info.id && isCurrentViewport(i.viewport))) : []), [issues, info]);

  if (!info) return null;
  const key = sweepKey(info.selector, route, changeCount);

  return (
    <div className={s.root}>
      <SweepSection selector={info.selector} sweepKeyValue={key} currentWidth={vpWidth} breakpoints={bps ?? []} />

      <Section title={<>Media queries{media.length ? <span className={s.count}>{media.length}</span> : null}</>} id="resp-media">
        {loadError ? (
          <Notice tone="warning">{loadError}</Notice>
        ) : !styles ? (
          <div className={s.loading}>
            <Spinner /> Reading matched rules…
          </div>
        ) : !media.length ? (
          <div className={s.hint}>No rule inside a media query applies to this element. Its styles are the same at every width{styles.inaccessibleSheets.length ? ' (except cross-origin stylesheets IFDY cannot read)' : ''}.</div>
        ) : (
          <div className={s.mediaList}>
            {media.map((m, i) => (
              <div key={i} className={s.mediaRow} data-active={m.active ? 'true' : undefined}>
                <div className={s.mediaHead}>
                  <span className={s.mediaDot} />
                  <code className={s.mediaQuery}>@media {m.media}</code>
                  <Badge tone={m.active ? 'success' : 'outline'}>{m.active ? 'Active' : 'Inactive'}</Badge>
                </div>
                <div className={s.mediaMeta}>
                  <code>{m.selector}</code>
                  <span>{m.props.slice(0, 4).join(', ')}{m.props.length > 4 ? ` +${m.props.length - 4}` : ''}</span>
                  <span className={s.src}>{m.source}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={<>Page breakpoints{bps?.length ? <span className={s.count}>{bps.length}</span> : null}</>} id="resp-bps">
        {!bps ? (
          <div className={s.loading}>
            <Spinner /> Scanning stylesheets…
          </div>
        ) : !bps.length ? (
          <div className={s.hint}>The page’s readable stylesheets define no width media queries.</div>
        ) : (
          <BreakpointRuler bps={bps} current={vpWidth} />
        )}
      </Section>

      <Section title={<>Issues for this element{own.length ? <span className={s.count}>{own.length}</span> : null}</>} id="resp-issues">
        {!own.length ? (
          <div className={s.hint}>{issues.length ? 'The last responsive audit found nothing on this element.' : 'Run the responsive audit (Responsive tab in the debug panel) to check this element at every posture.'}</div>
        ) : (
          <div className={s.issueList}>
            {own.map((i) => (
              <button key={i.id} className={s.issue} onClick={() => void revealIn(i.viewport, i.selector, i.nodeId)} title={i.message}>
                <SevDot severity={i.severity} />
                <span className={s.issueText}>
                  <span className={s.issueTitle}>{i.title}</span>
                  <span className={s.issueVp}>
                    {ruleLabel(i.rule)} · {describeViewport(i.viewport)}
                  </span>
                </span>
                <ClassBadge c={i.classification} />
              </button>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function SweepSection({ selector, sweepKeyValue, currentWidth, breakpoints }: { selector: string; sweepKeyValue: string; currentWidth: number | null; breakpoints: BreakpointInfo[] }) {
  const result = useSweeps((st) => st.results[sweepKeyValue]);
  const running = useSweeps((st) => st.running);
  const sup = workerSupport();
  const isRunning = running === sweepKeyValue;
  const otherRunning = Boolean(running && running !== sweepKeyValue);
  const devices = result?.devices ?? sweepWidths().devices;
  const bpLines = useMemo(() => [...new Set(breakpoints.flatMap((b) => [b.min, b.max]).filter((v): v is number => typeof v === 'number'))], [breakpoints]);
  const points = result?.points ?? [];
  const zones = overflowZones(points);
  const hiddenCount = points.filter((p) => !p.visible).length;
  const widths = points.filter((p) => p.visible).map((p) => p.width);

  return (
    <Section
      title={
        <>
          <Activity size={12} style={{ color: 'var(--accent)' }} /> Responsive sweep
        </>
      }
      id="resp-sweep"
      actions={
        isRunning ? (
          <Button size="sm" variant="ghost" icon={<Square size={10} fill="currentColor" />} onClick={cancelSweep}>
            Stop
          </Button>
        ) : (
          <Tooltip content={sup.ok ? 'Measure this element in a background preview at 320–1600px' : sup.reason}>
            <span>
              <Button size="sm" variant={result ? 'ghost' : 'primary'} icon={<Play size={10} fill="currentColor" />} disabled={!sup.ok || otherRunning} onClick={() => void runSweep(selector)}>
                {result ? 'Re-run' : 'Run sweep'}
              </Button>
            </span>
          </Tooltip>
        )
      }
    >
      {!result ? (
        <div className={s.sweepEmpty}>
          <div className={s.ghostChart} aria-hidden>
            <svg viewBox="0 0 280 90" preserveAspectRatio="none">
              <path d="M0 80 L70 52 L120 52 L160 30 L280 30" />
              <path d="M0 70 L70 40 L120 46 L160 18 L280 12" />
            </svg>
          </div>
          <div className={s.hint}>
            Measures <code>{selector.length > 40 ? `${selector.slice(0, 39)}…` : selector}</code> at {sweepWidths().widths.length} widths from 320 to 1600px (every 40px plus every device profile) in a hidden background preview, then charts its width and right edge against the viewport edge.
          </div>
          {!sup.ok && <Notice tone="info">{sup.reason}</Notice>}
        </div>
      ) : (
        <>
          <SweepChart points={points} devices={devices} breakpoints={bpLines} currentWidth={currentWidth} running={isRunning} />
          <div className={s.legend}>
            <span>
              <i className={s.swWidth} /> Element width
            </span>
            <span>
              <i className={s.swRight} /> Right edge
            </span>
            <span>
              <i className={s.swEdge} /> Viewport edge
            </span>
            <span>
              <i className={s.swZone} /> Overflow
            </span>
            <span>
              <i className={s.swBp} /> Breakpoint
            </span>
          </div>
          <div className={s.summary}>
            {isRunning ? (
              <span className={s.loading}>
                <Spinner /> Measuring {points.length}/{result.total}…
              </span>
            ) : result.status === 'error' ? (
              <Notice tone="danger">{result.error}</Notice>
            ) : (
              <>
                {zones.length ? (
                  <span className={s.bad}>
                    Overflows the viewport at {zones.map((z) => (z.from === z.to ? `${z.from}` : `${z.from}–${z.to}`)).join(', ')}px (up to +{Math.round(Math.max(...zones.map((z) => z.max)))}px)
                  </span>
                ) : points.length ? (
                  <span className={s.good}>Stays inside the viewport at every measured width</span>
                ) : null}
                {hiddenCount > 0 && <span>Hidden at {hiddenCount} of {points.length} widths</span>}
                {widths.length > 0 &&
                  (Math.round(Math.min(...widths)) === Math.round(Math.max(...widths)) ? (
                    <span>
                      Fixed width: <b>{Math.round(widths[0])}px</b> at every width where it is visible
                    </span>
                  ) : (
                    <span>
                      Width ranges from <b>{Math.round(Math.min(...widths))}</b> to <b>{Math.round(Math.max(...widths))}px</b>
                    </span>
                  ))}
                <span className={s.muted}>
                  {result.status === 'cancelled' ? 'Stopped' : 'Measured'} {timeAgo(result.at)} · fresh page load, current edits applied
                </span>
              </>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

function BreakpointRuler({ bps, current }: { bps: BreakpointInfo[]; current: number | null }) {
  const MAX = 1600;
  const pos = (v: number) => `${(Math.min(MAX, Math.max(0, v)) / MAX) * 100}%`;
  const list = bps.filter((b) => b.min !== undefined || b.max !== undefined);
  const other = bps.length - list.length;
  return (
    <div>
      <div className={s.ruler}>
        {[0, 400, 800, 1200, 1600].map((t) => (
          <span key={t} className={s.rulerTick} style={{ left: pos(t) }}>
            {t}
          </span>
        ))}
        {list.map((b, i) => {
          const from = b.min ?? 0;
          const to = b.max ?? MAX;
          const on = current !== null && current >= from && current <= to;
          return (
            <Tooltip key={b.query} content={`@media ${b.query} · ${b.count} rule${b.count === 1 ? '' : 's'}`}>
              <span className={s.rulerBar} data-on={on ? 'true' : undefined} style={{ left: pos(from), width: `calc(${pos(to)} - ${pos(from)})`, top: 18 + (i % 4) * 7 }} />
            </Tooltip>
          );
        })}
        {current !== null && <span className={s.rulerNow} style={{ left: pos(current) }} title={`Canvas ${current}px`} />}
      </div>
      <div className={s.bpList}>
        {list.map((b) => {
          const on = current !== null && current >= (b.min ?? 0) && current <= (b.max ?? Infinity);
          return (
            <div key={b.query} className={s.bpRow} data-on={on ? 'true' : undefined}>
              <code>{b.query}</code>
              <span className={s.muted}>{b.count}</span>
            </div>
          );
        })}
        {other > 0 && <div className={s.hint}>+{other} non-width media quer{other === 1 ? 'y' : 'ies'} (orientation, hover, segments…)</div>}
      </div>
    </div>
  );
}
