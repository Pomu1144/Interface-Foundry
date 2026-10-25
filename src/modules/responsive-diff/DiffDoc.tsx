import { ArrowLeftRight, Blend, Columns2, Crosshair, Download, Eraser, GitCompare, Info, ListTree, Maximize, ScanEye, SquareSplitHorizontal, Star } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { Rect } from '@shared/types';
import { Badge, Button, IconButton, Menu, Notice, Segmented, Select, Slider, Spinner, Switch, Tooltip } from '@/ui';
import { studio, useStudio, type CaptureRef, type DocTab } from '@/store';
import { describeViewport } from '@/modules/device-simulator/viewport';
import { baselineKey, captureCurrent, captureFoldPair, downloadText, engineLabel } from '@/modules/screenshots/capture';
import { CapturesGallery } from '@/modules/screenshots/CapturesGallery';
import { revealIn } from '@/modules/responsive-audit/reveal';
import { QaEmpty } from '@/modules/responsive-audit/bits';
import { overlapSize, sizeDelta } from './pixel';
import { buildDiffReport } from './report';
import type { StructuralRow } from './structural';
import { captureScale, pairNames, usePixelDiff, useStructural, type PixelDiff } from './useDiff';
import type { DiffDocData } from './open';
import s from './diff.module.css';

type View = 'side' | 'swipe' | 'onion' | 'pixel' | 'structure';
type Zoom = 'fit' | number;

