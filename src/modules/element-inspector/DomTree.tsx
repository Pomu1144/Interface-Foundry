import clsx from 'clsx';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  AppWindow,
  Box,
  ChevronRight,
  Columns3,
  Component,
  Eye,
  EyeOff,
  FormInput,
  Grid2x2,
  Image,
  Link2,
  List,
  MousePointerClick,
  PanelTop,
  Rows3,
  Shapes,
  Table,
  Type,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DomNode, DomSnapshot, NodeId } from '@shared/types';
import { EmptyState, SearchInput, Spinner } from '@/ui';
import { studio, useStudio } from '@/store';
import { art } from '@/app/art';
import { previews } from '@/modules/preview-runtime/registry';
import { useOverlay } from '@/modules/preview-runtime/overlay-store';
import { refreshSelection, watchOverlayIds } from '@/modules/preview-runtime/sync';
import { isHidden, toggleHidden } from '@/modules/change-manager/edit';
import { NodeContextMenu } from './NodeContextMenu';
import s from './tree.module.css';

type Row = { node: DomNode; depth: number };

const NON_VISUAL = new Set(['head', 'script', 'style', 'noscript', 'template', 'meta', 'link', 'base', 'title']);

function iconFor(n: DomNode) {
  const t = n.tag ?? '';
  if (n.component) return Component;
  if (t === 'img' || t === 'picture' || t === 'video' || t === 'canvas') return Image;
  if (t === 'svg' || t === 'path') return Shapes;
  if (t === 'a') return Link2;
  if (t === 'button' || n.attrs?.some(([k, v]) => k === 'role' && v === 'button')) return MousePointerClick;
  if (t === 'input' || t === 'textarea' || t === 'select' || t === 'label') return FormInput;
  if (t === 'form') return AppWindow;
  if (t === 'table' || t === 'tbody' || t === 'thead' || t === 'tr') return Table;
  if (t === 'ul' || t === 'ol' || t === 'li' || t === 'dl') return List;
  if (t === 'header' || t === 'nav' || t === 'footer' || t === 'main' || t === 'section' || t === 'aside') return PanelTop;
  if (/^(h[1-6]|p|span|strong|em|small|b|i|label)$/.test(t) || (n.text && !n.children?.length)) return Type;
  if (n.display?.includes('grid')) return Grid2x2;
  if (n.display?.includes('flex')) return n.attrs?.some(([k]) => k === 'data-flex-col') ? Rows3 : Columns3;
  return Box;
}

function layerName(n: DomNode): { name: string; detail?: string } {
  if (n.type === 3) return { name: `“${n.text ?? ''}”` };
  const id = n.idAttr ? `#${n.idAttr}` : '';
  const cls = n.classes?.length ? `.${n.classes.slice(0, 2).join('.')}` : '';
  if (n.component) return { name: n.component, detail: `${n.tag}${id}${cls}` };
  return { name: `${n.tag}${id}${cls}`, detail: n.text };
}

function flatten(snap: DomSnapshot, rootId: NodeId, expanded: Record<NodeId, boolean>, mode: 'layers' | 'dom', filter: string): Row[] {
  const rows: Row[] = [];
  const q = filter.trim().toLowerCase();
  const matches = (n: DomNode) => {
    if (!q) return true;
    const hay = `${n.tag ?? ''} ${n.idAttr ?? ''} ${(n.classes ?? []).join(' ')} ${n.text ?? ''} ${n.component ?? ''}`.toLowerCase();
    return hay.includes(q);
  };
  // When filtering, show matches with their ancestors.
  const keep = new Set<NodeId>();
  if (q) {
    const mark = (id: NodeId, trail: NodeId[]): void => {
      const n = snap.nodes[id];
      if (!n) return;
      if (matches(n)) for (const t of [...trail, id]) keep.add(t);
      for (const c of n.children ?? []) mark(c, [...trail, id]);
    };
    mark(rootId, []);
  }
  const walk = (id: NodeId, depth: number) => {
    const n = snap.nodes[id];
    if (!n) return;
    if (mode === 'layers' && n.type === 1 && NON_VISUAL.has(n.tag ?? '')) return;
    if (q && !keep.has(id)) return;
    rows.push({ node: n, depth });
    const open = q ? true : expanded[id] ?? (depth < 2 && mode === 'dom');
    if (open) for (const c of n.children ?? []) walk(c, depth + 1);
  };
  walk(rootId, 0);
  return rows;
}

