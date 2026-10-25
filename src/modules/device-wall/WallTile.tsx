import clsx from 'clsx';
import { AlertTriangle, Camera, Check, CircleSlash, Crosshair, Lock, Maximize2, RefreshCw, ShieldAlert, Smartphone, TabletSmartphone, Unplug } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import type { NodeId, ResponsiveIssue } from '@shared/types';
import { IconButton, Popover, Spinner, Tooltip } from '@/ui';
import { studio, useStudio, type PreviewSource } from '@/store';
import { DeviceFrame } from '@/modules/device-simulator/DeviceFrame';
import { foldInViewport, viewportContext } from '@/modules/device-simulator/viewport';
import { useOverlay } from '@/modules/preview-runtime/overlay-store';
import { PreviewSurface } from '@/modules/preview-runtime/PreviewSurface';
import { previews } from '@/modules/preview-runtime/registry';
import { refreshSelection } from '@/modules/preview-runtime/sync';
import { useRemoteInfo } from '@/modules/preview-runtime/remote/remote-store';
import type { WallCell } from './layout';
import { useMirrorFeedback } from './mirror';
import { frameBox, type TileSpec } from './presets';
import { useWall } from './state';
import s from './wall.module.css';

export const LABEL_HEIGHT = 46;

export type TileEngine = 'frame' | 'remote' | 'embed';

const SEVERITY_ORDER = ['critical', 'serious', 'moderate', 'minor', 'info'] as const;

/** Run the agent's responsive audit for one tile (quick, heuristic) when enabled. */
function useTileIssues(tile: TileSpec, enabled: boolean, ready: boolean) {
  const [issues, setIssues] = useState<ResponsiveIssue[] | null>(null);
  const [state, setState] = useState<'idle' | 'running' | 'error'>('idle');
  const changeCount = useStudio((st) => st.changes.length + st.transient.length);
  useEffect(() => {
    if (!enabled) {
      setIssues(null);
      setState('idle');
      return;
    }
    if (!ready) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      const conn = previews.get(tile.instanceId);
      if (!conn?.ready) return;
      setState('running');
      const st = studio().settings;
      const fold = foldInViewport(tile.geometry);
      try {
        const r = await conn.call(
          'audit.responsive',
          {
            viewport: viewportContext(tile.device, tile.posture, tile.orientation),
            fold: fold ? { axis: fold.axis, offset: fold.offset, maskLength: fold.maskLength, kind: fold.kind } : null,
            minTapSize: st.minTapSize,
            minFontSize: st.minFontSize,
            maxLineLength: st.maxLineLength,
            ignoreSelectors: st.ignoreSelectors,
          },
          20_000,
        );
        if (!cancelled) {
          setIssues(r);
          setState('idle');
        }
      } catch {
        if (!cancelled) setState('error');
      }
    };
    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, ms);
    };
    schedule(700);
    const offDom = previews.get(tile.instanceId)?.on('dom.changed', () => schedule(2500));
    const offNav = previews.get(tile.instanceId)?.on('navigation', () => schedule(1200));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      offDom?.();
      offNav?.();
    };
  }, [enabled, ready, tile.instanceId, tile.geometry, tile.device, tile.posture, tile.orientation, changeCount]);
  return { issues, state };
}

/** Hover / selection / mirrored-selection outlines drawn inside the tile's viewport (CSS px). */
function TileOverlay({ id, scale }: { id: string; scale: number }) {
  const hover = useOverlay((o) => (o.hover?.instanceId === id ? o.hover : null));
  const rects = useOverlay((o) => o.rects[id]);
  const mirror = useOverlay((o) => o.mirrors[id] ?? null);
  const selection = useStudio((st) => (st.selection.instanceId === id ? st.selection.nodeId : null));
  const interaction = useStudio((st) => st.interaction);
  const sel = selection !== null ? rects?.[selection] : null;
  const mir = mirror !== null && selection === null ? rects?.[mirror as NodeId] : null;
  const k = 1 / Math.max(0.05, scale);
  return (
    <div className={s.overlay} style={{ ['--k' as string]: k }} aria-hidden>
      {hover && interaction === 'inspect' && hover.nodeId !== selection && (
        <div className={s.ovHover} style={{ left: hover.rect.x, top: hover.rect.y, width: hover.rect.width, height: hover.rect.height }} />
      )}
      {mir && <div className={s.ovMirror} style={{ left: mir.x, top: mir.y, width: mir.width, height: mir.height }} />}
      {sel && <div className={s.ovSelect} style={{ left: sel.x, top: sel.y, width: sel.width, height: sel.height }} />}
    </div>
  );
}

