import { Box, FileCode2, FileText, GitCompare, LayoutGrid, Monitor, X } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Spinner } from '@/ui';
import { studio, useStudio, type DocKind } from '@/store';
import { CanvasView } from '@/modules/canvas/CanvasView';
import s from './shell.module.css';

const CodeEditorDoc = lazy(() => import('@/modules/code-editor/CodeEditorDoc'));
const WallDoc = lazy(() => import('@/modules/device-wall/WallDoc'));
const HierarchyDoc = lazy(() => import('@/modules/view-hierarchy-3d/HierarchyDoc'));
const DiffDoc = lazy(() => import('@/modules/responsive-diff/DiffDoc'));
const ReportDoc = lazy(() => import('@/modules/export-engine/ReportDoc'));

const ICONS: Record<DocKind, typeof Monitor> = {
  canvas: Monitor,
  file: FileCode2,
  wall: LayoutGrid,
  hierarchy: Box,
  diff: GitCompare,
  report: FileText,
  welcome: Monitor,
};

export function DocumentArea() {
  const docs = useStudio((st) => st.documents);
  const active = useStudio((st) => st.activeDocId);
  const activeDoc = docs.find((d) => d.id === active) ?? docs[0];
  return (
    <>
      {docs.length > 1 && (
        <div className={s.docTabs} role="tablist" aria-label="Open documents">
          {docs.map((d) => {
            const Icon = ICONS[d.kind];
            return (
              <button
                key={d.id}
                role="tab"
                aria-selected={d.id === active}
                className={s.docTab}
                data-active={d.id === active ? 'true' : undefined}
                onClick={() => studio().setActiveDoc(d.id)}
                onAuxClick={(e) => e.button === 1 && studio().closeDoc(d.id)}
                title={d.title}
              >
                <Icon size={13} />
                <span className={s.docTabTitle}>{d.title}</span>
                {d.dirty && <span className={s.docDirty} />}
                {!d.pinned && (
                  <span
                    className={s.docClose}
                    role="button"
                    aria-label={`Close ${d.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      studio().closeDoc(d.id);
                    }}
                  >
                    <X size={11} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div className={s.docBody}>
        {/* The canvas stays mounted so previews keep their state while other documents are open. */}
        <div style={{ position: 'absolute', inset: 0, visibility: activeDoc?.kind === 'canvas' ? 'visible' : 'hidden' }}>
          <CanvasView />
        </div>
        {activeDoc && activeDoc.kind !== 'canvas' && (
          <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-canvas)' }}>
            <Suspense
              fallback={
                <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
                  <Spinner size={18} />
                </div>
              }
            >
              {activeDoc.kind === 'file' && <CodeEditorDoc doc={activeDoc} />}
              {activeDoc.kind === 'wall' && <WallDoc doc={activeDoc} />}
              {activeDoc.kind === 'hierarchy' && <HierarchyDoc doc={activeDoc} />}
              {activeDoc.kind === 'diff' && <DiffDoc doc={activeDoc} />}
              {activeDoc.kind === 'report' && <ReportDoc doc={activeDoc} />}
            </Suspense>
          </div>
        )}
      </div>
    </>
  );
}
