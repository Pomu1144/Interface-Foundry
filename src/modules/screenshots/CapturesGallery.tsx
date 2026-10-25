import { Camera, Columns2, Download, ImageOff, Star, Trash } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, IconButton, Spinner, Tooltip } from '@/ui';
import { studio, useStudio, type CaptureRef } from '@/store';
import { baselineKey, captureFilename, downloadDataUrl } from './capture';
import { deleteLayout } from './layouts';
import s from './gallery.module.css';

const timeLabel = (ts: number) => {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/**
 * Captures gallery: grouped by route/device/posture (the baseline key), with
 * pick-as-A/B, set-as-baseline, download and delete.
 */
export function CapturesGallery({
  a,
  b,
  onPick,
  onCapture,
  onFoldPair,
  busy,
}: {
  a?: string;
  b?: string;
  onPick: (slot: 'a' | 'b' | 'auto', id: string) => void;
  onCapture: () => void;
  onFoldPair: () => void;
  busy: string | null;
}) {
  const captures = useStudio((st) => st.captures);
  const baselines = useStudio((st) => st.baselines);
  const routes = useStudio((st) => st.routes);
  const ready = useStudio((st) => st.instances.primary?.status === 'ready');
  const [confirm, setConfirm] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, CaptureRef[]>();
    for (const c of captures) {
      const k = baselineKey(c);
      map.set(k, [...(map.get(k) ?? []), c]);
    }
    return [...map.entries()].map(([key, list]) => ({ key, list: list.sort((x, y) => y.createdAt - x.createdAt) }));
  }, [captures]);

  const routeLabel = (r: string) => routes.find((x) => x.path === r)?.label ?? (r || 'Start page');

  return (
    <div className={s.gallery}>
      <div className={s.head}>
        <span className={s.title}>
          Captures <span className={s.count}>{captures.length}</span>
        </span>
      </div>
      <div className={s.actions}>
        <Button size="sm" icon={busy === 'capture' ? <Spinner size={11} /> : <Camera size={12} />} disabled={!ready || Boolean(busy)} onClick={onCapture}>
          Capture canvas
        </Button>
        <Tooltip content="Capture the device folded and expanded in a background preview, then compare">
          <Button size="sm" variant="ghost" icon={busy === 'fold' ? <Spinner size={11} /> : <Columns2 size={12} />} disabled={Boolean(busy)} onClick={onFoldPair}>
            Folded vs expanded
          </Button>
        </Tooltip>
      </div>
      <div className={s.list}>
        {!captures.length && (
          <div className={s.empty}>
            <ImageOff size={16} />
            <div>No captures yet.</div>
            <div className={s.emptyHint}>Press Mod+Shift+S or use the camera in the toolbar. Captures are saved with the project.</div>
          </div>
        )}
        {groups.map((g) => {
          const first = g.list[0];
          const baseline = baselines[g.key];
          return (
            <div key={g.key} className={s.group}>
              <div className={s.groupHead}>
                <span className={s.groupName}>
                  {first.viewport.deviceName}
                  {first.viewport.posture === 'expanded' ? ' · expanded' : ''}
                  {first.viewport.orientation === 'landscape' ? ' · landscape' : ''}
                </span>
                <span className={s.groupRoute}>{routeLabel(first.route)}</span>
              </div>
              {g.list.map((c) => {
                const isBase = baseline === c.id;
                const slot = c.id === a ? 'A' : c.id === b ? 'B' : null;
                return (
                  <div
                    key={c.id}
                    className={s.card}
                    data-slot={slot ?? undefined}
                    role="button"
                    tabIndex={0}
                    onClick={() => onPick('auto', c.id)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onPick('auto', c.id)}
                    title={c.label}
                  >
                    <div className={s.thumb}>
                      <img src={c.dataUrl} alt="" loading="lazy" draggable={false} />
                      {slot && <span className={s.slot}>{slot}</span>}
                      {isBase && (
                        <span className={s.base}>
                          <Star size={9} fill="currentColor" /> Baseline
                        </span>
                      )}
                    </div>
                    <div className={s.meta}>
                      <div className={s.metaTop}>
                        <Badge tone={c.kind === 'chromium' ? 'success' : 'outline'} title={c.kind === 'chromium' ? 'Deterministic capture in Chromium' : 'DOM raster — approximate'}>
                          {c.kind === 'chromium' ? 'Chromium' : 'Raster ≈'}
                        </Badge>
                        <span className={s.dim}>
                          {c.viewport.width}×{c.viewport.height}
                        </span>
                        <span className={s.time}>{timeLabel(c.createdAt)}</span>
                      </div>
                      <div className={s.metaBottom}>
                        <span className={s.edits}>{c.changeCount ? `${c.changeCount} edit${c.changeCount === 1 ? '' : 's'}` : 'original'}</span>
                        <span className={s.cardActions} onClick={(e) => e.stopPropagation()}>
                          <IconButton size="sm" label="Use as A" onClick={() => onPick('a', c.id)}>
                            <span className={s.letter}>A</span>
                          </IconButton>
                          <IconButton size="sm" label="Use as B" onClick={() => onPick('b', c.id)}>
                            <span className={s.letter}>B</span>
                          </IconButton>
                          <IconButton size="sm" label={isBase ? 'Clear baseline' : 'Set as baseline for this page & viewport'} active={isBase} tone="molten" onClick={() => studio().setBaseline(g.key, isBase ? null : c.id)}>
                            <Star size={12} fill={isBase ? 'currentColor' : 'none'} />
                          </IconButton>
                          <IconButton size="sm" label="Download PNG" onClick={() => downloadDataUrl(c.dataUrl, captureFilename(c))}>
                            <Download size={12} />
                          </IconButton>
                          <IconButton
                            size="sm"
                            label={confirm === c.id ? 'Click again to delete' : 'Delete capture'}
                            tone="danger"
                            active={confirm === c.id}
                            onClick={() => {
                              if (confirm !== c.id) {
                                setConfirm(c.id);
                                setTimeout(() => setConfirm((x) => (x === c.id ? null : x)), 2500);
                                return;
                              }
                              studio().removeCapture(c.id);
                              if (isBase) studio().setBaseline(g.key, null);
                              void deleteLayout(c.id);
                              setConfirm(null);
                            }}
                          >
                            <Trash size={12} />
                          </IconButton>
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
