import clsx from 'clsx';
import {
  ArrowDownUp,
  Camera,
  ChevronDown,
  FolderOpen,
  Globe,
  Hand,
  LayoutGrid,
  Lock,
  MousePointerClick,
  RefreshCw,
  RotateCcw,
  RotateCw,
  ScanSearch,
  Smartphone,
  TabletSmartphone,
  TriangleAlert,
  Unplug,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { DeviceProfile } from '@shared/types';
import { Button, Divider, IconButton, Menu, Popover, Segmented, Spinner, Tooltip } from '@/ui';
import { runAction } from '@/app/actions';
import { DeviceGlyph } from '@/app/toolbar/DevicePicker';
import { studio, useStudio, type DocTab } from '@/store';
import { BUILT_IN_DEVICES } from '@/modules/device-simulator/devices';
import { openDemoProject, openUrl } from '@/modules/project-adapter/projects';
import { describeSource } from '@/modules/project-adapter/source';
import { previews } from '@/modules/preview-runtime/registry';
import { chromiumAvailable } from '@/modules/preview-runtime/remote/capture';
import { browserSocket } from '@/modules/preview-runtime/remote/socket';
import { captureTiles, composeContactSheet, downloadBlob, type CaptureMode } from './capture';
import { fitWallLayout, wallLayout, WALL_DEFAULTS } from './layout';
import { useMirrorFeedback, useMirroring } from './mirror';
import { buildTiles, frameBox, isWallInstance, matchingPreset, parseKey, presetKeys, PRESETS, tileKey, type PresetId, type TileSpec } from './presets';
import { useWall, type Density } from './state';
import { LABEL_HEIGHT, WallTile, type TileEngine } from './WallTile';
import s from './wall.module.css';

const PAD = 40;
const DENSITY_HEIGHT: Record<Exclude<Density, 'fit'>, number> = { s: 300, m: 460, l: 660 };
const WALL_OPTS = { ...WALL_DEFAULTS, labelHeight: LABEL_HEIGHT + 8 };

function useSocketHello() {
  return useSyncExternalStore(
    (cb) => browserSocket.onState(cb),
    () => browserSocket.hello,
  );
}

/**
 * Device wall: the current page on many devices at once. Hosted sources (demo,
 * imported projects, local dev servers) run as inspectable frames; public URLs
 * run in the controlled Chromium (or as read-only embeds without it).
 */
export default function WallDoc({ doc }: { doc: DocTab }) {
  void doc;
  const source = useStudio((st) => st.source);
  const route = useStudio((st) => st.currentRoute);
  const project = useStudio((st) => st.project);
  const caps = useStudio((st) => st.server.capabilities);
  const serverStatus = useStudio((st) => st.server.status);
  const customDevices = useStudio((st) => st.customDevices);
  const interaction = useStudio((st) => st.interaction);
  const wall = useWall();
  const hello = useSocketHello();
  const devices = useMemo(() => [...BUILT_IN_DEVICES, ...customDevices], [customDevices]);
  const tiles = useMemo(() => buildTiles(wall.keys, devices, wall.orientation), [wall.keys, devices, wall.orientation]);

  const engine: TileEngine = !source ? 'frame' : source.kind === 'url' ? (source.engine === 'remote' ? 'remote' : 'embed') : 'frame';
  const remoteBlocked = engine === 'remote' && caps?.browser.available === false;

  /* -------------------------- size + layout -------------------------- */
  const bodyRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, [source, tiles.length === 0, remoteBlocked]);

  const boxes = useMemo(() => tiles.map((t) => frameBox(t.device, t.geometry)), [tiles]);
  const avail = { width: Math.max(200, size.width - PAD * 2), height: Math.max(200, size.height - PAD * 2) };
  const layout = useMemo(
    () => (wall.density === 'fit' ? fitWallLayout(boxes, avail, WALL_OPTS) : wallLayout(boxes, avail.width, DENSITY_HEIGHT[wall.density], WALL_OPTS)),
    [boxes, avail.width, avail.height, wall.density], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* --------------------- staggered mounting + budget --------------------- */
  const [mountedCount, setMountedCount] = useState(0);
  useEffect(() => {
    if (mountedCount >= tiles.length) return;
    const t = setTimeout(() => setMountedCount((n) => n + 1), mountedCount === 0 ? 30 : 90);
    return () => clearTimeout(t);
  }, [mountedCount, tiles.length]);

  const otherRemote = useStudio((st) => Object.values(st.instances).filter((i) => i.engine === 'remote' && !isWallInstance(i.id)).length);
  const budget = engine === 'remote' ? Math.max(0, (hello?.maxPages ?? 12) - otherRemote) : Infinity;

  /* ------------------------------ mirroring ------------------------------ */
  const tileIds = useMemo(() => tiles.map((t) => t.instanceId), [tiles]);
  const live = useStudio((st) => tileIds.filter((id) => st.instances[id]?.status === 'ready').length);
  useMirroring(engine === 'embed' ? [] : tileIds);

  // Leaving the wall: drop wall selections/leader (tiles unmount and remove their instances).
  useEffect(
    () => () => {
      useWall.getState().setLeader(null);
      useMirrorFeedback.getState().clear();
      if (isWallInstance(studio().selection.instanceId)) studio().select(null, null);
    },
    [],
  );

  /* ------------------------------- actions ------------------------------- */
  const [nonces, setNonces] = useState<Record<string, number>>({});
  const reloadTile = (t: TileSpec) => {
    const conn = previews.get(t.instanceId);
    const inst = studio().instances[t.instanceId];
    if (conn?.ready && inst?.status === 'ready') {
      conn.resetPending('Reloading');
      studio().upsertInstance(t.instanceId, { status: 'loading', error: undefined });
      conn.tell('nav.reload');
    } else {
      setNonces((n) => ({ ...n, [t.instanceId]: (n[t.instanceId] ?? 0) + 1 }));
    }
  };
  const reloadAll = () => tiles.forEach(reloadTile);

  const [capturing, setCapturing] = useState<{ done: number; total: number } | null>(null);
  const runCapture = async (list: TileSpec[], mode: CaptureMode, sheet: boolean) => {
    if (capturing) return;
    setCapturing({ done: 0, total: list.length });
    try {
      const { captures, failed } = await captureTiles(list, mode, (done, total) => setCapturing({ done, total }));
      if (!captures.length) throw new Error(failed[0]?.error ?? 'Nothing could be captured.');
      const name = (project?.name ?? 'ifdy').replace(/[^\w.-]+/g, '-').toLowerCase();
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      if (sheet) {
        const s0 = studio();
        const where = s0.source ? `${describeSource(s0.source)} · ${s0.instances[captures[0].tile.instanceId]?.url || s0.currentRoute}` : '';
        const blob = await composeContactSheet(captures, {
          title: `${project?.name ?? 'Device wall'} — ${captures.length} devices`,
          subtitle: `${where} · ${new Date().toLocaleString()}`,
        });
        downloadBlob(blob, `${name}-device-wall-${stamp}.png`);
      } else {
        const c = captures[0].capture;
        const blob = await (await fetch(c.dataUrl)).blob();
        downloadBlob(blob, `${name}-${captures[0].tile.instanceId}-${stamp}.png`);
      }
      toast.success(sheet ? `Contact sheet saved · ${captures.length} captures added to the project` : `Captured ${captures[0].capture.label}`, {
        description: failed.length ? `${failed.length} tile(s) failed: ${failed.map((f) => f.tile.device.name).join(', ')}` : undefined,
      });
    } catch (err) {
      toast.error('Capture failed', { description: (err as Error).message });
    } finally {
      setCapturing(null);
    }
  };

  const openOnCanvas = (t: TileSpec) => {
    studio().setViewport({ deviceId: t.device.id, posture: t.posture, orientation: t.orientation });
    studio().setActiveDoc('canvas');
    studio().fitCamera();
  };

  /* -------------------------------- states -------------------------------- */
  if (!source) {
    return (
      <WallEmpty
        icon={<LayoutGrid size={22} />}
        title="Nothing to put on the wall yet"
        text="Open a project or paste a website link, then see it on foldables, phones, tablets and laptops side by side."
        actions={
          <>
            <Button variant="primary" icon={<FolderOpen size={13} />} onClick={() => openDemoProject().catch((e) => toast.error(e.message))}>
              Open the Harborline demo
            </Button>
            <Button icon={<Globe size={13} />} onClick={() => runAction('project.simulateUrl')}>
              Simulate a URL…
            </Button>
          </>
        }
      />
    );
  }

  if (remoteBlocked) {
    return (
      <WallEmpty
        icon={<Unplug size={22} />}
        tone="warning"
        title="The controlled Chromium is not available"
        text={
          <>
            Public websites run in a Chromium the companion controls, for true device emulation, interaction and inspection.
            <span className={s.emptyReason}>{caps?.browser.reason}</span>
          </>
        }
        actions={
          <>
            {source.kind === 'url' && (
              <Button
                icon={<Lock size={13} />}
                onClick={() =>
                  openUrl(source.url, { preferEngine: 'embed' })
                    .then(() => runAction('view.wall'))
                    .catch((e) => toast.error(e.message))
                }
              >
                Open as read-only embeds
              </Button>
            )}
            <Button variant="ghost" icon={<RefreshCw size={13} />} onClick={() => location.reload()}>
              Check again
            </Button>
          </>
        }
      />
    );
  }

  const presetActive = matchingPreset(wall.keys, devices);

  return (
    <div className={s.root}>
      <header className={s.toolbar}>
        <div className={s.titleBlock}>
          <span className={s.titleIcon}>
            <LayoutGrid size={14} />
          </span>
          <div className={s.titleText}>
            <span className={s.title}>Device wall</span>
            <span className={s.subtitle} title={source.kind === 'url' ? source.url : route}>
              {source.label}
              {route && source.kind !== 'url' ? <span className={s.subRoute}>{route}</span> : null}
            </span>
          </div>
          <EngineBadge engine={engine} />
        </div>

        <div className={s.tools}>
          <DeviceSetEditor devices={devices} engine={engine} budget={budget} />
          <Segmented<Density>
            ariaLabel="Tile size"
            value={wall.density}
            onChange={(density) => wall.set({ density })}
            options={[
              { value: 'fit', label: 'Fit', title: 'Fit every device on screen' },
              { value: 's', label: 'S' },
              { value: 'm', label: 'M' },
              { value: 'l', label: 'L' },
            ]}
          />
          <IconButton
            label={wall.orientation === 'portrait' ? 'Rotate all to landscape' : 'Rotate all to portrait'}
            active={wall.orientation === 'landscape'}
            onClick={() => wall.set({ orientation: wall.orientation === 'portrait' ? 'landscape' : 'portrait' })}
          >
            <RotateCw size={14} />
          </IconButton>
          <Divider vertical />
          <Toggle
            icon={<ArrowDownUp size={13} />}
            label="Mirror scroll"
            on={wall.mirrorScroll}
            disabled={engine === 'embed'}
            hint={engine === 'embed' ? 'Read-only embeds cannot be scrolled remotely.' : 'Scrolling one device scrolls the others to the same relative position.'}
            onChange={(mirrorScroll) => wall.set({ mirrorScroll })}
          />
          <Toggle
            icon={<Hand size={13} />}
            label="Mirror input"
            on={wall.mirrorInput}
            disabled={engine === 'embed'}
            hint={
              engine === 'embed'
                ? 'Read-only embeds have no agent to replay interactions.'
                : 'Clicks, typing and selections on the device you use are replayed on the others (Interact mode). Sensitive fields are never mirrored.'
            }
            onChange={(mirrorInput) => wall.set({ mirrorInput })}
          />
          <Toggle
            icon={<TriangleAlert size={13} />}
            label="Issues"
            on={wall.issues}
            disabled={engine === 'embed'}
            hint={engine === 'embed' ? 'Audits need the IFDY agent.' : 'Run a quick responsive audit on every device (heuristic, not a certification).'}
            onChange={(issues) => wall.set({ issues })}
          />
          <Divider vertical />
          <Segmented
            ariaLabel="Pointer mode"
            value={interaction}
            onChange={(m) => studio().setInteraction(m)}
            options={[
              { value: 'inspect', icon: <ScanSearch size={13} />, title: 'Inspect: click to select elements (I)' },
              { value: 'interact', icon: <MousePointerClick size={13} />, title: 'Interact: use the pages (P)' },
            ]}
          />
          <IconButton label="Reload all devices" onClick={reloadAll} disabled={!tiles.length}>
            <RefreshCw size={14} />
          </IconButton>
          <div className={s.split}>
            <Button
              variant="primary"
              icon={capturing ? <Spinner size={12} /> : <Camera size={13} />}
              disabled={!tiles.length || Boolean(capturing) || (engine === 'embed' && !chromiumAvailable())}
              title={engine === 'embed' && !chromiumAvailable() ? 'Read-only embeds cannot be captured without the controlled Chromium.' : undefined}
              onClick={() => void runCapture(tiles.filter((_, i) => i < budget), 'auto', true)}
            >
              {capturing ? `Capturing ${capturing.done}/${capturing.total}` : 'Capture all'}
            </Button>
            <Menu
              align="end"
              width={300}
              trigger={
                <button className={s.splitMore} aria-label="Capture options" disabled={!tiles.length || Boolean(capturing)}>
                  <ChevronDown size={13} />
                </button>
              }
              items={[
                { type: 'label', label: 'Contact sheet (PNG) + project captures' },
                {
                  label: engine === 'frame' ? 'Live state (DOM raster, approximate)' : 'Chromium, pixel-exact',
                  hint: engine === 'frame' ? 'includes typed input' : 'fresh load',
                  icon: <Camera size={13} />,
                  onSelect: () => void runCapture(tiles.filter((_, i) => i < budget), 'auto', true),
                },
                {
                  label: 'Chromium, pixel-exact (fresh load)',
                  hint: chromiumAvailable() ? 'with your edits' : 'unavailable',
                  icon: <Camera size={13} />,
                  disabled: !chromiumAvailable() || engine !== 'frame',
                  onSelect: () => void runCapture(tiles, 'chromium', true),
                },
              ]}
            />
          </div>
        </div>
      </header>

      {engine === 'embed' && (
        <div className={s.banner} data-tone="warning">
          <Lock size={13} />
          <span>
            <strong>Read-only embeds.</strong> This site runs as plain iframes where it allows framing: no inspection, mirroring or audits, and Chromium-only features are not emulated.
          </span>
          {chromiumAvailable() && source.kind === 'url' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                openUrl(source.url, { preferEngine: 'remote' })
                  .then(() => runAction('view.wall'))
                  .catch((e) => toast.error(e.message))
              }
            >
              Use controlled Chromium
            </Button>
          )}
        </div>
      )}

      <div ref={bodyRef} className={s.body} data-density={wall.density}>
        {!tiles.length ? (
          <WallEmpty
            icon={<Smartphone size={22} />}
            title="No devices on the wall"
            text="Pick a preset to start, or choose devices and postures one by one from the Devices menu."
            actions={
              <div className={s.presetRow}>
                {PRESETS.map((p) => (
                  <Button key={p.id} size="sm" onClick={() => wall.set({ keys: presetKeys(p.id, devices) })}>
                    {p.label}
                  </Button>
                ))}
              </div>
            }
            inline
          />
        ) : (
          <div
            className={s.grid}
            style={{ width: Math.max(avail.width, layout.width), height: layout.height, margin: `${Math.max(PAD, Math.floor((size.height - layout.height) / 2))}px ${PAD}px ${PAD}px` }}
          >
            {tiles.map((t, i) => (
              <WallTile
                key={t.key}
                tile={t}
                cell={layout.cells[i]}
                index={i}
                source={source}
                route={route}
                engine={engine}
                mounted={i < mountedCount}
                budgetBlocked={i >= budget}
                nonce={nonces[t.instanceId] ?? 0}
                onReload={reloadTile}
                onCapture={(tile) => void runCapture([tile], 'auto', false)}
                onOpenOnCanvas={openOnCanvas}
              />
            ))}
          </div>
        )}
      </div>

      <footer className={s.footer}>
        <span className={s.footItem}>
          <span className={s.footDot} data-tone={live === tiles.length && tiles.length ? 'ready' : 'loading'} />
          {tiles.length} {tiles.length === 1 ? 'device' : 'devices'} · {live} live
        </span>
        {presetActive && <span className={clsx(s.footItem, s.footPreset)}>{PRESETS.find((p) => p.id === presetActive)?.label}</span>}
        {engine === 'remote' && (
          <span className={s.footItem} title={hello?.capabilities.displayFeatures.detail}>
            {hello ? hello.browser : serverStatus === 'online' ? 'Starting Chromium…' : 'Companion offline'}
            {hello && (hello.capabilities.displayFeatures.supported ? ' · viewport segments emulated' : ' · viewport segments not emulated')}
          </span>
        )}
        {engine === 'remote' && Number.isFinite(budget) && tiles.length > budget && <span className={s.footWarn}>{tiles.length - budget} paused (page budget {hello?.maxPages ?? 12})</span>}
        <span className={s.footSpacer} />
        {(wall.mirrorScroll || wall.mirrorInput) && engine !== 'embed' && <LeaderNote tiles={tiles} />}
        <span className={clsx(s.footItem, s.footHint)}>{interaction === 'inspect' ? 'Inspect — click selects, mirrored across devices' : 'Interact — use the pages'}</span>
      </footer>
    </div>
  );
}

