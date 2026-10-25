import { useVirtualizer } from '@tanstack/react-virtual';
import { Braces, ChevronDown, ChevronRight, ChevronsDownUp, CopyPlus, File, FileCode2, FileImage, FileText, FileType2, Folder, FolderOpen, FolderX, Hash, Lock, RefreshCw, ShieldCheck, Type } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { Badge, Button, IconButton, SearchInput, Spinner } from '@/ui';
import { useStudio } from '@/store';
import { EmptyPanel } from '@/modules/export-engine/EmptyPanel';
import { fileDocId, openFile } from './open';
import { duplicateDemoAsProject, listSourceFiles, onSourcesChanged, sourceAccess, sourceKey, sourcesVersion, type SourceEntry } from './sources';
import s from './files.module.css';

type TreeNode = { name: string; path: string; type: 'file' | 'dir'; size: number; children: TreeNode[] };

function buildTree(entries: SourceEntry[]): TreeNode {
  const root: TreeNode = { name: '', path: '', type: 'dir', size: 0, children: [] };
  const dirs = new Map<string, TreeNode>([['', root]]);
  const ensureDir = (path: string): TreeNode => {
    const existing = dirs.get(path);
    if (existing) return existing;
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const parent = ensureDir(parentPath);
    const node: TreeNode = { name: path.slice(parentPath ? parentPath.length + 1 : 0), path, type: 'dir', size: 0, children: [] };
    parent.children.push(node);
    dirs.set(path, node);
    return node;
  };
  for (const e of entries) {
    if (e.type === 'dir') ensureDir(e.path);
    else {
      const parentPath = e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : '';
      ensureDir(parentPath).children.push({ name: e.path.slice(parentPath ? parentPath.length + 1 : 0), path: e.path, type: 'file', size: e.size, children: [] });
    }
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}

function iconFor(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'html' || ext === 'htm') return { Icon: FileCode2, color: 'var(--syn-tag)' };
  if (ext === 'css' || ext === 'scss' || ext === 'less') return { Icon: Hash, color: 'var(--syn-property)' };
  if (['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx'].includes(ext)) return { Icon: FileType2, color: 'var(--syn-number)' };
  if (ext === 'json' || ext === 'map') return { Icon: Braces, color: 'var(--syn-attr)' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico'].includes(ext)) return { Icon: FileImage, color: 'var(--syn-fn)' };
  if (['woff', 'woff2', 'ttf', 'otf'].includes(ext)) return { Icon: Type, color: 'var(--syn-keyword)' };
  if (ext === 'md' || ext === 'txt') return { Icon: FileText, color: 'var(--text-2)' };
  return { Icon: File, color: 'var(--text-3)' };
}

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

export function FilesPanel() {
  const project = useStudio((st) => st.project);
  const source = useStudio((st) => st.source);
  const docs = useStudio((st) => st.documents);
  const activeDocId = useStudio((st) => st.activeDocId);
  const ver = useSyncExternalStore(onSourcesChanged, sourcesVersion);
  const access = sourceAccess(source);
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; entries: SourceEntry[]; truncated: boolean; error?: string }>({ status: 'loading', entries: [], truncated: false });
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ src: true, 'src/styles': true });
  const [duplicating, setDuplicating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const key = sourceKey(source);

  useEffect(() => {
    if (access.kind === 'none') return;
    let cancelled = false;
    setState((st) => ({ ...st, status: st.entries.length ? st.status : 'loading' }));
    listSourceFiles(source)
      .then((r) => !cancelled && setState({ status: 'ready', entries: r.entries, truncated: r.truncated }))
      .catch((err) => !cancelled && setState({ status: 'error', entries: [], truncated: false, error: err instanceof Error ? err.message : String(err) }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ver]);

  const tree = useMemo(() => buildTree(state.entries), [state.entries]);
  const dirty = useMemo(() => new Set(docs.filter((d) => d.kind === 'file' && d.dirty).map((d) => String(d.data?.path ?? ''))), [docs]);
  const activePath = docs.find((d) => d.id === activeDocId && d.kind === 'file')?.data?.path as string | undefined;

  const rows = useMemo(() => {
    const out: { node: TreeNode; depth: number }[] = [];
    const q = query.trim().toLowerCase();
    if (q) {
      for (const e of state.entries) if (e.type === 'file' && e.path.toLowerCase().includes(q)) out.push({ node: { name: e.path, path: e.path, type: 'file', size: e.size, children: [] }, depth: 0 });
      return out.slice(0, 2000);
    }
    const walk = (n: TreeNode, depth: number) => {
      for (const c of n.children) {
        out.push({ node: c, depth });
        if (c.type === 'dir' && open[c.path]) walk(c, depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }, [tree, open, query, state.entries]);

  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => 26, overscan: 12 });

  if (!project) return <EmptyPanel icon={FolderOpen} title="No project">Open a project to browse its source files.</EmptyPanel>;
  if (access.kind === 'none')
    return (
      <EmptyPanel icon={FolderX} title="Source files unavailable">
        {access.reason}
      </EmptyPanel>
    );

  const duplicate = async () => {
    setDuplicating(true);
    try {
      await duplicateDemoAsProject();
      toast.success('Editable copy created', { description: 'Files in the copy can be edited and saved; the preview reloads on save.' });
    } catch (err) {
      toast.error('Could not duplicate the demo', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setDuplicating(false);
    }
  };

  const fileCount = state.entries.filter((e) => e.type === 'file').length;
  return (
    <div className={s.wrap} data-testid="files-panel">
      <div className={s.head}>
        <div className={s.headTitle}>
          <span className={s.label}>{project.name}</span>
          {access.kind === 'demo' ? (
            <Badge tone="outline">
              <Lock size={10} /> Read-only
            </Badge>
          ) : access.kind === 'fs' ? (
            <Badge tone="warning" title={access.reason}>
              <ShieldCheck size={10} /> Approval
            </Badge>
          ) : (
            <Badge tone="success">Editable</Badge>
          )}
        </div>
        <IconButton size="sm" label="Collapse folders" onClick={() => setOpen({})}>
          <ChevronsDownUp size={13} />
        </IconButton>
        <IconButton size="sm" label="Refresh" onClick={() => import('./sources').then((m) => m.invalidateSources())}>
          <RefreshCw size={12} />
        </IconButton>
      </div>
      <div className={s.search}>
        <SearchInput value={query} onChange={setQuery} placeholder={`Filter ${fileCount || ''} files`} />
      </div>
      {access.kind === 'demo' && (
        <div className={s.notice}>
          <span>Demo sources are read-only.</span>
          <Button size="sm" icon={duplicating ? <Spinner /> : <CopyPlus size={12} />} disabled={duplicating} onClick={duplicate} data-testid="duplicate-demo-files">
            Duplicate as editable project
          </Button>
        </div>
      )}
      {state.status === 'loading' && !state.entries.length ? (
        <div className={s.loading}>
          <Spinner />
        </div>
      ) : state.status === 'error' ? (
        <EmptyPanel icon={FolderX} title="Could not list files" tone="danger" compact>
          {state.error}
        </EmptyPanel>
      ) : !rows.length ? (
        <EmptyPanel icon={File} title={query ? 'No matching files' : 'No files'} compact />
      ) : (
        <div className={s.scroller} ref={scrollRef} role="tree" aria-label="Project files">
          <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
            {virtual.getVirtualItems().map((vi) => {
              const { node, depth } = rows[vi.index];
              const isDir = node.type === 'dir';
              const isOpen = isDir && open[node.path];
              const { Icon, color } = isDir ? { Icon: isOpen ? FolderOpen : Folder, color: 'var(--text-2)' } : iconFor(node.name);
              return (
                <div
                  key={node.path}
                  role="treeitem"
                  aria-expanded={isDir ? Boolean(isOpen) : undefined}
                  aria-selected={activePath === node.path}
                  className={s.row}
                  data-active={activePath === node.path ? 'true' : undefined}
                  data-testid={isDir ? 'file-dir' : 'file-row'}
                  data-path={node.path}
                  style={{ transform: `translateY(${vi.start}px)`, paddingLeft: 8 + depth * 12 }}
                  onClick={() => (isDir ? setOpen((o) => ({ ...o, [node.path]: !o[node.path] })) : openFile(node.path))}
                  title={isDir ? node.path : `${node.path} · ${fmtSize(node.size)}`}
                >
                  {Array.from({ length: depth }, (_, i) => (
                    <span key={i} className={s.guide} style={{ left: 14 + i * 12 }} />
                  ))}
                  <span className={s.chev}>{isDir ? isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} /> : null}</span>
                  <Icon size={13} color={color} />
                  <span className={s.name}>{node.name}</span>
                  {!isDir && dirty.has(node.path) && <span className={s.dirty} title="Unsaved changes" />}
                  {!isDir && !query && <span className={s.size}>{fmtSize(node.size)}</span>}
                  {!isDir && docs.some((d) => d.id === fileDocId(node.path)) && !dirty.has(node.path) && <span className={s.openDot} title="Open in editor" />}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {state.truncated && <div className={s.foot}>Listing truncated — large directories are partially shown.</div>}
    </div>
  );
}
