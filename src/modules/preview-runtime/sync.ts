import type { PatchSet } from '@shared/types';
import { bus } from '@/lib/events';
import { studio, useStudio } from '@/store';
import { buildPatchSet } from '@/modules/change-manager/changes';
import type { PreviewConnection } from './connection';
import { heartbeats, useOverlay } from './overlay-store';
import { previews } from './registry';

/** The patch set every preview should currently have applied. */
export function currentPatchSet(): PatchSet {
  const s = studio();
  const changes = s.transient.length ? [...s.changes, ...s.transient] : s.changes;
  return buildPatchSet(changes, s.tokens, false);
}

export async function refreshDom(conn = previews.primary()) {
  if (!conn?.ready) return;
  try {
    const snap = await conn.call('dom.snapshot', { maxNodes: 6000 });
    studio().setDom(snap);
  } catch {
    /* preview navigating */
  }
}

let selectionSeq = 0;
export async function refreshSelection() {
  const s = studio();
  const conn = previews.get(s.selection.instanceId) ?? previews.primary();
  const id = s.selection.nodeId;
  if (!conn?.ready || id === null) {
    if (id === null) studio().setSelectionInfo(null);
    return;
  }
  const seq = ++selectionSeq;
  try {
    const info = await conn.call('node.info', { id });
    if (seq !== selectionSeq) return;
    studio().setSelectionInfo(info);
    if (info) {
      studio().expandPath(info.path.map((p) => p.id));
      mirrorSelection(conn.id, info.selector);
    }
  } catch {
    if (seq === selectionSeq) studio().setSelectionInfo(null);
  }
}

/** Mirror the selection into the other previews (compare / wall) by selector. */
function mirrorSelection(sourceId: string, selector: string) {
  for (const c of previews.ready()) {
    if (c.id === sourceId || studio().instances[c.id]?.role === 'worker') continue;
    c.call('dom.resolve', { selector })
      .then((id) => {
        useOverlay.getState().setMirror(c.id, id);
        c.tell('overlay.watch', { ids: id ? [id] : [] });
      })
      .catch(() => {});
  }
}

export function watchOverlayIds() {
  const s = studio();
  const conn = previews.get(s.selection.instanceId);
  if (conn?.ready) conn.tell('overlay.watch', { ids: s.selection.nodeId !== null ? [s.selection.nodeId] : [] });
}

/** Subscribe store changes that must be pushed to previews. Call once at startup. */
export function startPreviewSync() {
  let raf = 0;
  const pushPatches = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const set = currentPatchSet();
      previews.broadcast('patch.apply', set, (c) => studio().instances[c.id]?.role !== 'worker');
      // Geometry may change after a style edit.
      setTimeout(() => {
        watchOverlayIds();
        if (studio().selection.nodeId !== null) void refreshSelection();
      }, 60);
    });
  };
  useStudio.subscribe((s) => s.changes, pushPatches);
  useStudio.subscribe((s) => s.transient, pushPatches);
  useStudio.subscribe((s) => s.tokens, pushPatches);

  useStudio.subscribe(
    (s) => s.interaction,
    (mode) => {
      previews.broadcast('mode.set', { mode }, (c) => studio().instances[c.id]?.role !== 'worker');
      if (mode === 'interact') useOverlay.getState().setHover(null);
    },
  );
  useStudio.subscribe(
    (s) => s.fontScale,
    (fontScale) => previews.broadcast('env.set', { fontScale }),
  );
  useStudio.subscribe(
    (s) => s.selection.nodeId,
    (nodeId) => {
      bus.emit('selection-changed', { instanceId: studio().selection.instanceId, nodeId });
      if (nodeId === null) {
        useOverlay.setState({ mirrors: {} });
        for (const c of previews.ready()) c.tell('overlay.watch', { ids: [] });
      }
    },
  );

  // Crash / hang detection from heartbeats.
  setInterval(() => {
    const s = studio();
    const now = Date.now();
    for (const [id, inst] of Object.entries(s.instances)) {
      if (inst.engine !== 'frame' || inst.status !== 'ready') continue;
      const last = heartbeats.get(id) ?? 0;
      if (last && now - last > 7000 && document.visibilityState === 'visible') {
        s.upsertInstance(id, { status: 'crashed', error: `The preview stopped responding ${Math.round((now - last) / 1000)}s ago. Your edits are safe; reload to re-apply them.` });
      }
    }
  }, 2500);
}