/** Loading shimmer, drawn inside the device viewport. */
function TileShimmer({ id }: { id: string }) {
  const loading = useStudio((st) => st.instances[id]?.status === 'loading');
  return loading ? <div className={s.shimmer} /> : null;
}

/** Error / paused notices, drawn in screen space over the device so they stay readable at any tile scale. */
function TileNotice({ id, engine, budgetBlocked, onReload }: { id: string; engine: TileEngine; budgetBlocked: boolean; onReload: () => void }) {
  const inst = useStudio((st) => st.instances[id]);
  if (budgetBlocked) {
    return (
      <div className={s.notice} data-tone="neutral">
        <div className={s.noticeCard}>
          <span className={s.noticeIcon}>
            <CircleSlash size={14} />
          </span>
          <div className={s.noticeTitle}>Not started</div>
          <div className={s.noticeText}>Over the controlled Chromium page budget for this tab. Remove a device or close other previews.</div>
        </div>
      </div>
    );
  }
  if (!inst || inst.status === 'ready' || inst.status === 'idle' || inst.status === 'loading') return null;
  const crashed = inst.status === 'crashed';
  return (
    <div className={s.notice} role="alert">
      <div className={s.noticeCard}>
        <span className={s.noticeIcon} data-tone={crashed ? 'warning' : 'danger'}>
          {inst.status === 'blocked' ? <ShieldAlert size={14} /> : engine === 'remote' && /unavailable|connect/i.test(inst.error ?? '') ? <Unplug size={14} /> : <AlertTriangle size={14} />}
        </span>
        <div className={s.noticeTitle}>{crashed ? 'Page stopped responding' : inst.status === 'blocked' ? 'Site refuses to be embedded' : 'Could not load the page'}</div>
        {inst.error && <div className={s.noticeText}>{inst.error}</div>}
        <button className={s.noticeBtn} onClick={onReload}>
          <RefreshCw size={11} /> Retry
        </button>
      </div>
    </div>
  );
}

function IssuesChip({ tile, issues, state }: { tile: TileSpec; issues: ResponsiveIssue[] | null; state: 'idle' | 'running' | 'error' }) {
  if (state === 'error' && !issues) {
    return (
      <span className={s.chip} data-tone="neutral" title="The responsive audit could not run in this preview">
        <CircleSlash size={10} />
      </span>
    );
  }
  if (!issues) return state === 'running' ? <Spinner size={10} /> : null;
  if (!issues.length) {
    return (
      <span className={s.chip} data-tone="success" title="Heuristic responsive checks found nothing at this viewport. This is not a certification.">
        <Check size={10} /> 0
      </span>
    );
  }
  const worst = SEVERITY_ORDER.find((sev) => issues.some((i) => i.severity === sev)) ?? 'info';
  const tone = worst === 'critical' || worst === 'serious' ? 'danger' : worst === 'moderate' ? 'warning' : 'neutral';
  return (
    <Popover
      side="bottom"
      align="start"
      width={340}
      trigger={
        <button className={s.chip} data-tone={tone} aria-label={`${issues.length} responsive ${issues.length === 1 ? 'issue' : 'issues'} (heuristic)`} title={`${issues.length} responsive ${issues.length === 1 ? 'issue' : 'issues'} (heuristic)`}>
          {state === 'running' ? <Spinner size={9} /> : <AlertTriangle size={10} />}
          {issues.length}
        </button>
      }
    >
      <div className={s.issuesPop}>
        <div className={s.issuesHead}>
          <span>{tile.device.name}</span>
          <span className={s.issuesSub}>Responsive heuristics · {issues.length}</span>
        </div>
        <div className={s.issuesList}>
          {issues.slice(0, 40).map((i) => (
            <button
              key={i.id}
              className={s.issueRow}
              onClick={async () => {
                const conn = previews.get(tile.instanceId);
                if (!conn?.ready) return;
                const id = i.nodeId ?? (await conn.call('dom.resolve', { selector: i.selector }).catch(() => null));
                if (id === null || id === undefined) return;
                conn.tell('node.scrollIntoView', { id });
                studio().select(tile.instanceId, id, i.selector);
                void refreshSelection();
              }}
            >
              <span className={s.sevDot} data-sev={i.severity} />
              <span className={s.issueText}>
                <span className={s.issueTitle}>{i.title}</span>
                <span className={s.issueSel}>{i.selector}</span>
              </span>
              <Crosshair size={12} className={s.issueGo} />
            </button>
          ))}
        </div>
        <div className={s.issuesFoot}>Heuristic checks for this viewport only — not a certification.</div>
      </div>
    </Popover>
  );
}