const capLabel = (c: CaptureRef) => `${c.viewport.deviceName}${c.viewport.posture === 'expanded' ? ' · expanded' : ''} · ${c.viewport.width}×${c.viewport.height} · ${c.kind === 'chromium' ? 'Chromium' : 'raster'} · ${new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

export default function DiffDoc({ doc }: { doc: DocTab }) {
  const data = (doc.data ?? {}) as DiffDocData;
  const captures = useStudio((st) => st.captures);
  const baselines = useStudio((st) => st.baselines);
  const settings = useStudio((st) => st.settings);
  const project = useStudio((st) => st.project);
  const capA = captures.find((c) => c.id === data.a) ?? null;
  const capB = captures.find((c) => c.id === data.b) ?? null;
  const view = (data.view as View) ?? 'side';
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [threshold, setThreshold] = useState(settings.diffThreshold);
  const [ignore, setIgnore] = useState<Rect[]>([]);
  const [onion, setOnion] = useState(0.5);
  const [highlight, setHighlight] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [stageRef, stageW] = useStageWidth();

  const update = (patch: Partial<DiffDocData>) => studio().updateDoc(doc.id, { data: { ...data, ...patch } });
  useEffect(() => setIgnore([]), [data.a, data.b]);

  const pixel = usePixelDiff(capA, capB, threshold, ignore, view === 'pixel');
  const structural = useStructural(capA, capB, settings.minTapSize);
  const names = capA && capB ? pairNames(capA, capB) : (['A', 'B'] as [string, string]);

  const fitZoom = useMemo(() => {
    if (!capA || !capB || !stageW) return 1;
    const avail = stageW - 48;
    const need = view === 'side' ? capA.viewport.width + capB.viewport.width + 24 : Math.max(capA.viewport.width, capB.viewport.width);
    return Math.max(0.1, Math.min(1, avail / need));
  }, [capA, capB, stageW, view]);
  const k = zoom === 'fit' ? fitZoom : zoom;

  const pick = (slot: 'a' | 'b' | 'auto', id: string) => {
    if (slot === 'auto') {
      if (!capA) return update({ a: id });
      if (id === data.a) return;
      return update({ b: id });
    }
    update({ [slot]: id });
  };

  const doCapture = async () => {
    setBusy('capture');
    try {
      const { captures: list, warnings } = await captureCurrent();
      const latest = list[list.length - 1];
      update(capB ? { a: data.b, b: latest.id } : capA ? { b: latest.id } : { a: latest.id });
      if (warnings.length) toast.warning(warnings.join(' '));
    } catch (err) {
      toast.error('Capture failed', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };
  const doFoldPair = async () => {
    setBusy('fold');
    try {
      const { captures: list, warnings } = await captureFoldPair();
      update({ a: list[0].id, b: list[1].id, view: view === 'structure' || view === 'pixel' ? view : 'side' });
      if (warnings.length) toast.message(warnings.join(' '));
    } catch (err) {
      toast.error('Compare failed', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const exportReport = async (kind: 'html' | 'json') => {
    if (!capA || !capB) return;
    let diff: PixelDiff | null = pixel.diff;
    if (!diff) {
      try {
        const { computePixelDiff } = await import('./useDiff');
        diff = await computePixelDiff(capA, capB, threshold, ignore);
      } catch {
        diff = null;
      }
    }
    const report = buildDiffReport({
      a: capA,
      b: capB,
      project: project?.name,
      route: capB.route,
      ignore,
      structural: structural.data ? { rows: structural.data.rows, summary: structural.data.summary } : null,
      pixel: diff
        ? {
            percent: diff.percent,
            changed: diff.changed,
            compared: diff.compared,
            ignored: diff.ignored,
            boxes: diff.boxes,
            threshold,
            overlap: { width: diff.width / diff.scale, height: diff.height / diff.scale },
            resampled: diff.resampled,
            diffDataUrl: kind === 'html' ? diff.dataUrl() : undefined,
          }
        : null,
    });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    if (kind === 'html') downloadText(report.html, `ifdy-diff-${stamp}.html`, 'text/html');
    else downloadText(report.json, `ifdy-diff-${stamp}.json`, 'application/json');
  };

  const baseB = capB ? baselines[baselineKey(capB)] : undefined;
  const canBaseline = Boolean(baseB && baseB !== capB?.id && baseB !== capA?.id && captures.some((c) => c.id === baseB));

  return (
    <div className={s.doc}>
      <CapturesGallery a={data.a} b={data.b} onPick={pick} onCapture={doCapture} onFoldPair={doFoldPair} busy={busy} />
      <div className={s.main}>
        <div className={s.toolbar}>
          <SlotSelect slot="A" value={capA} captures={captures} onChange={(id) => update({ a: id })} />
          <Tooltip content="Swap A and B">
            <span>
              <IconButton size="sm" label="Swap A and B" disabled={!capA || !capB} onClick={() => update({ a: data.b, b: data.a })}>
                <ArrowLeftRight size={13} />
              </IconButton>
            </span>
          </Tooltip>
          <SlotSelect slot="B" value={capB} captures={captures} onChange={(id) => update({ b: id })} />
          {canBaseline && (
            <Button size="sm" variant="ghost" icon={<Star size={12} />} onClick={() => update({ a: baseB })}>
              vs baseline
            </Button>
          )}
          <span className={s.sep} />
          <Segmented
            ariaLabel="Comparison view"
            value={view}
            onChange={(v) => update({ view: v })}
            options={[
              { value: 'side', icon: <Columns2 size={12} />, label: 'Side by side' },
              { value: 'swipe', icon: <SquareSplitHorizontal size={12} />, label: 'Swipe' },
              { value: 'onion', icon: <Blend size={12} />, label: 'Onion' },
              { value: 'pixel', icon: <ScanEye size={12} />, label: 'Pixels' },
              {
                value: 'structure',
                icon: <ListTree size={12} />,
                label: (
                  <>
                    Structure
                    {structural.data?.summary.suspicious ? <span className={s.segBad}>{structural.data.summary.suspicious}</span> : null}
                  </>
                ),
                title: 'Structural changes',
              },
            ]}
          />
          <span className={s.spacer} />
          {view !== 'structure' && (
            <div className={s.zoom}>
              <IconButton size="sm" label="Zoom to fit" active={zoom === 'fit'} onClick={() => setZoom('fit')}>
                <Maximize size={12} />
              </IconButton>
              <button className={s.zoomBtn} data-on={zoom === 1 ? 'true' : undefined} onClick={() => setZoom(zoom === 1 ? 'fit' : 1)} title="Toggle 100%">
                {Math.round(k * 100)}%
              </button>
            </div>
          )}
          <Menu
            align="end"
            trigger={
              <span>
                <Button size="sm" icon={<Download size={12} />} disabled={!capA || !capB}>
                  Export
                </Button>
              </span>
            }
            items={[
              { type: 'label', label: 'Diff report' },
              { label: 'HTML report (images + findings)', onSelect: () => void exportReport('html') },
              { label: 'JSON findings', onSelect: () => void exportReport('json') },
            ]}
          />
        </div>

        {capA && capB && <InfoBar a={capA} b={capB} view={view} pixel={pixel.diff} />}

        {view === 'onion' && capA && capB && (
          <div className={s.subbar}>
            <span className={s.subLabel}>B opacity</span>
            <div style={{ width: 200 }}>
              <Slider value={onion} onChange={setOnion} min={0} max={1} step={0.01} ariaLabel="B opacity" />
            </div>
            <span className={s.mono}>{Math.round(onion * 100)}%</span>
          </div>
        )}
        {view === 'pixel' && capA && capB && (
          <div className={s.subbar}>
            <span className={s.subLabel}>Threshold</span>
            <div style={{ width: 160 }}>
              <Slider value={threshold} onChange={setThreshold} onCommit={(v) => studio().updateSettings({ diffThreshold: v })} min={0} max={0.5} step={0.01} ariaLabel="Pixel threshold" />
            </div>
            <span className={s.mono}>{threshold.toFixed(2)}</span>
            <span className={s.subSep} />
            <Crosshair size={12} className={s.muted} />
            <span className={s.subHint}>Drag on the image to ignore a region</span>
            {ignore.length > 0 && (
              <Button size="sm" variant="ghost" icon={<Eraser size={12} />} onClick={() => setIgnore([])}>
                Clear {ignore.length} ignored
              </Button>
            )}
            <span className={s.spacer} />
            {pixel.loading && (
              <span className={s.subHint}>
                <Spinner size={10} /> Comparing…
              </span>
            )}
          </div>
        )}
        {(view === 'side' || view === 'structure') && capA && capB && structural.data && (
          <div className={s.subbar}>
            {view === 'side' && (
              <label className={s.switchLabel}>
                <Switch checked={highlight} onChange={setHighlight} ariaLabel="Outline suspicious elements" />
                Outline suspicious elements
              </label>
            )}
            <span className={s.subHint}>
              {structural.data.summary.total} structural change{structural.data.summary.total === 1 ? '' : 's'} · <b className={s.bad}>{structural.data.summary.suspicious} suspicious</b> · {structural.data.summary.unchanged} unchanged
            </span>
          </div>
        )}

        <div className={s.stage} ref={stageRef}>
          {!captures.length ? (
            <div className={s.center}>
              <QaEmpty icon={<GitCompare size={18} />} title="Compare captures">
                Capture the canvas (Mod+Shift+S) or capture the device folded and expanded, then compare side by side, with a swipe, as an onion skin, pixel by pixel and structurally.
                <div className={s.emptyActions}>
                  <Button variant="primary" icon={<Columns2 size={12} />} disabled={Boolean(busy)} onClick={doFoldPair}>
                    Compare folded vs expanded
                  </Button>
                </div>
              </QaEmpty>
            </div>
          ) : !capA || !capB ? (
            <div className={s.center}>
              <QaEmpty icon={<GitCompare size={18} />} title={capA || capB ? 'Pick a second capture' : 'Pick two captures'}>
                Click a capture in the gallery to use it as {capA ? 'B' : 'A'}, or use the A / B buttons on each card.
              </QaEmpty>
            </div>
          ) : view === 'side' ? (
            <SideBySide
              a={capA}
              b={capB}
              k={k}
              rows={highlight ? structural.data?.rows ?? [] : []}
              names={names}
              scroll={[structural.data?.layoutA.scroll ?? { x: 0, y: 0 }, structural.data?.layoutB.scroll ?? { x: 0, y: 0 }]}
            />
          ) : view === 'swipe' ? (
            <Swipe a={capA} b={capB} k={k} />
          ) : view === 'onion' ? (
            <Onion a={capA} b={capB} k={k} opacity={onion} />
          ) : view === 'pixel' ? (
            <PixelView a={capA} b={capB} k={k} state={pixel} ignore={ignore} onIgnore={(r) => setIgnore([...ignore, r])} onRemoveIgnore={(i) => setIgnore(ignore.filter((_, j) => j !== i))} />
          ) : (
            <StructureTable state={structural} a={capA} b={capB} names={names} />
          )}
        </div>
      </div>
    </div>
  );
}

function useStageWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function SlotSelect({ slot, value, captures, onChange }: { slot: 'A' | 'B'; value: CaptureRef | null; captures: CaptureRef[]; onChange: (id: string) => void }) {
  return (
    <span className={s.slotSel} data-slot={slot}>
      <span className={s.slotTag}>{slot}</span>
      <Select
        ariaLabel={`Capture ${slot}`}
        value={value?.id ?? ''}
        onChange={(v) => v && onChange(v)}
        options={[{ value: '', label: captures.length ? 'Choose a capture…' : 'No captures' }, ...captures.map((c) => ({ value: c.id, label: capLabel(c) }))]}
        className={s.select}
      />
    </span>
  );
}

function InfoBar({ a, b, view, pixel }: { a: CaptureRef; b: CaptureRef; view: View; pixel: PixelDiff | null }) {
  const same = a.width / captureScale(a) === b.width / captureScale(b) && a.height / captureScale(a) === b.height / captureScale(b);
  const ov = overlapSize(a.viewport, b.viewport);
  const raster = a.kind === 'raster' || b.kind === 'raster';
  const edits = b.changeCount - a.changeCount;
  return (
    <div className={s.info}>
      <Chip slot="A">{describeViewport(a.viewport)}</Chip>
      <Chip slot="B">{describeViewport(b.viewport)}</Chip>
      {!same && <Badge tone="warning">Size Δ {sizeDelta(a.viewport, b.viewport)}</Badge>}
      {edits !== 0 && (
        <Badge tone="violet">
          {edits > 0 ? '+' : ''}
          {edits} edit{Math.abs(edits) === 1 ? '' : 's'} between captures
        </Badge>
      )}
      {a.route !== b.route && <Badge tone="warning">Different pages</Badge>}
      {view === 'pixel' && pixel && (
        <>
          <Badge tone={pixel.percent > 5 ? 'danger' : pixel.percent > 0.5 ? 'warning' : 'success'}>{pixel.percent.toFixed(2)}% changed</Badge>
          <Badge tone="neutral">
            {pixel.boxes.length} region{pixel.boxes.length === 1 ? '' : 's'} · {pixel.changed.toLocaleString()} px · {pixel.ms} ms
          </Badge>
        </>
      )}
      <span className={s.spacer} />
      {!same && (view === 'pixel' || view === 'swipe' || view === 'onion') && (
        <span className={s.infoNote}>
          <Info size={11} /> Aligned top-left{view === 'pixel' ? ` · pixels compared over the ${ov.width}×${ov.height} overlap only` : ''}
        </span>
      )}
      {raster && (
        <span className={s.infoNote} title="DOM raster re-renders the page via SVG foreignObject; fonts and effects can differ from the browser.">
          <Info size={11} /> {a.kind === b.kind ? engineLabel('raster') : 'Mixed engines'}
        </span>
      )}
    </div>
  );
}

function Chip({ slot, children }: { slot: 'A' | 'B'; children: ReactNode }) {
  return (
    <span className={s.chip} data-slot={slot}>
      <b>{slot}</b>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

const cssSize = (c: CaptureRef, k: number) => ({ width: (c.width / captureScale(c)) * k, height: (c.height / captureScale(c)) * k });

function Frame({ c, k, children, slot, title }: { c: CaptureRef; k: number; children?: ReactNode; slot: 'A' | 'B'; title: string }) {
  const sz = cssSize(c, k);
  return (
    <figure className={s.figure}>
      <figcaption className={s.caption}>
        <span className={s.slotTag} data-slot={slot}>
          {slot}
        </span>
        <span className={s.capTitle}>{title}</span>
        <span className={s.capMeta}>
          {c.viewport.width}×{c.viewport.height} · {c.kind === 'chromium' ? 'Chromium' : 'raster ≈'}
        </span>
      </figcaption>
      <div className={s.imgBox} style={sz}>
        <img src={c.dataUrl} alt={`Capture ${slot}: ${c.label}`} style={sz} draggable={false} />
        {children}
      </div>
    </figure>
  );
}

function SideBySide({ a, b, k, rows, names, scroll }: { a: CaptureRef; b: CaptureRef; k: number; rows: StructuralRow[]; names: [string, string]; scroll: [{ x: number; y: number }, { x: number; y: number }] }) {
  const sus = rows.filter((r) => r.classification === 'suspicious');
  const [hover, setHover] = useState<string | null>(null);
  const boxes = (side: 'a' | 'b') =>
    sus.map((r) => {
      const rect = side === 'a' ? r.a : r.b;
      const visible = side === 'a' ? r.visibleA : r.visibleB;
      if (!rect || !visible) return null;
      const sc = scroll[side === 'a' ? 0 : 1];
      return (
        <span
          key={r.selector}
          className={s.box}
          data-hover={hover === r.selector ? 'true' : undefined}
          style={{ left: (rect.x - sc.x) * k, top: (rect.y - sc.y) * k, width: rect.width * k, height: rect.height * k }}
          onPointerEnter={() => setHover(r.selector)}
          onPointerLeave={() => setHover(null)}
          title={`${r.label}\n${r.reasons.join('\n')}`}
        />
      );
    });
  return (
    <div className={s.side}>
      <Frame c={a} k={k} slot="A" title={names[0]}>
        {boxes('a')}
      </Frame>
      <Frame c={b} k={k} slot="B" title={names[1]}>
        {boxes('b')}
      </Frame>
    </div>
  );
}

function Swipe({ a, b, k }: { a: CaptureRef; b: CaptureRef; k: number }) {
  const sa = cssSize(a, k);
  const sb = cssSize(b, k);
  const W = Math.max(sa.width, sb.width);
  const H = Math.max(sa.height, sb.height);
  const [pos, setPos] = useState(0.5);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const r = ref.current!.getBoundingClientRect();
    setPos(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  const x = pos * W;
  return (
    <div className={s.single}>
      <div
        ref={ref}
        className={s.swipe}
        style={{ width: W, height: H }}
        onPointerDown={(e) => {
          drag.current = true;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          move(e);
        }}
        onPointerMove={move}
        onPointerUp={() => (drag.current = false)}
        role="slider"
        aria-label="Swipe between A and B"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos * 100)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setPos((p) => Math.max(0, p - 0.02));
          if (e.key === 'ArrowRight') setPos((p) => Math.min(1, p + 0.02));
        }}
      >
        <img src={a.dataUrl} alt="Capture A" style={{ ...sa, position: 'absolute', left: 0, top: 0 }} draggable={false} />
        <img src={b.dataUrl} alt="Capture B" style={{ ...sb, position: 'absolute', left: 0, top: 0, clipPath: `inset(0 0 0 ${x}px)` }} draggable={false} />
        <div className={s.handle} style={{ left: x }}>
          <span className={s.grip}>
            <ArrowLeftRight size={12} />
          </span>
        </div>
        <span className={s.cornerTag} data-slot="A" style={{ left: 8 }}>
          A
        </span>
        <span className={s.cornerTag} data-slot="B" style={{ right: 8 }}>
          B
        </span>
      </div>
    </div>
  );
}

function Onion({ a, b, k, opacity }: { a: CaptureRef; b: CaptureRef; k: number; opacity: number }) {
  const sa = cssSize(a, k);
  const sb = cssSize(b, k);
  return (
    <div className={s.single}>
      <div className={s.swipe} style={{ width: Math.max(sa.width, sb.width), height: Math.max(sa.height, sb.height), cursor: 'default' }}>
        <img src={a.dataUrl} alt="Capture A" style={{ ...sa, position: 'absolute', left: 0, top: 0 }} draggable={false} />
        <img src={b.dataUrl} alt="Capture B" style={{ ...sb, position: 'absolute', left: 0, top: 0, opacity }} draggable={false} />
      </div>
    </div>
  );
}

function PixelView({
  a,
  b,
  k,
  state,
  ignore,
  onIgnore,
  onRemoveIgnore,
}: {
  a: CaptureRef;
  b: CaptureRef;
  k: number;
  state: { diff: PixelDiff | null; loading: boolean; error: string | null };
  ignore: Rect[];
  onIgnore: (r: Rect) => void;
  onRemoveIgnore: (i: number) => void;
}) {
  const diff = state.diff;
  const url = useMemo(() => diff?.dataUrl() ?? null, [diff]);
  const sa = cssSize(a, k);
  const sb = cssSize(b, k);
  const W = Math.max(sa.width, sb.width);
  const H = Math.max(sa.height, sb.height);
  const ov = overlapSize(a.viewport, b.viewport);
  const [draft, setDraft] = useState<Rect | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const toCss = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.min(ov.width, Math.max(0, (e.clientX - r.left) / k)), y: Math.min(ov.height, Math.max(0, (e.clientY - r.top) / k)) };
  };
  if (state.error) return <div className={s.center}><Notice tone="danger">Pixel diff failed: {state.error}</Notice></div>;
  if (!diff || !url)
    return (
      <div className={s.center}>
        <span className={s.subHint}>
          <Spinner /> Comparing pixels in a background worker…
        </span>
      </div>
    );
  return (
    <div className={s.single}>
      <div className={s.pixelWrap} style={{ width: W, height: H }}>
        {/* Non-overlapping parts of the larger capture, dimmed: not compared. */}
        {(sb.width > sa.width || sb.height > sa.height) && <img src={b.dataUrl} alt="" className={s.outside} style={{ ...sb }} draggable={false} />}
        {(sa.width > sb.width || sa.height > sb.height) && <img src={a.dataUrl} alt="" className={s.outside} style={{ ...sa }} draggable={false} />}
        <div
          ref={ref}
          className={s.diffArea}
          style={{ width: ov.width * k, height: ov.height * k }}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            start.current = toCss(e);
            setDraft({ ...start.current, width: 0, height: 0 });
          }}
          onPointerMove={(e) => {
            if (!start.current) return;
            const p = toCss(e);
            setDraft({ x: Math.min(p.x, start.current.x), y: Math.min(p.y, start.current.y), width: Math.abs(p.x - start.current.x), height: Math.abs(p.y - start.current.y) });
          }}
          onPointerUp={() => {
            if (draft && draft.width > 3 && draft.height > 3) onIgnore({ x: Math.round(draft.x), y: Math.round(draft.y), width: Math.round(draft.width), height: Math.round(draft.height) });
            start.current = null;
            setDraft(null);
          }}
        >
          <img src={url} alt="Pixel difference" style={{ width: ov.width * k, height: ov.height * k }} draggable={false} className={state.loading ? s.stale : undefined} />
          {diff.boxes.map((r, i) => (
            <span key={i} className={s.diffBox} style={{ left: r.x * k - 2, top: r.y * k - 2, width: r.width * k + 4, height: r.height * k + 4 }} />
          ))}
          {ignore.map((r, i) => (
            <span key={`i${i}`} className={s.ignore} style={{ left: r.x * k, top: r.y * k, width: r.width * k, height: r.height * k }}>
              <button className={s.ignoreX} onPointerDown={(e) => e.stopPropagation()} onClick={() => onRemoveIgnore(i)} aria-label="Remove ignored region">
                ×
              </button>
            </span>
          ))}
          {draft && <span className={s.ignore} data-draft="true" style={{ left: draft.x * k, top: draft.y * k, width: draft.width * k, height: draft.height * k }} />}
        </div>
        {(sb.width > sa.width || sb.height > sa.height || sa.width > sb.width || sa.height > sb.height) && (
          <span className={s.outsideLabel} style={{ left: ov.width * k + 8, top: 8 }}>
            Not compared · {sizeDelta(a.viewport, b.viewport)}
          </span>
        )}
      </div>
      {diff.resampled && (
        <div className={s.footNote}>
          <Info size={11} /> Captures had different pixel densities; the denser one was resampled to {diff.scale}× before comparing.
        </div>
      )}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { moved: 'Moved', resized: 'Resized', appeared: 'Appeared', disappeared: 'Disappeared', shown: 'Shown', hidden: 'Hidden' };

function StructureTable({ state, a, b, names }: { state: ReturnType<typeof useStructural>; a: CaptureRef; b: CaptureRef; names: [string, string] }) {
  const [onlySus, setOnlySus] = useState(false);
  if (state.loading && !state.data)
    return (
      <div className={s.center}>
        <Spinner />
      </div>
    );
  if (state.missing || !state.data)
    return (
      <div className={s.center}>
        <QaEmpty icon={<ListTree size={18} />} title="No layout snapshots for these captures" tone="neutral">
          Structural diffs use the layout snapshot IFDY stores with each new capture. Captures from before this feature, or from another browser, only support visual comparison.
        </QaEmpty>
      </div>
    );
  const rows = onlySus ? state.data.rows.filter((r) => r.classification === 'suspicious') : state.data.rows;
  const rect = (r?: Rect) => (r ? `${Math.round(r.x)}, ${Math.round(r.y)} · ${Math.round(r.width)}×${Math.round(r.height)}` : '—');
  const sum = state.data.summary;
  return (
    <div className={s.tableWrap}>
      <div className={s.tableHead}>
        <span className={s.sumItem}>
          <b>{sum.total}</b> changes
        </span>
        {(['moved', 'resized', 'appeared', 'disappeared', 'shown', 'hidden'] as const).map((kk) =>
          sum[kk] ? (
            <span key={kk} className={s.sumItem}>
              {KIND_LABEL[kk]} <b>{sum[kk]}</b>
            </span>
          ) : null,
        )}
        <span className={s.spacer} />
        <label className={s.switchLabel}>
          <Switch checked={onlySus} onChange={setOnlySus} ariaLabel="Suspicious only" /> Suspicious only ({sum.suspicious})
        </label>
      </div>
      {!rows.length ? (
        <div className={s.center} style={{ height: 160 }}>
          <span className={s.subHint}>No {onlySus ? 'suspicious ' : ''}structural changes between {names[0]} and {names[1]}.</span>
        </div>
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              <th style={{ width: 96 }}>Class</th>
              <th style={{ width: 120 }}>Change</th>
              <th>Element</th>
              <th style={{ width: 150 }}>{names[0]}</th>
              <th style={{ width: 150 }}>{names[1]}</th>
              <th>Why</th>
              <th style={{ width: 36 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.selector} data-class={r.classification}>
                <td>
                  <Badge tone={r.classification === 'suspicious' ? 'danger' : 'outline'}>{r.classification === 'suspicious' ? 'Suspicious' : 'Expected'}</Badge>
                </td>
                <td>
                  <span className={s.kinds}>
                    {r.kinds.map((kk) => (
                      <span key={kk} className={s.kind} data-kind={kk}>
                        {KIND_LABEL[kk]}
                      </span>
                    ))}
                  </span>
                  {(r.kinds.includes('moved') || r.kinds.includes('resized')) && (
                    <div className={s.delta}>
                      {r.kinds.includes('moved') ? `Δ ${r.dx > 0 ? '+' : ''}${r.dx}, ${r.dy > 0 ? '+' : ''}${r.dy}` : ''} {r.kinds.includes('resized') ? `${r.dw > 0 ? '+' : ''}${r.dw} × ${r.dh > 0 ? '+' : ''}${r.dh}` : ''}
                    </div>
                  )}
                </td>
                <td>
                  <div className={s.el}>
                    {r.primary && <Badge tone="molten">Primary</Badge>}
                    <span className={s.role}>{r.role}</span>
                    <code>{r.label}</code>
                  </div>
                  {r.text && <div className={s.elText}>“{r.text}”</div>}
                </td>
                <td className={s.mono}>{r.visibleA === false ? 'hidden' : rect(r.a)}</td>
                <td className={s.mono}>{r.visibleB === false ? 'hidden' : rect(r.b)}</td>
                <td className={s.why}>{r.reasons.length ? r.reasons.map((x, i) => <div key={i}>{x}</div>) : <span className={s.muted}>Responsive layout change</span>}</td>
                <td>
                  <IconButton size="sm" label={`Locate in ${describeViewport(b.viewport)}`} onClick={() => void revealIn(b.viewport, r.selector)}>
                    <Crosshair size={12} />
                  </IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className={s.footNote}>
        <Info size={11} /> Heuristic: suspicious = primary control hidden, pushed past the viewport edge, shrunk below {useStudio.getState().settings.minTapSize}px, or split by a hinge/crease. Layout measured {a.route === b.route ? 'on the same page' : 'on different pages'}.
      </div>
    </div>
  );
}
