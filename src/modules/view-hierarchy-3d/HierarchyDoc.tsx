import { Box, Focus, Image, ImageOff, Layers3, RefreshCw, SquareDashed, Tag, Unplug, type LucideIcon } from 'lucide-react';
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Hierarchy3DNode } from '@shared/protocol';
import { Badge, Button, EmptyState, IconButton, Notice, Spinner } from '@/ui';
import { studio, useStudio, type DocTab } from '@/store';
import { runAction } from '@/app/actions';
import { ancestorsOf, buildTree, normalizeRange, visibleByDepth, visibleIndices, type DepthFilter } from './math';
import { MAX_NODES, refresh, setView, useAutoRefresh, useH3D } from './state';
import { DepthRail } from './DepthRail';
import { Stage } from './Stage';
import s from './hierarchy.module.css';

/**
 * 3D View Hierarchy — the live page's element boxes as an exploded stack
 * (Xcode "Debug View Hierarchy" / Android Studio "Layout Inspector 3D").
 */
export default function HierarchyDoc({ doc }: { doc: DocTab }) {
  void doc;
  useAutoRefresh();
  const project = useStudio((st) => st.project);
  const preview = useStudio(
    useShallow((st) => {
      const p = Object.values(st.instances).find((i) => i.role === 'primary');
      return { status: p?.status ?? 'idle', error: p?.error };
    }),
  );
  const status = useH3D((st) => st.status);
  const error = useH3D((st) => st.error);
  const nodes = useH3D((st) => st.nodes);

  if (!project) {
    return (
      <div className={s.root}>
        <div className={s.center}>
          <Empty
            icon={Layers3}
            title="Explode a live page into layers"
            action={
              <Button variant="primary" onClick={() => runAction('project.openDemo')}>
                Open the Harborline demo
              </Button>
            }
          >
            Open a project to see every element box as a plane in 3D — stacked by DOM depth, tinted by its background, with the page screenshot as the base.
          </Empty>
        </div>
      </div>
    );
  }

  if (!nodes.length) {
    const broken = preview.status === 'crashed' || preview.status === 'error' || preview.status === 'blocked';
    if (broken) {
      return (
        <div className={s.root}>
          <div className={s.center}>
            <Empty
              icon={Unplug}
              title={preview.status === 'blocked' ? 'This preview cannot be inspected' : 'The preview is not responding'}
              action={
                preview.status !== 'blocked' && (
                  <Button variant="secondary" icon={<RefreshCw size={13} />} onClick={() => studio().reloadPreview()}>
                    Reload preview
                  </Button>
                )
              }
            >
              {preview.error ?? 'The 3D view reads element boxes from the primary preview’s agent, which is unavailable.'}
            </Empty>
          </div>
        </div>
      );
    }
    if (status === 'error') {
      return (
        <div className={s.root}>
          <div className={s.center}>
            <div className={s.errorCard}>
              <Notice tone="danger">
                <b>Could not read the layout.</b> {error}
              </Notice>
              <div>
                <Button icon={<RefreshCw size={13} />} onClick={() => void refresh({ forceShot: true })}>
                  Try again
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    if (status === 'ready') {
      return (
        <div className={s.root}>
          <div className={s.center}>
            <Empty icon={Box} title="No visible boxes" action={<Button onClick={() => void refresh({ forceShot: true })}>Refresh</Button>}>
              The page has no rendered elements with a size yet.
            </Empty>
          </div>
        </div>
      );
    }
    return (
      <div className={s.root}>
        <div className={s.center}>
          <div className={s.loading} role="status">
            <div className={s.skeleton} aria-hidden>
              {[0, 0.5, 1].map((t) => (
                <span key={t} className={s.skeletonPlane} style={{ '--t': t } as CSSProperties} />
              ))}
            </div>
            <div className={s.loadingTitle}>{status === 'waiting' || preview.status !== 'ready' ? 'Waiting for the preview…' : 'Reading element boxes…'}</div>
            <div>Boxes come from the live page in the primary preview.</div>
          </div>
        </div>
      </div>
    );
  }

  return <Viewer nodes={nodes} />;
}

/** Empty state with a vector mark (no raster art). */
function Empty({ icon: Icon, title, action, children }: { icon: LucideIcon; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className={s.empty}>
      <span className={s.emptyMark} aria-hidden>
        <Icon size={22} strokeWidth={1.6} />
      </span>
      <EmptyState title={title} action={action}>
        {children}
      </EmptyState>
    </div>
  );
}

const EMPTY_SET: ReadonlySet<number> = new Set();

function Viewer({ nodes }: { nodes: Hierarchy3DNode[] }) {
  const tree = useMemo(() => buildTree(nodes), [nodes]);
  const { range, hidden, solo, isolate, sourceId } = useH3D(
    useShallow((st) => ({
      range: st.range,
      hidden: st.hidden,
      solo: st.solo,
      isolate: st.isolate,
      sourceId: st.sourceId,
    })),
  );
  const selNodeId = useStudio((st) => (st.selection.instanceId === sourceId || st.selection.instanceId === null ? st.selection.nodeId : null));
  const selIndex = selNodeId === null ? null : (tree.indexById.get(selNodeId) ?? null);
  const path = useMemo(() => (selIndex === null ? EMPTY_SET : new Set([selIndex, ...ancestorsOf(tree, selIndex)])), [tree, selIndex]);
  const pathDepths = useMemo(() => new Set([...path].map((i) => nodes[i].depth)), [path, nodes]);

  const filter = useMemo<DepthFilter>(() => {
    const [min, max] = normalizeRange(range ?? [tree.minDepth, tree.maxDepth], tree.minDepth, tree.maxDepth);
    return { min, max, hidden, solo };
  }, [range, hidden, solo, tree]);
  // Planes are grouped by depth once; the level filter toggles whole layers, isolate filters planes.
  const isolateRoot = isolate && selIndex !== null ? selIndex : null;
  const byDepth = useMemo(() => visibleByDepth(nodes, tree, { min: tree.minDepth, max: tree.maxDepth, hidden: [], solo: [] }, isolateRoot), [nodes, tree, isolateRoot]);
  const visible = useMemo(() => visibleIndices(nodes, tree, filter, isolateRoot), [nodes, tree, filter, isolateRoot]);

  return (
    <div className={s.root}>
      <Header nodes={nodes} levels={tree.levels.length} visibleCount={visible.length} selIndex={selIndex} />
      <div className={s.body}>
        <DepthRail tree={tree} filter={filter} pathDepths={pathDepths} visibleCount={visible.length} />
        <Stage nodes={nodes} tree={tree} byDepth={byDepth} filter={filter} selIndex={selIndex} path={path} visible={visible} isolateRoot={isolateRoot} />
      </div>
    </div>
  );
}

function Header({ nodes, levels, visibleCount, selIndex }: { nodes: Hierarchy3DNode[]; levels: number; visibleCount: number; selIndex: number | null }) {
  const st = useH3D(
    useShallow((x) => ({
      refreshing: x.refreshing,
      error: x.error,
      shotStatus: x.shotStatus,
      shotError: x.shotError,
      route: x.route,
      labels: x.labels,
      wireframe: x.wireframe,
      isolate: x.isolate,
      showShot: x.showShot,
    })),
  );
  const vp = useStudio(
    useShallow((x) => {
      const v = Object.values(x.instances).find((i) => i.role === 'primary')?.viewport;
      return { w: v?.width ?? 0, h: v?.height ?? 0 };
    }),
  );
  const isolating = st.isolate && selIndex !== null;
  return (
    <div className={s.header}>
      <span className={s.titleIcon}>
        <Box size={14} />
      </span>
      <div className={s.titleBlock}>
        <span className={s.title}>View hierarchy</span>
        <span className={s.meta}>
          <b>{visibleCount === nodes.length ? nodes.length : `${visibleCount}/${nodes.length}`}</b> boxes · <b>{levels}</b> levels
          {vp.w > 0 && (
            <>
              {' '}
              · {vp.w}×{vp.h}
            </>
          )}
          {st.route && <> · {st.route}</>}
        </span>
      </div>
      {nodes.length >= MAX_NODES && (
        <Badge tone="warning" title={`Only the first ${MAX_NODES.toLocaleString()} boxes (document order) are shown.`}>
          capped at {MAX_NODES.toLocaleString()}
        </Badge>
      )}
      {isolating && <Badge tone="accent">Isolated subtree</Badge>}
      <span className={s.spacer} />
      {st.shotStatus === 'loading' && st.showShot && (
        <span className={s.headerStatus}>
          <Spinner size={11} /> Rendering texture…
        </span>
      )}
      {st.shotStatus === 'error' && st.showShot && (
        <Badge tone="warning" title={st.shotError ?? undefined}>
          Texture unavailable
        </Badge>
      )}
      {st.error && (
        <Badge tone="danger" title={st.error}>
          Refresh failed
        </Badge>
      )}
      <div className={s.toolGroup} role="group" aria-label="Display">
        <IconButton size="sm" label="Labels" active={st.labels} onClick={() => setView({ labels: !st.labels })}>
          <Tag size={13} />
        </IconButton>
        <IconButton size="sm" label="Wireframe" active={st.wireframe} onClick={() => setView({ wireframe: !st.wireframe })}>
          <SquareDashed size={13} />
        </IconButton>
        <IconButton
          size="sm"
          label={selIndex === null ? 'Isolate (select an element first)' : st.isolate ? 'Show everything' : 'Isolate selected subtree'}
          active={isolating}
          disabled={selIndex === null && !st.isolate}
          onClick={() => setView({ isolate: !st.isolate })}
        >
          <Focus size={13} />
        </IconButton>
        <IconButton size="sm" label={st.showShot ? 'Hide screenshot base' : 'Show screenshot base'} active={st.showShot} onClick={() => setView({ showShot: !st.showShot })}>
          {st.showShot ? <Image size={13} /> : <ImageOff size={13} />}
        </IconButton>
      </div>
      <span className={s.vdiv} />
      <IconButton label="Refresh from the live page" onClick={() => void refresh({ forceShot: true })} disabled={st.refreshing}>
        <RefreshCw size={14} className={st.refreshing ? s.spin : undefined} />
      </IconButton>
    </div>
  );
}
