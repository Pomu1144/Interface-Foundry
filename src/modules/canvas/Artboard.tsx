import { AlertTriangle, RefreshCw, ShieldAlert } from 'lucide-react';
import { useRef } from 'react';
import { Badge, Button, Menu, Spinner } from '@/ui';
import { studio, useStudio } from '@/store';
import { DeviceFrame } from '@/modules/device-simulator/DeviceFrame';
import { DeviceStage } from '@/modules/device-simulator/DeviceStage';
import { useFoldProgress } from '@/modules/device-simulator/motion';
import { RESPONSIVE_ID } from '@/modules/device-simulator/devices';
import { PreviewSurface } from '@/modules/preview-runtime/PreviewSurface';
import type { BoardSpec } from './CanvasView';
import type { PreviewEngine } from '@shared/types';
import s from './canvas.module.css';

export function Artboard({ spec, interactive, zoom }: { spec: BoardSpec; interactive: boolean; zoom: number }) {
  const source = useStudio((st) => st.source)!;
  const route = useStudio((st) => st.currentRoute);
  const settings = useStudio((st) => st.settings);
  const colorScheme = useStudio((st) => st.colorScheme);
  const instance = useStudio((st) => st.instances[spec.instanceId]);
  const tool = useStudio((st) => st.tool);
  const g = spec.geometry;
  const d = spec.device;
  const labelScale = 1 / Math.max(0.35, zoom);

  return (
    <div className={s.board} data-role={spec.role} data-board={spec.instanceId}>
      <div className={s.boardLabel} style={{ transform: `scale(${labelScale})`, transformOrigin: 'left bottom', maxWidth: (spec.slotWidth + 100) / labelScale }}>
        {spec.duplicateId && (
          <button className={s.boardRemove} aria-label={`Remove the ${d.name} duplicate`} title="Remove duplicate" onClick={() => studio().removeDuplicate(spec.duplicateId!)} onPointerDown={(e) => e.stopPropagation()}>
            ×
          </button>
        )}
        <span className={s.boardName}>{d.name}</span>
        <span className={s.boardDims}>
          {g.viewport.width} × {g.viewport.height}
        </span>
        <span className={s.boardMeta}>@{d.pixelRatio}x</span>
        <EnginePicker spec={spec} />
        {d.expanded && (
          <Badge tone={spec.animating ? 'molten' : spec.posture === 'expanded' ? 'accent' : 'neutral'}>
            {spec.animating ? <FoldPercent flat={spec.progress} /> : spec.posture === 'expanded' ? 'Expanded' : 'Folded'}
          </Badge>
        )}
        {spec.orientation === 'landscape' && <Badge tone="outline">Landscape</Badge>}
        {d.verification.level === 'provisional' && (
          <Badge tone="warning" title={d.verification.source + (d.verification.note ? ` ${d.verification.note}` : '')}>
            Provisional
          </Badge>
        )}
        {spec.role === 'compare' && !spec.duplicateId && <Badge tone="violet">Compare</Badge>}
        {spec.duplicateId && <Badge tone="accent">Duplicate</Badge>}
        {instance?.status === 'loading' && <Spinner size={10} />}
      </div>
      <div className={s.frameWrap}>
        <DeviceStage live={spec.role === 'primary'} posture={spec.posture} orientation={spec.orientation} zoom={zoom}>
          <DeviceFrame
            device={d}
            geometry={g}
            orientation={spec.orientation}
            visual={{ progress: spec.progress, animating: spec.animating, style: studio().transition.style }}
            showSystemUI={settings.showSystemUI}
            showHinge={settings.showHinge}
            colorScheme={colorScheme}
            viewportOverlay={<StatusOverlay instanceId={spec.instanceId} />}
            fold3d={spec.expanded ? { folded: spec.folded, expanded: spec.expanded, posture: spec.posture } : undefined}
          >
            <PreviewSurface
              source={source}
              route={route}
              instanceId={spec.instanceId}
              role={spec.role}
              width={g.viewport.width}
              height={g.viewport.height}
              device={d}
              posture={spec.posture}
              orientation={spec.orientation}
              colorScheme={colorScheme}
              interactive={interactive && tool === 'select'}
              engine={spec.engine}
            />
          </DeviceFrame>
        </DeviceStage>
        {d.id === RESPONSIVE_ID && spec.role === 'primary' && <ResponsiveHandles zoom={zoom} />}
      </div>
    </div>
  );
}

const ENGINE_LABEL: Record<PreviewEngine, string> = { auto: 'Auto', chromium: 'Chromium', webkit: 'WebKit', 'ios-simulator': 'Safari · iOS Sim' };