function LeaderNote({ tiles }: { tiles: TileSpec[] }) {
  const leader = useWall((w) => w.leader);
  const t = tiles.find((x) => x.instanceId === leader);
  return <span className={s.footItem}>{t ? `Mirroring from ${t.device.name}${t.device.expanded ? ` (${t.posture})` : ''}` : 'Mirroring: hover a device to lead'}</span>;
}

function EngineBadge({ engine }: { engine: TileEngine }) {
  const map = {
    frame: { label: 'Live frames', hint: 'Sandboxed frames on the isolated preview origin, with the IFDY agent: fully inspectable.' },
    remote: { label: 'Controlled Chromium', hint: 'Each device is a page in the companion’s Chromium with true viewport, DPR, touch, UA and fold emulation, streamed here. Blink only — Safari/WebKit is not simulated.' },
    embed: { label: 'Read-only embed', hint: 'Plain iframes of a third-party site. No inspection.' },
  }[engine];
  return (
    <Tooltip content={map.hint}>
      <span className={s.engineBadge} data-engine={engine}>
        {engine === 'embed' ? <Lock size={10} /> : <span className={s.liveDot} />}
        {map.label}
      </span>
    </Tooltip>
  );
}

function Toggle({ icon, label, on, onChange, disabled, hint }: { icon: ReactNode; label: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint: string }) {
  return (
    <Tooltip content={hint}>
      <button className={s.toggle} aria-label={label} data-on={on && !disabled ? 'true' : undefined} aria-pressed={on && !disabled} disabled={disabled} onClick={() => onChange(!on)}>
        {icon}
        <span>{label}</span>
      </button>
    </Tooltip>
  );
}

