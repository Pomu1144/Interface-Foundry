import { studio, useStudio, type PreviewSource, type RouteEntry } from '@/store';
import { api } from '@/modules/project-adapter/server-api';
import { previews } from '@/modules/preview-runtime/registry';
import { DEMO_ROUTES } from '@/modules/project-adapter/projects';
import { getProjectFiles, updateProjectFile } from '@/modules/project-storage/storage';
import type { SourceFile } from '@/modules/export-engine/patch';

/**
 * Uniform access to a project's source files, whatever the preview source:
 *
 *  - vfs   imported static project — IndexedDB is the source of truth; saving
 *          re-uploads the file to the preview VFS (direct, the user owns it)
 *  - demo  bundled Harborline sources — read-only
 *  - fs    authorised local root — reads through the companion, writes only
 *          through the approval flow (prepare → review → write)
 *  - proxy / url — no source access (rendered DOM only)
 */

export type SourceEntry = { path: string; size: number; type: 'file' | 'dir' };

export type SourceAccess = {
  kind: 'vfs' | 'demo' | 'fs' | 'none';
  readOnly: boolean;
  writeMode: 'direct' | 'approval' | 'none';
  label: string;
  reason?: string;
};

export type SourceRead = { path: string; text: string | null; base64: string | null; mime: string; size: number; sha256?: string };

export function sourceAccess(source: PreviewSource | null): SourceAccess {
  switch (source?.kind) {
    case 'vfs':
      return { kind: 'vfs', readOnly: false, writeMode: 'direct', label: 'Imported project (stored in this browser)' };
    case 'demo':
      return { kind: 'demo', readOnly: true, writeMode: 'none', label: 'Harborline demo', reason: 'Demo sources are read-only. Duplicate the demo as an editable project to change files.' };
    case 'fs':
      return { kind: 'fs', readOnly: false, writeMode: 'approval', label: 'Local directory', reason: 'Writes to local files need your approval for every change.' };
    case 'proxy':
      return { kind: 'none', readOnly: true, writeMode: 'none', label: 'Local dev server', reason: 'Sources of a proxied dev server are not readable by IFDY. Edit them in your own editor; IFDY exports reviewable CSS overrides and patches.' };
    case 'url':
      return { kind: 'none', readOnly: true, writeMode: 'none', label: 'Public URL', reason: 'Only the rendered page is available for public URLs. IFDY can export CSS overrides, not source edits.' };
    default:
      return { kind: 'none', readOnly: true, writeMode: 'none', label: 'No project', reason: 'Open a project to browse its files.' };
  }
}

export const sourceKey = (s: PreviewSource | null) =>
  !s ? 'none' : s.kind === 'vfs' ? `vfs:${s.projectId}` : s.kind === 'fs' ? `fs:${s.rootId}` : s.kind === 'demo' ? 'demo' : `${s.kind}:${s.label}`;

/* ------------------------------------------------------------------ */
/* Change notifications (file saved / project switched)                */
/* ------------------------------------------------------------------ */