/** Which engine renders this board: iframe (auto), Chromium, WebKit, or Safari in the iOS Simulator. */
function EnginePicker({ spec }: { spec: BoardSpec }) {
  const engines = useStudio((st) => st.server.engines);
  const info = (id: PreviewEngine) => engines?.find((e) => e.id === id);
  const set = (engine: PreviewEngine) => {
    if (spec.duplicateId) studio().updateDuplicate(spec.duplicateId, { engine });
    else if (spec.role === 'primary') studio().setViewport({ engine });
    else studio().setCompare({ partner: { ...studio().compare.partner, engine } });
  };
  // iPhone / iPad boards are better served by Safari's engine; Auto stays the default.
  const apple = spec.device.platform === 'ios';
  const hint = (id: PreviewEngine) => {
    const e = info(id);
    const suggested = apple && id === 'webkit' && e?.available !== false ? ' · suggested' : '';
    if (!e) return id === 'auto' ? 'iframe / default' : suggested ? 'suggested' : undefined;
    return e.available ? `${e.label}${suggested}` : 'Unavailable';
  };
  const current = spec.engine;
  return (
    <Menu
      width={300}
      trigger={
        <button
          className={s.engineChip}
          data-engine={current}
          data-suggest={apple && current === 'auto' && info('webkit')?.available ? 'webkit' : undefined}
          title={apple && current === 'auto' ? 'Rendering engine — WebKit (Safari’s engine) is suggested for this device' : 'Rendering engine'}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {ENGINE_LABEL[current]}
        </button>
      }
      items={[
        { type: 'label', label: 'Render this board with' },
        ...(['auto', 'chromium', 'webkit', 'ios-simulator'] as PreviewEngine[]).map((id) => ({
          label: ENGINE_LABEL[id] === 'Safari · iOS Sim' ? 'Safari (iOS Simulator)' : ENGINE_LABEL[id],
          hint: hint(id),
          checked: current === id,
          disabled: id !== 'auto' && info(id)?.available === false,
          onSelect: () => set(id),
        })),
        { type: 'separator' },
        {
          type: 'label',
          label:
            current === 'webkit'
              ? (info('webkit')?.detail ?? "Safari's engine on this OS, not iOS Safari.")
              : apple && current === 'auto' && info('webkit')?.available
                ? 'Tip: render this iPhone/iPad board with WebKit to see Safari’s engine (not iOS Safari itself).'
                : current === 'ios-simulator'
                ? (info('ios-simulator')?.detail ?? 'Real Mobile Safari; needs the companion on a Mac with Xcode.')
                : current === 'chromium'
                  ? 'Streamed from the companion with full device emulation.'
                  : 'Default: sandboxed iframe (viewport size only) or Chromium for URLs.',
        },
      ]}
    />
  );
}

/** Live percentage while a fold animates; re-renders only itself. */
function FoldPercent({ flat }: { flat: number }) {
  const p = useFoldProgress();
  return <>{Math.round((studio().transition.style === 'reflow' ? flat : p) * 100)}%</>;
}

function StatusOverlay({ instanceId }: { instanceId: string }) {
  const inst = useStudio((st) => st.instances[instanceId]);
  if (!inst) return null;
  if (inst.status === 'loading') return <div className={s.loadingShimmer} />;
  if (inst.status === 'ready' || inst.status === 'idle') return null;
  const crashed = inst.status === 'crashed';
  return (
    <div className={s.statusCard}>
      <div className={s.statusIcon} data-tone={crashed ? 'warning' : 'danger'}>
        {inst.status === 'blocked' ? <ShieldAlert size={18} /> : <AlertTriangle size={18} />}
      </div>
      <div className={s.statusTitle}>{crashed ? 'Preview not responding' : inst.status === 'blocked' ? 'This site cannot be embedded' : 'Preview unavailable'}</div>
      <div className={s.statusText}>{inst.error}</div>
      <Button size="sm" variant="secondary" icon={<RefreshCw size={12} />} onClick={() => studio().reloadPreview()}>
        Reload and re-apply edits
      </Button>
    </div>
  );
}

function ResponsiveHandles({ zoom }: { zoom: number }) {
  const drag = useRef<{ sx: number; sy: number; w: number; h: number; axis: 'x' | 'y' | 'xy' } | null>(null);
  const size = useStudio((st) => st.responsiveSize);
  const start = (axis: 'x' | 'y' | 'xy') => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, w: size.width, h: size.height, axis };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    studio().setResponsiveSize({
      width: d.axis === 'y' ? d.w : d.w + (e.clientX - d.sx) / zoom,
      height: d.axis === 'x' ? d.h : d.h + (e.clientY - d.sy) / zoom,
    });
  };
  const end = (e: React.PointerEvent) => {
    drag.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };
  const common = { onPointerMove: move, onPointerUp: end };
  return (
    <>
      <span className={s.rHandleX} onPointerDown={start('x')} {...common} title="Drag to resize width" />
      <span className={s.rHandleY} onPointerDown={start('y')} {...common} title="Drag to resize height" />
      <span className={s.rHandleXY} onPointerDown={start('xy')} {...common} title="Drag to resize" />
    </>
  );
}