function WallEmpty({ icon, title, text, actions, tone, inline }: { icon: ReactNode; title: string; text: ReactNode; actions?: ReactNode; tone?: 'warning'; inline?: boolean }) {
  return (
    <div className={clsx(s.empty, inline && s.emptyInline)}>
      <div className={s.emptyCard}>
        <div className={s.emptyMark} data-tone={tone}>
          <span className={s.emptyGlyphs} aria-hidden>
            <TabletSmartphone size={46} strokeWidth={1.1} />
          </span>
          <span className={s.emptyIcon}>{icon}</span>
        </div>
        <div className={s.emptyTitle}>{title}</div>
        <div className={s.emptyText}>{text}</div>
        {actions && <div className={s.emptyActions}>{actions}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Device set editor                                                   */
/* ------------------------------------------------------------------ */

const GROUPS: { id: DeviceProfile['category']; label: string }[] = [
  { id: 'foldable', label: 'Foldables' },
  { id: 'phone', label: 'Phones' },
  { id: 'tablet', label: 'Tablets' },
  { id: 'desktop', label: 'Laptop & desktop' },
  { id: 'custom', label: 'Custom' },
];

function DeviceSetEditor({ devices, engine, budget }: { devices: DeviceProfile[]; engine: TileEngine; budget: number }) {
  const keys = useWall((w) => w.keys);
  const set = useWall((w) => w.set);
  const toggleKey = useWall((w) => w.toggleKey);
  const active = matchingPreset(keys, devices);
  const selected = new Set(keys);
  const count = keys.filter((k) => devices.some((d) => d.id === parseKey(k).deviceId)).length;
  return (
    <Popover
      side="bottom"
      align="start"
      width={380}
      trigger={
        <button className={s.devicesBtn} aria-label="Choose devices">
          <Smartphone size={13} />
          <span>Devices</span>
          <span className={s.count}>{count}</span>
          <ChevronDown size={12} />
        </button>
      }
    >
      <div className={s.editor}>
        <div className={s.editorHead}>
          <span className={s.editorTitle}>Devices on the wall</span>
          <button className={s.linkBtn} onClick={() => set({ keys: presetKeys('launch', devices) })}>
            <RotateCcw size={11} /> Reset
          </button>
        </div>
        <div className={s.presets} role="group" aria-label="Presets">
          {PRESETS.map((p) => (
            <Tooltip key={p.id} content={p.hint}>
              <button className={s.preset} data-active={active === p.id ? 'true' : undefined} onClick={() => set({ keys: presetKeys(p.id as PresetId, devices) })}>
                {p.label}
              </button>
            </Tooltip>
          ))}
        </div>
        <div className={s.editorList}>
          {GROUPS.map((g) => {
            const list = devices.filter((d) => d.category === g.id && d.id !== 'responsive');
            if (!list.length) return null;
            return (
              <div key={g.id} className={s.group}>
                <div className={s.groupLabel}>{g.label}</div>
                {list.map((d) => {
                  const g0 = d.folded.viewport;
                  const postures = d.expanded ? (['folded', 'expanded'] as const) : (['folded'] as const);
                  const any = postures.some((p) => selected.has(tileKey(d.id, p)));
                  return (
                    <div key={d.id} className={s.deviceRow} data-on={any ? 'true' : undefined}>
                      <span className={s.deviceGlyph}>
                        <DeviceGlyph d={d} size={20} />
                      </span>
                      <span className={s.deviceText}>
                        <span className={s.deviceName}>
                          {d.name}
                          {d.verification.level === 'provisional' && <span className={s.provDot} title="Provisional profile" />}
                        </span>
                        <span className={s.deviceMeta}>
                          {g0.width}×{g0.height}
                          {d.expanded && ` · ${d.expanded.viewport.width}×${d.expanded.viewport.height}`} · @{d.pixelRatio}x
                        </span>
                      </span>
                      <span className={s.postures}>
                        {postures.map((p) => {
                          const k = tileKey(d.id, p);
                          const on = selected.has(k);
                          return (
                            <button key={p} className={s.postureToggle} data-on={on ? 'true' : undefined} aria-pressed={on} onClick={() => toggleKey(k)} title={d.expanded ? `${p === 'folded' ? 'Folded' : 'Expanded'} posture` : 'Show on the wall'}>
                              {d.expanded ? (p === 'folded' ? <Smartphone size={11} /> : <TabletSmartphone size={11} />) : null}
                              {d.expanded ? (p === 'folded' ? 'Folded' : 'Expanded') : on ? 'Shown' : 'Show'}
                            </button>
                          );
                        })}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {engine === 'remote' && Number.isFinite(budget) && (
          <div className={s.editorFoot} data-warn={count > budget ? 'true' : undefined}>
            Controlled Chromium: {Math.min(count, budget)} of {budget} pages available to the wall{count > budget ? ` — ${count - budget} will stay paused` : ''}.
          </div>
        )}
      </div>
    </Popover>
  );
}
