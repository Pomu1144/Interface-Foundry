import { Bot, Check, ClipboardCopy, Crosshair, FlaskConical, MousePointer2, Palette, Redo2, RotateCcw, Ruler, SlidersHorizontal, Type, Undo2, X } from 'lucide-react';
import { useMemo } from 'react';
import type { Change } from '@shared/types';
import { Badge, Button, EmptyState, IconButton, Tooltip } from '@/ui';
import { studio, useStudio } from '@/store';
import { art } from '@/app/art';
import { previews } from '@/modules/preview-runtime/registry';
import { refreshSelection, watchOverlayIds } from '@/modules/preview-runtime/sync';
import { copyText } from '@/modules/canvas/clipboard';
import { changeSummaryMarkdown, describeChange, effectiveChanges } from './changes';
import s from './history.module.css';

const ORIGIN_ICON: Record<Change['origin'], typeof MousePointer2> = {
  inspector: SlidersHorizontal,
  canvas: MousePointer2,
  'box-model': Ruler,
  styles: SlidersHorizontal,
  tokens: Palette,
  ai: Bot,
  experiment: FlaskConical,
  assets: Palette,
  code: Type,
};

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

async function selectTarget(c: Change) {
  const conn = previews.primary();
  if (!conn?.ready) return;
  const id = await conn.call('dom.resolve', { selector: c.target.selector }).catch(() => null);
  if (!id) return;
  studio().select(conn.id, id, c.target.selector);
  void refreshSelection();
  watchOverlayIds();
  conn.tell('node.scrollIntoView', { id });
}

export function HistoryPanel() {
  const changes = useStudio((st) => st.changes);
  const canUndo = useStudio((st) => st.undoStack.length > 0);
  const canRedo = useStudio((st) => st.redoStack.length > 0);
  const effective = useMemo(() => new Set(effectiveChanges(changes).map((c) => c.id)), [changes]);
  const experiments = changes.filter((c) => c.experiment);
  const committed = changes.filter((c) => !c.experiment);
  const pending = changes.filter((c) => c.exportStatus === 'pending').length;

  return (
    <div className={s.root}>
      <div className={s.toolbar}>
        <IconButton size="sm" label="Undo" shortcut="Mod+Z" disabled={!canUndo} onClick={() => studio().undo()}>
          <Undo2 size={13} />
        </IconButton>
        <IconButton size="sm" label="Redo" shortcut="Mod+Shift+Z" disabled={!canRedo} onClick={() => studio().redo()}>
          <Redo2 size={13} />
        </IconButton>
        <span className={s.stat}>
          <b>{committed.length}</b> change{committed.length === 1 ? '' : 's'}
        </span>
        <span className={s.stat}>
          <b>{experiments.length}</b> experiment{experiments.length === 1 ? '' : 's'}
        </span>
        <span className={s.stat}>
          <b>{pending}</b> pending export
        </span>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" icon={<ClipboardCopy size={12} />} disabled={!changes.length} onClick={() => copyText(changeSummaryMarkdown(changes), 'Change summary copied as Markdown')}>
          Copy summary
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw size={12} />}
          disabled={!changes.length}
          onClick={() => {
            if (confirm('Reset the preview to its original state? You can undo this.')) studio().resetChanges();
          }}
        >
          Reset to original
        </Button>
      </div>
      {!changes.length ? (
        <EmptyState art={art.design} title="No edits yet">
          Every visual edit — from the inspector, canvas handles, box model, tokens or an approved AI fix — is recorded here with its original value, viewport and origin. Nothing touches your files until you export.
        </EmptyState>
      ) : (
        <div className={s.list}>
          {experiments.length > 0 && (
            <>
              <div className={s.groupHead}>
                <FlaskConical size={12} /> Experiments <span>reversible trials, kept separate from committed changes</span>
              </div>
              {[...experiments].reverse().map((c) => (
                <ChangeRow key={c.id} c={c} effective={effective.has(c.id)} />
              ))}
            </>
          )}
          <div className={s.groupHead}>
            <Check size={12} /> Changes <span>newest first</span>
          </div>
          {[...committed].reverse().map((c) => (
            <ChangeRow key={c.id} c={c} effective={effective.has(c.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChangeRow({ c, effective }: { c: Change; effective: boolean }) {
  const Icon = ORIGIN_ICON[c.origin] ?? SlidersHorizontal;
  return (
    <div className={s.row} data-superseded={!effective ? 'true' : undefined} data-experiment={c.experiment ? 'true' : undefined}>
      <span className={s.icon} data-origin={c.origin}>
        <Icon size={12} />
      </span>
      <div className={s.main}>
        <div className={s.desc}>{describeChange(c)}</div>
        <div className={s.meta}>
          <span>{time(c.timestamp)}</span>
          <span>
            {c.viewport.deviceName}
            {c.viewport.posture === 'expanded' ? ' · expanded' : ''} · {c.viewport.width}×{c.viewport.height}
          </span>
          <span>{c.kind === 'rule' ? `rule in ${c.target.ruleSource ?? 'stylesheet'}` : c.scope === 'selector' ? 'all matching' : 'this element'}</span>
          {c.media && <span>@media {c.media}</span>}
          {!effective && <span>superseded by a later edit</span>}
        </div>
      </div>
      <Badge tone={c.origin === 'ai' ? 'violet' : c.experiment ? 'molten' : 'outline'}>{c.experiment ? 'experiment' : c.origin}</Badge>
      <Badge tone={c.exportStatus === 'committed' ? 'success' : c.exportStatus === 'exported' ? 'accent' : 'neutral'}>{c.exportStatus}</Badge>
      <div className={s.actions}>
        <Tooltip content="Select target element">
          <button className={s.action} onClick={() => selectTarget(c)} aria-label="Select target">
            <Crosshair size={12} />
          </button>
        </Tooltip>
        {c.experiment && (
          <Tooltip content="Keep: promote to a committed change">
            <button className={s.action} onClick={() => studio().promoteExperiment(c.id)} aria-label="Promote experiment">
              <Check size={12} />
            </button>
          </Tooltip>
        )}
        <Tooltip content="Revert this edit (undoable)">
          <button className={s.action} onClick={() => studio().removeChange(c.id)} aria-label="Revert">
            <X size={12} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
