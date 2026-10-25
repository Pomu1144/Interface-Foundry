import type { EditorState } from '@codemirror/state';
import { toast } from 'sonner';
import { studio, useStudio } from '@/store';
import { listSourceFiles, projectPathFor, sourceAccess, sourceKey } from './sources';

/** Document id for a project file. */
export const fileDocId = (path: string) => `file:${path}`;

export function openFile(path: string, line?: number) {
  const title = path.split('/').pop() ?? path;
  studio().openDoc({ id: fileDocId(path), kind: 'file', title, data: { path, line, reveal: Date.now() } });
}

/** Handle `bus.emit('reveal-in-editor', { file, line })` from any module. */
export async function revealInEditor({ file, line }: { file: string; line?: number }) {
  const s = studio();
  const access = sourceAccess(s.source);
  if (access.kind === 'none') {
    toast.warning('Source files are not available for this project', { description: access.reason });
    return;
  }
  let known: string[] = [];
  try {
    known = (await listSourceFiles(s.source)).entries.filter((e) => e.type === 'file').map((e) => e.path);
  } catch {
    /* listing failed; try the path as-is */
  }
  const path = projectPathFor(s.source, file, known);
  if (known.length && !known.includes(path)) {
    toast.warning(`${file} is not part of this project's sources`, { description: 'The component reports a source file IFDY cannot read (it may live outside the served directory).' });
    return;
  }
  openFile(path, line);
}

/* ------------------------------------------------------------------ */
/* Unsaved editor buffers (kept while switching documents)             */
/* ------------------------------------------------------------------ */

export type Buffer = { state: EditorState; original: string; sha256?: string; key: string };
export const buffers = new Map<string, Buffer>();

/** Paths with unsaved edits, for the file tree. */
export function dirtyPaths(): Set<string> {
  return new Set(useStudio.getState().documents.filter((d) => d.kind === 'file' && d.dirty).map((d) => String(d.data?.path ?? '')));
}

// Buffers belong to one project; drop them when the source changes.
useStudio.subscribe(
  (s) => sourceKey(s.source),
  () => buffers.clear(),
);
