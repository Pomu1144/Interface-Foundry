import type { NodeId } from '@shared/types';
import { bus } from '@/lib/events';
import { studio } from '@/store';
import { makeChange } from '@/modules/change-manager/changes';
import { routeFromUrl as routeForUrl } from '@/modules/project-adapter/source';
import { currentViewportContext } from '@/modules/device-simulator/context';
import type { PreviewConnection } from './connection';
import { heartbeats, useOverlay } from './overlay-store';
import { currentPatchSet, refreshDom, refreshSelection, watchOverlayIds } from './sync';

let entrySeq = 0;
const eid = () => `e${Date.now().toString(36)}${(entrySeq++).toString(36)}`;

/** Route agent events from one connection into the studio store. */
export function wireConnection(conn: PreviewConnection, role: 'primary' | 'compare' | 'wall' | 'worker'): () => void {
  const offs: (() => void)[] = [];
  const isWorker = role === 'worker';
  const routeFromUrl = (url: string) => routeForUrl(studio().source, url);

  offs.push(
    conn.on('hello', async (h) => {
      heartbeats.set(conn.id, Date.now());
      studio().upsertInstance(conn.id, { status: 'ready', url: h.url, title: h.title, viewport: h.viewport, lastHeartbeat: Date.now(), error: undefined });
      if (isWorker) return;
      const s = studio();
      // Re-establish state after (re)load: overrides, mode, environment.
      conn.tell('patch.apply', currentPatchSet());
      conn.tell('mode.set', { mode: s.interaction });
      conn.tell('env.set', { fontScale: s.fontScale });
      if (role === 'primary') {
        const r = routeFromUrl(h.url);
        if (r && r !== s.currentRoute) s.setCurrentRoute(r);
        await refreshDom(conn);
        // Restore selection by selector after reloads.
        if (s.selection.selector && (s.selection.instanceId === conn.id || !s.selection.instanceId)) {
          const id = await conn.call('dom.resolve', { selector: s.selection.selector }).catch(() => null);
          if (id) {
            studio().select(conn.id, id, s.selection.selector);
            void refreshSelection();
          }
        }
      }
      watchOverlayIds();
      bus.emit('preview-hello', { instanceId: conn.id });
    }),
  );
  offs.push(conn.on('heartbeat', () => heartbeats.set(conn.id, Date.now())));

  offs.push(
    conn.on('console', (c) => {
      if (isWorker) return;
      studio().pushConsole({ id: eid(), instanceId: conn.id, level: c.level, args: c.args, timestamp: c.ts, source: c.source, stack: c.stack, count: 1, kind: 'console' });
    }),
  );
  offs.push(
    conn.on('error', (e) => {
      if (isWorker) return;
      studio().pushConsole({
        id: eid(),
        instanceId: conn.id,
        level: 'error',
        args: [e.message],
        timestamp: e.ts,
        source: e.source ? `${e.source}${e.line ? `:${e.line}` : ''}` : undefined,
        stack: e.stack,
        count: 1,
        kind: e.kind === 'promise' ? 'promise' : 'runtime',
      });
    }),
  );
  offs.push(
    conn.on('network', ({ entries }) => {
      if (isWorker) return;
      studio().pushNetwork(entries.map((n) => ({ ...n, id: eid(), instanceId: conn.id, redacted: n.url.includes('REDACTED') })));
    }),
  );

  offs.push(
    conn.on('hover', (h) => {
      if (h.id === null || !h.rect) {
        if (useOverlay.getState().hover?.instanceId === conn.id) useOverlay.getState().setHover(null);
        return;
      }
      useOverlay.getState().setHover({ instanceId: conn.id, rect: h.rect, label: h.label, nodeId: h.id });
    }),
  );
  offs.push(
    conn.on('select', (sel) => {
      studio().select(conn.id, sel.id, null);
      useOverlay.getState().setRects(conn.id, { [sel.id]: sel.rect });
      void refreshSelection();
      watchOverlayIds();
    }),
  );
  offs.push(
    conn.on('dblselect', async ({ id }) => {
      const info = studio().selection.info;
      if (info?.id === id && info.editableText) await conn.call('text.beginEdit', { id }).catch(() => null);
    }),
  );
  offs.push(
    conn.on('contextmenu', (c) => {
      if (isWorker) return;
      // Right-click selects what's under the cursor, then opens the canvas menu there.
      if (c.id !== null) {
        studio().select(conn.id, c.id, null);
        void refreshSelection();
        watchOverlayIds();
      }
      bus.emit('agent-contextmenu', { ...c, instanceId: conn.id });
    }),
  );
  offs.push(conn.on('rects', ({ rects }) => useOverlay.getState().setRects(conn.id, rects as Record<NodeId, never>)));

  let domTimer: ReturnType<typeof setTimeout> | null = null;
  offs.push(
    conn.on('dom.changed', () => {
      if (role !== 'primary') return;
      if (domTimer) clearTimeout(domTimer);
      domTimer = setTimeout(() => {
        void refreshDom(conn);
        if (studio().selection.instanceId === conn.id) void refreshSelection();
      }, 250);
    }),
  );
  offs.push(
    conn.on('navigation', (n) => {
      studio().upsertInstance(conn.id, { url: n.url, title: n.title });
      if (role === 'primary') {
        const r = routeFromUrl(n.url);
        if (r && r !== studio().currentRoute) studio().setCurrentRoute(r);
      }
    }),
  );
  offs.push(conn.on('viewport', (v) => studio().upsertInstance(conn.id, { viewport: v })));
  offs.push(
    conn.on('text.edited', (t) => {
      const s = studio();
      s.commitChange(
        makeChange({
          kind: 'text',
          target: { selector: t.selector, label: s.selection.info?.label ?? t.selector },
          property: 'textContent',
          before: t.before,
          after: t.after,
          viewport: currentViewportContext(),
          origin: 'canvas',
        }),
      );
    }),
  );
  offs.push(
    conn.on('record.step', ({ step }) => {
      const s = studio();
      if (s.recording.active && s.recording.instanceId === conn.id) s.addRecordedStep(step);
    }),
  );
  offs.push(conn.on('key', (k) => bus.emit('agent-key', { ...k, instanceId: conn.id })));
  offs.push(conn.on('wheel', (w) => bus.emit('agent-wheel', { ...w, instanceId: conn.id })));
  offs.push(conn.on('scroll', (sc) => bus.emit('agent-scroll', { ...sc, instanceId: conn.id })));

  return () => {
    offs.forEach((o) => o());
    if (domTimer) clearTimeout(domTimer);
    heartbeats.delete(conn.id);
    useOverlay.getState().clear(conn.id);
  };
}