let version = 0;
const listeners = new Set<() => void>();
export function sourcesVersion() {
  return version;
}
export function onSourcesChanged(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
const listingCache = new Map<string, Promise<{ entries: SourceEntry[]; truncated: boolean }>>();
const readCache = new Map<string, Promise<SourceRead>>();
let lastChange: { version: number; paths: string[] | null } = { version: 0, paths: null };
/** Paths touched by the latest invalidation (null = everything). */
export function lastSourceChange() {
  return lastChange;
}
export function invalidateSources(path?: string) {
  lastChange = { version: version + 1, paths: path ? [path] : null };
  if (path) {
    for (const k of [...readCache.keys()]) if (k.endsWith(`\u0000${path}`)) readCache.delete(k);
  } else readCache.clear();
  listingCache.clear();
  version++;
  listeners.forEach((l) => l());
}
useStudio.subscribe(
  (s) => sourceKey(s.source),
  () => invalidateSources(),
);

/* ------------------------------------------------------------------ */
/* Listing and reading                                                 */
/* ------------------------------------------------------------------ */

const TEXT_RE = /\.(html?|css|scss|less|m?js|cjs|jsx|tsx?|json|map|md|txt|svg|xml|ya?ml|toml|vue|svelte|astro|csv|webmanifest)$/i;
export const isTextPath = (p: string) => TEXT_RE.test(p) || !/\.[a-z0-9]+$/i.test(p.split('/').pop() ?? '');

export async function listSourceFiles(source: PreviewSource | null): Promise<{ entries: SourceEntry[]; truncated: boolean }> {
  const key = sourceKey(source);
  const cached = listingCache.get(key);
  if (cached) return cached;
  const p = (async () => {
    switch (source?.kind) {
      case 'vfs': {
        const files = await getProjectFiles(source.projectId);
        return { entries: withDirs(files.map((f) => ({ path: f.path, size: f.data.byteLength, type: 'file' as const }))), truncated: false };
      }
      case 'demo':
        return api<{ entries: SourceEntry[]; truncated: boolean }>('/api/source/demo/list');
      case 'fs':
        return api<{ entries: SourceEntry[]; truncated: boolean }>(`/api/fs/list?root=${encodeURIComponent(source.rootId)}`);
      default:
        return { entries: [], truncated: false };
    }
  })();
  listingCache.set(key, p);
  p.catch(() => listingCache.delete(key));
  return p;
}

function withDirs(files: SourceEntry[]): SourceEntry[] {
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.path.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  return [...[...dirs].map((d) => ({ path: d, size: 0, type: 'dir' as const })), ...files];
}

const decoder = new TextDecoder('utf-8', { fatal: false });
const toB64 = (buf: ArrayBuffer) => {
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const mimeOf = (p: string) => {
  const ext = p.split('.').pop()?.toLowerCase() ?? '';
  return (
    { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm' } as Record<string, string>
  )[ext] ?? (isTextPath(p) ? 'text/plain' : 'application/octet-stream');
};

export async function readSourceFile(source: PreviewSource | null, path: string): Promise<SourceRead> {
  const key = `${sourceKey(source)}\u0000${path}`;
  const cached = readCache.get(key);
  if (cached) return cached;
  const p = (async (): Promise<SourceRead> => {
    switch (source?.kind) {
      case 'vfs': {
        const files = await getProjectFiles(source.projectId);
        const f = files.find((x) => x.path === path);
        if (!f) throw new Error(`${path} is not part of this project`);
        const text = isTextPath(path);
        return { path, text: text ? decoder.decode(f.data) : null, base64: text ? null : toB64(f.data), mime: mimeOf(path), size: f.data.byteLength };
      }
      case 'demo':
      case 'fs': {
        const url = source.kind === 'demo' ? `/api/source/demo?path=${encodeURIComponent(path)}` : `/api/fs/read?root=${encodeURIComponent(source.rootId)}&path=${encodeURIComponent(path)}`;
        const r = await api<{ encoding: 'utf8' | 'base64'; content: string; size: number; sha256: string; mime: string }>(url);
        return { path, text: r.encoding === 'utf8' ? r.content : null, base64: r.encoding === 'base64' ? r.content : null, mime: r.mime || mimeOf(path), size: r.size, sha256: r.sha256 };
      }
      default:
        throw new Error('This project has no readable source files.');
    }
  })();
  readCache.set(key, p);
  p.catch(() => readCache.delete(key));
  return p;
}

/** Load text sources relevant to patch generation (CSS + HTML always, scripts on request). */
export async function loadTextSources(source: PreviewSource | null, opts: { scripts?: boolean; limit?: number } = {}): Promise<SourceFile[] | null> {
  const access = sourceAccess(source);
  if (access.kind === 'none') return null;
  const { entries } = await listSourceFiles(source);
  const wanted = entries.filter((e) => e.type === 'file' && e.size < 1_500_000 && (/\.(css|html?)$/i.test(e.path) || (opts.scripts && /\.(m?js|jsx|tsx?|vue|svelte)$/i.test(e.path))));
  const limited = wanted.slice(0, opts.limit ?? 500);
  const out: SourceFile[] = [];
  await Promise.all(
    limited.map(async (e) => {
      try {
        const r = await readSourceFile(source, e.path);
        if (r.text !== null) out.push({ path: e.path, text: r.text });
      } catch {
        /* unreadable file: skip */
      }
    }),
  );
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Hashes of files as last read (for conflict detection on approval writes). */
export async function sourceHash(source: PreviewSource | null, path: string): Promise<string | undefined> {
  try {
    return (await readSourceFile(source, path)).sha256;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Writing (VFS)                                                       */
/* ------------------------------------------------------------------ */

const encoder = new TextEncoder();

/** Save files of an imported project: IndexedDB first, then the preview VFS. */
export async function saveVfsFiles(projectId: string, files: { path: string; text: string }[]) {
  for (const f of files) {
    const bytes = encoder.encode(f.text);
    await updateProjectFile(projectId, f.path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  }
  await api(`/api/vfs/${projectId}?replace=0`, { method: 'PUT', json: { files: files.map((f) => ({ path: f.path, text: f.text })) } });
  for (const f of files) invalidateSources(f.path);
}

/**
 * Reload every visible preview so it picks up changed source files. Uses the
 * agent (`location.reload()`), which keeps the session and re-applies live
 * edits on hello; falls back to the canvas reload when nothing is connected.
 */
export function reloadSourcePreviews() {
  const conns = previews.ready().filter((c) => studio().instances[c.id]?.role !== 'worker');
  if (!conns.length) {
    studio().reloadPreview();
    return;
  }
  for (const c of conns) {
    studio().upsertInstance(c.id, { status: 'loading', error: undefined });
    c.tell('nav.reload');
  }
}

/* ------------------------------------------------------------------ */
/* Paths from component annotations / source maps                      */
/* ------------------------------------------------------------------ */

/** Map a reported source file (e.g. "demo/src/components/login-form.js", "/abs/root/src/x.tsx", "webpack:///./src/x.js") to a project path. */
export function projectPathFor(source: PreviewSource | null, file: string, known: string[] = []): string {
  let p = file.replace(/^webpack:\/\/\/?/, '').replace(/^file:\/\//, '').replace(/[?#].*$/, '').replace(/\\/g, '/');
  try {
    if (/^https?:\/\//.test(p)) p = new URL(p).pathname;
  } catch {
    /* keep */
  }
  if (source?.kind === 'demo') p = p.replace(/^\/?demo\//, '');
  if (source?.kind === 'vfs') p = p.replace(new RegExp(`^/?p/${source.projectId}/`), '');
  if (source?.kind === 'fs') {
    const root = studio().server.capabilities?.fs.roots.find((r) => r.id === source.rootId)?.path;
    if (root && p.startsWith(root.replace(/\\/g, '/'))) p = p.slice(root.length);
    p = p.replace(new RegExp(`^/?fs/${source.rootId}/`), '');
  }
  p = p.replace(/^\.?\//, '');
  if (known.length && !known.includes(p)) {
    // Longest suffix match against the project's files.
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) {
      const suffix = parts.slice(i).join('/');
      const hit = known.find((k) => k === suffix || k.endsWith(`/${suffix}`));
      if (hit) return hit;
    }
  }
  return p;
}

/* ------------------------------------------------------------------ */
/* Demo duplication                                                    */
/* ------------------------------------------------------------------ */

/** Copy the read-only demo into an editable imported project, keeping current edits. */
export async function duplicateDemoAsProject(name = 'Harborline (editable copy)') {
  const { files } = await api<{ files: { path: string; base64: string }[] }>('/api/source/demo/all');
  const s = studio();
  const carry = { changes: s.changes, tokens: s.tokens, assets: s.assets, captures: s.captures, route: s.currentRoute };
  const { importStaticProject } = await import('@/modules/project-adapter/projects');
  const decoded = files.map((f) => {
    const bin = atob(f.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { path: f.path, data: bytes.buffer };
  });
  const id = await importStaticProject(name, decoded);
  const routes: RouteEntry[] = DEMO_ROUTES;
  useStudio.setState({ routes, currentRoute: carry.route || '#/login', changes: carry.changes, tokens: carry.tokens, assets: carry.assets, captures: carry.captures, undoStack: [], redoStack: [] });
  const { saveProjectNow } = await import('@/modules/project-storage/storage');
  await saveProjectNow();
  return id;
}
