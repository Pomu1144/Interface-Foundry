import { Cpu, GitBranch, Layers3, Wifi, WifiOff } from 'lucide-react';
import { Tooltip } from '@/ui';
import { studio, useStudio } from '@/store';
import { previews } from '@/modules/preview-runtime/registry';
import { refreshSelection } from '@/modules/preview-runtime/sync';
import s from './shell.module.css';

export function StatusBar() {
  const server = useStudio((st) => st.server);
  const primary = useStudio((st) => st.instances.primary);
  const device = useStudio((st) => st.device());
  const info = useStudio((st) => st.selection.info);
  const zoom = useStudio((st) => st.camera.zoom);
  const changes = useStudio((st) => st.changes.length);
  const experiments = useStudio((st) => st.changes.filter((c) => c.experiment).length);
  const editTarget = useStudio((st) => st.editTarget);
  const vp = primary?.viewport;
  const engineLabel = primary?.engine === 'remote' ? 'Chromium (controlled)' : primary?.engine === 'embed' ? 'Embedded (read-only)' : 'Sandboxed frame';
  return (
    <footer className={s.statusBar}>
      <Tooltip content={server.status === 'online' ? 'IFDY companion connected' : 'Companion offline — start with npm run dev'} side="top">
        <span className={s.statusItem} style={{ color: server.status === 'online' ? 'var(--text-2)' : 'var(--danger)' }}>
          {server.status === 'online' ? <Wifi size={11} /> : <WifiOff size={11} />}
          {server.status === 'online' ? 'Companion' : 'Offline'}
        </span>
      </Tooltip>
      <Tooltip content={primary?.error ?? `Preview engine: ${engineLabel}`} side="top">
        <span className={s.statusItem}>
          <span className={s.engineDot} data-status={primary?.status ?? 'idle'} />
          {engineLabel}
        </span>
      </Tooltip>
      {vp && (
        <Tooltip content="Element dimensions are CSS px. Viewport is what the page sees; device pixels = CSS px × DPR." side="top">
          <span className={`${s.statusItem} ${s.statusMono}`}>
            <Cpu size={11} />
            viewport {vp.width}×{vp.height} · DPR {device.pixelRatio} · {Math.round(vp.width * device.pixelRatio)}×{Math.round(vp.height * device.pixelRatio)} device px
          </span>
        </Tooltip>
      )}
      {info && (
        <div className={s.crumbs}>
          {info.path.slice(-6).map((p) => (
            <button
              key={p.id}
              className={s.crumb}
              onClick={() => {
                const st = studio();
                st.select(st.selection.instanceId, p.id, null);
                void refreshSelection();
                previews.get(st.selection.instanceId)?.tell('overlay.watch', { ids: [p.id] });
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      <span className={s.statusSpacer} />
      <Tooltip content="Where new style edits apply. Change in the Design tab." side="top">
        <span className={s.statusItem}>
          <Layers3 size={11} />
          {editTarget.scope === 'element' ? 'This element' : 'All matching'} · {editTarget.media === 'all' ? 'all widths' : editTarget.media === 'at-most' ? `≤ ${vp?.width ?? ''}px` : `≥ ${vp?.width ?? ''}px`}
        </span>
      </Tooltip>
      <button className={s.statusItem} onClick={() => studio().setBottomTab('history')}>
        <GitBranch size={11} />
        {changes} edit{changes === 1 ? '' : 's'}
        {experiments > 0 && ` · ${experiments} experiment${experiments === 1 ? '' : 's'}`}
      </button>
      <span className={`${s.statusItem} ${s.statusMono}`}>{Math.round(zoom * 100)}%</span>
    </footer>
  );
}