function Feedback({ id }: { id: string }) {
  const f = useMirrorFeedback((m) => m.map[id]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!f) return;
    const t = setTimeout(() => tick((n) => n + 1), 2600);
    return () => clearTimeout(t);
  }, [f]);
  if (!f || Date.now() - f.at > 2500) return null;
  return (
    <div className={s.feedback} data-ok={f.ok ? 'true' : 'false'} key={f.at}>
      <RefreshCw size={10} />
      <span>{f.text}</span>
    </div>
  );
}

/** Labels may run into the gap next to narrow tiles. */
const labelOverhang = 32;

export const WallTile = memo(function WallTile({
  tile,
  cell,
  index,
  source,
  route,
  engine,
  mounted,
  budgetBlocked,
  nonce,
  onReload,
  onCapture,
  onOpenOnCanvas,
}: {
  tile: TileSpec;
  cell: WallCell;
  index: number;
  source: PreviewSource;
  route: string;
  engine: TileEngine;
  mounted: boolean;
  budgetBlocked: boolean;
  nonce: number;
  onReload: (t: TileSpec) => void;
  onCapture: (t: TileSpec) => void;
  onOpenOnCanvas: (t: TileSpec) => void;
}) {
  const { device, posture, orientation, geometry: g, instanceId } = tile;
  const status = useStudio((st) => st.instances[instanceId]?.status ?? 'idle');
  const title = useStudio((st) => st.instances[instanceId]?.title ?? '');
  const showSystemUI = useStudio((st) => st.settings.showSystemUI);
  const showHinge = useStudio((st) => st.settings.showHinge);
  const colorScheme = useStudio((st) => st.colorScheme);
  const isSelected = useStudio((st) => st.selection.instanceId === instanceId && st.selection.nodeId !== null);
  const remote = useRemoteInfo((r) => r.info[instanceId]);
  const issuesOn = useWall((w) => w.issues);
  const leader = useWall((w) => w.leader === instanceId);
  const mirroring = useWall((w) => w.mirrorScroll || w.mirrorInput);
  const box = frameBox(device, g);
  const narrow = cell.width + labelOverhang < 200;
  const { issues, state } = useTileIssues(tile, issuesOn && engine !== 'embed', status === 'ready');
  const fold = foldInViewport(g);
  const dims = `${g.viewport.width}×${g.viewport.height}`;
  const statusTone = budgetBlocked ? 'idle' : status === 'ready' ? 'ready' : status === 'loading' ? 'loading' : status === 'idle' ? 'idle' : 'error';
  const statusText = budgetBlocked
    ? 'Paused — over the Chromium page budget'
    : status === 'ready'
      ? `Live${title ? ` · ${title}` : ''}`
      : status === 'loading'
        ? 'Loading…'
        : status === 'idle'
          ? 'Waiting'
          : 'Error';
  const engineLabel = engine === 'remote' ? 'Chromium' : engine === 'embed' ? 'Read-only embed' : 'Live frame';
  const engineHint =
    engine === 'remote'
      ? 'Rendered by the controlled Chromium (Blink) with this device’s viewport, DPR, touch and user agent. Safari/WebKit rendering is not simulated.'
      : engine === 'embed'
        ? 'Plain iframe of a third-party site: no inspection, mirroring or audits.'
        : 'Sandboxed iframe with the IFDY agent: fully inspectable.';
  const segmentsHint =
    fold && engine === 'remote'
      ? remote?.displayFeature === 'applied'
        ? 'Viewport segments emulated: the page sees two segments (horizontal-viewport-segments / env(viewport-segment-*)).'
        : remote?.displayFeature === 'unsupported'
          ? `Viewport segments are not emulated by this Chromium build. ${remote.detail ?? ''}`
          : null
      : fold
        ? 'The hinge is drawn over the page; an iframe cannot expose viewport segments to it.'
        : null;

  return (
    <div
      className={clsx(s.tile, leader && mirroring && s.tileLeader, isSelected && s.tileSelected)}
      style={{ left: cell.x, top: cell.y - LABEL_HEIGHT, width: cell.width, animationDelay: `${Math.min(index, 14) * 45}ms` }}
      data-tile={instanceId}
    >
      <div className={s.label} style={{ height: LABEL_HEIGHT, width: cell.width + labelOverhang }}>
        <div className={s.labelRow}>
          <Tooltip content={statusText}>
            <span className={s.dot} data-tone={statusTone} />
          </Tooltip>
          <span className={s.name} title={device.name}>
            {device.name}
          </span>
          {device.expanded &&
            (narrow ? (
              <Tooltip content={posture === 'expanded' ? 'Expanded posture' : 'Folded posture'}>
                <span className={s.posture} data-expanded={posture === 'expanded' ? 'true' : undefined} aria-label={posture === 'expanded' ? 'Expanded' : 'Folded'}>
                  {posture === 'expanded' ? <TabletSmartphone size={10} /> : <Smartphone size={10} />}
                </span>
              </Tooltip>
            ) : (
              <span className={s.posture} data-expanded={posture === 'expanded' ? 'true' : undefined}>
                {posture === 'expanded' ? 'Expanded' : 'Folded'}
              </span>
            ))}
          {device.verification.level === 'provisional' && (
            <Tooltip content={`Provisional profile — ${device.verification.source}${device.verification.note ? ` ${device.verification.note}` : ''}`}>
              <span className={s.provisional} aria-label="Provisional profile" />
            </Tooltip>
          )}
          <span className={s.labelSpacer} />
          {issuesOn && engine !== 'embed' && <IssuesChip tile={tile} issues={issues} state={state} />}
        </div>
        <div className={s.meta}>
          <span className={s.dims}>{dims}</span>
          {!narrow && (
            <>
              <span className={s.metaSep}>·</span>
              <span>@{device.pixelRatio}x</span>
            </>
          )}
          {orientation === 'landscape' && (
            <>
              <span className={s.metaSep}>·</span>
              <span>landscape</span>
            </>
          )}
          {engine !== 'frame' && (
            <>
              <span className={s.metaSep}>·</span>
              <Tooltip content={engineHint}>
                <span className={s.engine} data-engine={engine}>
                  {engine === 'embed' && <Lock size={9} />}
                  {engineLabel}
                </span>
              </Tooltip>
            </>
          )}
          {segmentsHint && (
            <Tooltip content={segmentsHint}>
              <span className={s.segments} data-on={engine === 'remote' && remote?.displayFeature === 'applied' ? 'true' : undefined}>
                {engine === 'remote' && remote?.displayFeature === 'applied' ? 'Segments' : 'Hinge'}
              </span>
            </Tooltip>
          )}
        </div>
      </div>

      <div
        className={s.stage}
        style={{ width: cell.width, height: cell.height }}
        onPointerEnter={() => useWall.getState().setLeader(instanceId)}
        onPointerDownCapture={() => useWall.getState().setLeader(instanceId)}
        onFocusCapture={() => useWall.getState().setLeader(instanceId)}
      >
        <div className={s.scaler} style={{ width: box.width, height: box.height, transform: `scale(${cell.scale})` }}>
          <div className={s.frameAt} style={{ left: box.offsetX }}>
            <DeviceFrame
              device={device}
              geometry={g}
              orientation={orientation}
              visual={{ progress: posture === 'expanded' ? 1 : 0, animating: false, style: 'hinge' }}
              showSystemUI={showSystemUI}
              showHinge={showHinge}
              colorScheme={colorScheme}
              viewportOverlay={
                <>
                  <TileOverlay id={instanceId} scale={cell.scale} />
                  <TileShimmer id={instanceId} />
                </>
              }
            >
              {mounted && !budgetBlocked ? (
                <PreviewSurface
                  key={nonce}
                  source={source}
                  route={route}
                  instanceId={instanceId}
                  role="wall"
                  width={g.viewport.width}
                  height={g.viewport.height}
                  device={device}
                  posture={posture}
                  orientation={orientation}
                  colorScheme={colorScheme}
                  interactive
                />
              ) : (
                <div className={s.parked} style={{ width: g.viewport.width, height: g.viewport.height }}>
                  {!budgetBlocked && <Spinner size={14} />}
                </div>
              )}
            </DeviceFrame>
          </div>
        </div>
        <div className={s.tileActions} onPointerDown={(e) => e.stopPropagation()}>
          <IconButton label="Reload this tile" size="sm" tooltipSide="top" onClick={() => onReload(tile)}>
            <RefreshCw size={12} />
          </IconButton>
          <IconButton label="Capture this tile" size="sm" tooltipSide="top" disabled={budgetBlocked} onClick={() => onCapture(tile)}>
            <Camera size={12} />
          </IconButton>
          <IconButton label="Open on the canvas" size="sm" tooltipSide="top" onClick={() => onOpenOnCanvas(tile)}>
            <Maximize2 size={12} />
          </IconButton>
        </div>
        <TileNotice id={instanceId} engine={engine} budgetBlocked={budgetBlocked} onReload={() => onReload(tile)} />
        <Feedback id={instanceId} />
        {leader && mirroring && <span className={s.leadTag}>Leading</span>}
      </div>
    </div>
  );
});
