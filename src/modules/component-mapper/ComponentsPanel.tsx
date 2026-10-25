import { Blocks, ChevronDown, ChevronRight, Component, FileCode2, ListTree, Rows3, Waypoints } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DomNode, DomSnapshot, NodeId } from '@shared/types';
import { Badge, Button, IconButton, SearchInput, Segmented, Spinner } from '@/ui';
import { bus } from '@/lib/events';
import { studio, useStudio } from '@/store';
import { runAction } from '@/app/actions';
import { previews } from '@/modules/preview-runtime/registry';
import { refreshSelection, watchOverlayIds } from '@/modules/preview-runtime/sync';
import { useOverlay } from '@/modules/preview-runtime/overlay-store';
import { EmptyPanel } from '@/modules/export-engine/EmptyPanel';
import s from './components.module.css';

export type ComponentNode = { id: NodeId; name: string; source?: { file: string; line?: number }; children: ComponentNode[]; depth: number };

const parseSource = (raw: string | undefined) => {
  if (!raw) return undefined;
  const m = /^(.*?)(?::(\d+))?(?::\d+)?$/.exec(raw.trim());
  return m ? { file: m[1], line: m[2] ? Number(m[2]) : undefined } : undefined;
};

/** Component instances from the DOM snapshot, nested by DOM ancestry. */
export function componentForest(snap: DomSnapshot | null): { roots: ComponentNode[]; all: ComponentNode[] } {
  const roots: ComponentNode[] = [];
  const all: ComponentNode[] = [];
  if (!snap) return { roots, all };
  const walk = (id: NodeId, parent: ComponentNode | null, depth: number) => {
    const n: DomNode | undefined = snap.nodes[id];
    if (!n || n.type !== 1) return;
    let here = parent;
    let d = depth;
    if (n.component) {
      const node: ComponentNode = { id: n.id, name: n.component, source: parseSource(n.attrs?.find(([k]) => k === 'data-ifdy-source')?.[1]), children: [], depth };
      (parent ? parent.children : roots).push(node);
      all.push(node);
      here = node;
      d = depth + 1;
    }
    for (const c of n.children ?? []) walk(c, here, d);
  };
  walk(snap.rootId, null, 0);
  return { roots, all };
}

export function selectNode(id: NodeId) {
  const conn = previews.get('primary') ?? previews.primary();
  if (!conn?.ready) return;
  studio().select(conn.id, id, null);
  void refreshSelection();
  watchOverlayIds();
  conn.tell('node.scrollIntoView', { id });
}

async function hoverNode(id: NodeId | null) {
  const conn = previews.get('primary') ?? previews.primary();
  if (!id || !conn?.ready) {
    useOverlay.getState().setHover(null);
    return;
  }
  const box = await conn.call('node.box', { id }).catch(() => null);
  if (box) useOverlay.getState().setHover({ instanceId: conn.id, rect: box.borderBox, label: '', nodeId: id });
}