export function DomTree({ mode }: { mode: 'layers' | 'dom' }) {
  const snap = useStudio((st) => st.dom);
  const expanded = useStudio((st) => st.expanded);
  const selected = useStudio((st) => st.selection.nodeId);
  const selInstance = useStudio((st) => st.selection.instanceId);
  const project = useStudio((st) => st.project);
  const primaryStatus = useStudio((st) => st.instances.primary?.status);
  const changes = useStudio((st) => st.changes);
  const [filter, setFilter] = useState('');
  const parentRef = useRef<HTMLDivElement>(null);
  void changes;

  const rootId = useMemo(() => {
    if (!snap) return null;
    if (mode === 'dom') return snap.rootId;
    const html = snap.nodes[snap.rootId];
    const body = html?.children?.map((c) => snap.nodes[c]).find((n) => n?.tag === 'body');
    return body?.id ?? snap.rootId;
  }, [snap, mode]);

  const rows = useMemo(() => (snap && rootId !== null ? flatten(snap, rootId, expanded, mode, filter) : []), [snap, rootId, expanded, mode, filter]);

  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => 26, overscan: 12 });

  // Keep the selected row visible.
  useEffect(() => {
    if (selected === null) return;
    const i = rows.findIndex((r) => r.node.id === selected);
    if (i >= 0) virtual.scrollToIndex(i, { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, rows.length]);

  if (!project) return <EmptyState art={art.components} title="No project" />;
  if (!snap) {
    return (
      <EmptyState art={art.components} title={primaryStatus === 'loading' ? 'Reading the page…' : 'No DOM yet'}>
        {primaryStatus === 'loading' ? <Spinner /> : 'The rendered DOM appears here once the preview connects.'}
      </EmptyState>
    );
  }

  const select = (n: DomNode) => {
    if (n.type !== 1) return;
    const conn = previews.get('primary') ?? previews.primary();
    if (!conn) return;
    studio().select(conn.id, n.id, null);
    void refreshSelection();
    watchOverlayIds();
    conn.tell('node.scrollIntoView', { id: n.id });
  };

  const hover = async (n: DomNode | null) => {
    const conn = previews.get('primary');
    if (!n || n.type !== 1 || !conn?.ready) {
      useOverlay.getState().setHover(null);
      return;
    }
    const box = await conn.call('node.box', { id: n.id }).catch(() => null);
    if (box) useOverlay.getState().setHover({ instanceId: conn.id, rect: box.borderBox, label: layerName(n).name, nodeId: n.id });
  };

  return (
    <div className={s.wrap}>
      <div className={s.search}>
        <SearchInput value={filter} onChange={setFilter} placeholder={mode === 'layers' ? 'Filter layers' : 'Search tag, #id, .class or text'} />
      </div>
      <div className={s.meta}>
        {snap.nodeCount.toLocaleString()} nodes{snap.truncated ? ' · truncated (expand to load more)' : ''}
      </div>
      <div ref={parentRef} className={s.scroller} onMouseLeave={() => hover(null)} role="tree" aria-label={mode === 'layers' ? 'Layers' : 'DOM'}>
        <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {virtual.getVirtualItems().map((vi) => {
            const { node: n, depth } = rows[vi.index];
            const isSel = n.id === selected && selInstance !== null;
            const canExpand = (n.children?.length ?? 0) > 0 || n.truncated;
            const open = filter ? true : expanded[n.id] ?? (depth < 2 && mode === 'dom');
            const hidden = n.type === 1 && n.tag ? isHiddenNode(n) : false;
            return (
              <NodeContextMenu key={n.id} nodeId={n.id} disabled={n.type !== 1}>
                <div
                  role="treeitem"
                  aria-selected={isSel}
                  aria-expanded={canExpand ? open : undefined}
                  className={clsx(s.row, isSel && s.selected, !n.visible && n.type === 1 && s.invisible, mode === 'dom' && s.domRow)}
                  style={{ transform: `translateY(${vi.start}px)`, paddingLeft: 6 + depth * 14 }}
                  onClick={() => select(n)}
                  onMouseEnter={() => hover(n)}
                  onDoubleClick={() => canExpand && studio().setExpanded(n.id, !open)}
                >
                  {Array.from({ length: depth }).map((_, i) => (
                    <span key={i} className={s.guide} style={{ left: 13 + i * 14 }} />
                  ))}
                  <button
                    className={s.chevron}
                    data-open={open ? 'true' : undefined}
                    style={{ visibility: canExpand ? 'visible' : 'hidden' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      studio().setExpanded(n.id, !open);
                      if (n.truncated && !open) void loadChildren(n.id);
                    }}
                    tabIndex={-1}
                    aria-label={open ? 'Collapse' : 'Expand'}
                  >
                    <ChevronRight size={11} />
                  </button>
                  {mode === 'layers' ? <LayerLabel n={n} /> : <DomLabel n={n} open={open} />}
                  {mode === 'layers' && n.type === 1 && (
                    <button
                      className={clsx(s.eye, hidden && s.eyeOn)}
                      onClick={async (e) => {
                        e.stopPropagation();
                        const conn = previews.get('primary');
                        const info = await conn?.call('node.info', { id: n.id }).catch(() => null);
                        if (info) toggleHidden(info);
                      }}
                      aria-label={hidden ? 'Show in preview' : 'Hide in preview'}
                      title={hidden ? 'Show in preview' : 'Hide in preview (reversible override)'}
                    >
                      {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  )}
                </div>
              </NodeContextMenu>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Approximate "hidden by IFDY" check using the node's id/class selector candidates. */
function isHiddenNode(n: DomNode): boolean {
  const changes = studio().changes;
  if (!changes.some((c) => c.kind === 'visibility')) return false;
  const candidates = [n.idAttr ? `#${n.idAttr}` : null, n.attrs?.find(([k]) => k === 'data-testid') ? `[data-testid="${n.attrs.find(([k]) => k === 'data-testid')![1]}"]` : null].filter(Boolean) as string[];
  return candidates.some((c) => isHidden(c));
}

async function loadChildren(id: NodeId) {
  const conn = previews.get('primary');
  if (!conn?.ready) return;
  const nodes = await conn.call('dom.children', { id }).catch(() => []);
  const snap = studio().dom;
  if (!snap) return;
  const next = { ...snap.nodes };
  for (const n of nodes) next[n.id] = n;
  studio().setDom({ ...snap, nodes: next });
}

function LayerLabel({ n }: { n: DomNode }) {
  const Icon = n.type === 3 ? Type : iconFor(n);
  const { name, detail } = layerName(n);
  return (
    <>
      <Icon size={13} className={clsx(s.icon, n.component && s.iconComponent)} />
      <span className={clsx(s.name, n.component && s.componentName)}>{name}</span>
      {detail && <span className={s.detail}>{detail}</span>}
    </>
  );
}

function DomLabel({ n, open }: { n: DomNode; open: boolean }) {
  if (n.type === 3) return <span className={s.domText}>{n.text}</span>;
  const attrs: [string, string][] = [];
  if (n.idAttr) attrs.push(['id', n.idAttr]);
  if (n.classes?.length) attrs.push(['class', n.classes.join(' ')]);
  for (const a of n.attrs ?? []) if (a[0] !== 'id' && a[0] !== 'class') attrs.push(a);
  const leafText = n.text && !n.children?.length;
  return (
    <span className={s.domLine}>
      <span className={s.punct}>&lt;</span>
      <span className={s.tag}>{n.tag}</span>
      {attrs.slice(0, 6).map(([k, v]) => (
        <span key={k}>
          {' '}
          <span className={s.attr}>{k}</span>
          <span className={s.punct}>=</span>
          <span className={s.value}>&quot;{v.length > 48 ? v.slice(0, 47) + '…' : v}&quot;</span>
        </span>
      ))}
      <span className={s.punct}>&gt;</span>
      {leafText && (
        <>
          <span className={s.domText}>{n.text}</span>
          <span className={s.punct}>&lt;/</span>
          <span className={s.tag}>{n.tag}</span>
          <span className={s.punct}>&gt;</span>
        </>
      )}
      {!leafText && !open && (n.childCount ?? 0) > 0 && <span className={s.collapsed}>…</span>}
      {n.display === 'flex' || n.display === 'inline-flex' ? <span className={s.badge}>flex</span> : n.display?.includes('grid') ? <span className={s.badge}>grid</span> : null}
      {n.component && <span className={clsx(s.badge, s.badgeComponent)}>{n.component}</span>}
    </span>
  );
}