export function ComponentsPanel() {
  const project = useStudio((st) => st.project);
  const dom = useStudio((st) => st.dom);
  const selected = useStudio((st) => st.selection.nodeId);
  const selectionPath = useStudio((st) => st.selection.info?.path);
  const primaryStatus = useStudio((st) => Object.values(st.instances).find((i) => i.role === 'primary')?.status);
  const [mode, setMode] = useState<'tree' | 'names'>('tree');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const { roots, all } = useMemo(() => componentForest(dom), [dom]);
  const byName = useMemo(() => {
    const m = new Map<string, ComponentNode[]>();
    for (const c of all) m.set(c.name, [...(m.get(c.name) ?? []), c]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [all]);
  const counts = useMemo(() => new Map(byName.map(([n, l]) => [n, l.length])), [byName]);
  // The nearest component around the selection.
  const activeId = useMemo(() => {
    if (selected === null) return null;
    const ids = new Set(all.map((c) => c.id));
    if (ids.has(selected)) return selected;
    const path = selectionPath ?? [];
    for (let i = path.length - 1; i >= 0; i--) if (ids.has(path[i].id)) return path[i].id;
    return null;
  }, [selected, selectionPath, all]);

  if (!project) return <EmptyPanel icon={Component} title="No project">Open a project to map rendered elements to components.</EmptyPanel>;
  if (!dom)
    return (
      <EmptyPanel icon={Component} title={primaryStatus === 'loading' ? 'Reading the page…' : 'No DOM yet'}>
        {primaryStatus === 'loading' ? <Spinner /> : 'Components appear once the preview connects.'}
      </EmptyPanel>
    );
  if (!all.length)
    return (
      <EmptyPanel
        icon={Blocks}
        title="Only the rendered DOM is available"
        action={
          <>
            <Button size="sm" onClick={() => studio().setRightTab('component')}>
              Component tab
            </Button>
            <Button size="sm" variant="ghost" onClick={() => runAction('export.open')}>
              Review patches
            </Button>
          </>
        }
      >
        No component annotations were found on this page. React, Vue and Svelte development builds are mapped per element — select one and open the Component tab. Without a mapping, edit through CSS overrides and export them as reviewable patches. For exact mapping add <code>data-ifdy-component</code> and <code>data-ifdy-source</code> attributes.
      </EmptyPanel>
    );

  const q = query.trim().toLowerCase();
  const matches = (c: ComponentNode): boolean => !q || c.name.toLowerCase().includes(q) || c.children.some(matches);

  const renderNode = (c: ComponentNode): React.ReactNode => {
    if (!matches(c)) return null;
    const hasKids = c.children.length > 0;
    const isOpen = q ? true : !collapsed[c.id];
    return (
      <div key={c.id}>
        <div
          className={s.row}
          data-active={activeId === c.id ? 'true' : undefined}
          style={{ paddingLeft: 6 + c.depth * 12 }}
          onClick={() => selectNode(c.id)}
          onMouseEnter={() => void hoverNode(c.id)}
          onMouseLeave={() => void hoverNode(null)}
          data-testid="component-row"
          data-name={c.name}
        >
          <button
            className={s.chev}
            aria-label={isOpen ? 'Collapse' : 'Expand'}
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed((m) => ({ ...m, [c.id]: isOpen }));
            }}
            style={{ visibility: hasKids ? 'visible' : 'hidden' }}
          >
            {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
          <Component size={12} className={s.icon} />
          <span className={s.name}>{c.name}</span>
          {(counts.get(c.name) ?? 0) > 1 && <span className={s.count}>×{counts.get(c.name)}</span>}
          <span style={{ flex: 1 }} />
          {c.source && (
            <IconButton
              size="sm"
              label={`Open ${c.source.file.split('/').pop()}${c.source.line ? `:${c.source.line}` : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                bus.emit('reveal-in-editor', { file: c.source!.file, line: c.source!.line });
              }}
            >
              <FileCode2 size={12} />
            </IconButton>
          )}
        </div>
        {hasKids && isOpen && c.children.map(renderNode)}
      </div>
    );
  };

  return (
    <div className={s.wrap} data-testid="components-panel">
      <div className={s.toolbar}>
        <Segmented
          ariaLabel="Components view"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'tree', label: 'Tree', icon: <ListTree size={12} /> },
            { value: 'names', label: 'By name', icon: <Rows3 size={12} /> },
          ]}
        />
        <span style={{ flex: 1 }} />
        <Badge tone="violet" title="Mapped through data-ifdy-component annotations">
          <Waypoints size={10} /> Annotated
        </Badge>
      </div>
      <div className={s.search}>
        <SearchInput value={query} onChange={setQuery} placeholder={`Filter ${byName.length} components`} />
      </div>
      <div className={s.meta}>
        {all.length} instance{all.length === 1 ? '' : 's'} of {byName.length} component{byName.length === 1 ? '' : 's'} on this route
      </div>
      <div className={s.scroll}>
        {mode === 'tree'
          ? roots.map(renderNode)
          : byName
              .filter(([n]) => !q || n.toLowerCase().includes(q))
              .map(([name, list]) => (
                <div key={name} className={s.nameGroup}>
                  <div className={s.row} onClick={() => selectNode(list[0].id)} data-active={list.some((l) => l.id === activeId) ? 'true' : undefined}>
                    <Component size={12} className={s.icon} />
                    <span className={s.name}>{name}</span>
                    <span style={{ flex: 1 }} />
                    <Badge tone={list.length > 1 ? 'warning' : 'neutral'} title={list.length > 1 ? 'Shared component: source edits affect every instance' : undefined}>
                      {list.length} instance{list.length === 1 ? '' : 's'}
                    </Badge>
                    {list[0].source && (
                      <IconButton
                        size="sm"
                        label="Open source"
                        onClick={(e) => {
                          e.stopPropagation();
                          bus.emit('reveal-in-editor', { file: list[0].source!.file, line: list[0].source!.line });
                        }}
                      >
                        <FileCode2 size={12} />
                      </IconButton>
                    )}
                  </div>
                  {list[0].source && <div className={s.sourceLine}>{list[0].source.file.split('/').slice(-2).join('/')}{list[0].source.line ? `:${list[0].source.line}` : ''}</div>}
                </div>
              ))}
      </div>
    </div>
  );
}
