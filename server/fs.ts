import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HttpError, mimeFor, safeJoin } from './http';

/**
 * Filesystem access for the companion, restricted to the directories the user
 * explicitly authorised with IFDY_ALLOWED_ROOTS.
 *
 *  - Every path is resolved with `safeJoin` (no `..` traversal) and then with
 *    `fs.realpath`, so symlinks that point outside the root are rejected.
 *  - `.git` internals are never read or written through these helpers.
 *  - Reads and listings are size/entry limited.
 *  - Writes are two-step: `prepareWrites` validates and summarises the request
 *    and returns a one-time approval token; only `executeWrites` with that token
 *    touches the disk, and it re-checks that nothing changed in between.
 */

export const FS_LIMITS = {
  maxReadText: 2 * 1024 * 1024,
  maxReadBinary: 12 * 1024 * 1024,
  maxWriteFile: 5 * 1024 * 1024,
  maxWriteTotal: 24 * 1024 * 1024,
  maxWriteFiles: 200,
  maxListEntries: 6000,
  maxDepth: 14,
  approvalTtlMs: 5 * 60 * 1000,
};

export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.cache',
  '.turbo',
  '.parcel-cache',
  '.vite',
  '.output',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.DS_Store',
]);

const TEXT_EXT = new Set([
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'json', 'jsonc', 'map', 'md', 'mdx', 'txt',
  'svg', 'xml', 'yml', 'yaml', 'toml', 'ini', 'vue', 'svelte', 'astro', 'csv', 'env', 'gitignore', 'editorconfig', 'npmrc', 'lock', 'webmanifest', 'graphql', 'gql', 'sh',
]);

export type FsEntry = { path: string; type: 'file' | 'dir'; size: number; mtime: number };
export type FsFile = { path: string; encoding: 'utf8' | 'base64'; content: string; size: number; mtime: number; sha256: string; mime: string };

export const sha256 = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function rootFor(roots: string[], rootId: string | null | undefined): string {
  if (rootId === null || rootId === undefined || !/^\d+$/.test(String(rootId))) throw new HttpError(400, 'A root id is required');
  const root = roots[Number(rootId)];
  if (!root) throw new HttpError(403, 'This directory is not an allowed root (set IFDY_ALLOWED_ROOTS)');
  return root;
}

/** Normalised project-relative POSIX path, or throws. */
export function cleanRelative(rel: string): string {
  if (typeof rel !== 'string') throw new HttpError(400, 'path must be a string');
  const p = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (p.includes('\0')) throw new HttpError(400, 'Invalid path');
  const parts = p.split('/').filter((s) => s && s !== '.');
  if (parts.some((s) => s === '..')) throw new HttpError(403, 'Path escapes the allowed root');
  if (parts.some((s) => s.toLowerCase() === '.git')) throw new HttpError(403, 'Access to .git internals is not allowed');
  return parts.join('/');
}

/**
 * Resolve `rel` inside `root`, following symlinks, and reject anything that
 * ends up outside the root. For paths that do not exist yet (new files), the
 * nearest existing ancestor must resolve inside the root.
 */
export async function resolveInside(root: string, rel: string, opts: { mustExist?: boolean } = {}): Promise<string> {
  const clean = cleanRelative(rel);
  const joined = safeJoin(root, clean || '.');
  if (!joined) throw new HttpError(403, 'Path escapes the allowed root');
  let rootReal: string;
  try {
    rootReal = await realpath(root);
  } catch {
    throw new HttpError(404, 'The allowed root does not exist');
  }
  try {
    const real = await realpath(joined);
    if (!isInside(rootReal, real)) throw new HttpError(403, 'Path resolves outside the allowed root (symlink)');
    return real;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    if (opts.mustExist) throw new HttpError(404, `Not found: ${clean}`);
    // Walk up to the nearest existing ancestor.
    let cur = path.dirname(joined);
    for (;;) {
      try {
        const real = await realpath(cur);
        if (!isInside(rootReal, real)) throw new HttpError(403, 'Path resolves outside the allowed root (symlink)');
        return path.join(real, path.relative(cur, joined));
      } catch (e) {
        if (e instanceof HttpError) throw e;
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        const up = path.dirname(cur);
        if (up === cur || !isInside(path.resolve(root), up)) throw new HttpError(404, 'Parent directory not found');
        cur = up;
      }
    }
  }
}

export function isTextPath(p: string): boolean {
  const base = p.split('/').pop() ?? p;
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : base.toLowerCase();
  return TEXT_EXT.has(ext);
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Recursive listing (breadth-first) skipping build output and VCS folders. */
export async function listTree(root: string, dir = '', opts: { maxEntries?: number; maxDepth?: number } = {}): Promise<{ entries: FsEntry[]; truncated: boolean }> {
  const maxEntries = opts.maxEntries ?? FS_LIMITS.maxListEntries;
  const maxDepth = opts.maxDepth ?? FS_LIMITS.maxDepth;
  const start = await resolveInside(root, dir, { mustExist: true });
  const rootReal = await realpath(root);
  const entries: FsEntry[] = [];
  let truncated = false;
  const queue: { abs: string; rel: string; depth: number }[] = [{ abs: start, rel: cleanRelative(dir), depth: 0 }];
  while (queue.length) {
    const { abs, rel, depth } = queue.shift()!;
    let names: string[];
    try {
      names = (await readdir(abs)).sort((a, b) => a.localeCompare(b));
    } catch {
      continue;
    }
    for (const name of names) {
      if (IGNORED_DIRS.has(name)) continue;
      const childAbs = path.join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      let st;
      try {
        st = await lstat(childAbs);
        if (st.isSymbolicLink()) {
          const real = await realpath(childAbs);
          if (!isInside(rootReal, real)) continue; // never follow links out of the root
          st = await stat(real);
        }
      } catch {
        continue;
      }
      if (entries.length >= maxEntries) {
        truncated = true;
        break;
      }
      if (st.isDirectory()) {
        entries.push({ path: childRel, type: 'dir', size: 0, mtime: st.mtimeMs });
        if (depth + 1 < maxDepth) queue.push({ abs: childAbs, rel: childRel, depth: depth + 1 });
        else truncated = true;
      } else if (st.isFile()) {
        entries.push({ path: childRel, type: 'file', size: st.size, mtime: st.mtimeMs });
      }
    }
    if (truncated && entries.length >= maxEntries) break;
  }
  return { entries, truncated };
}

export async function readInside(root: string, rel: string): Promise<FsFile> {
  const abs = await resolveInside(root, rel, { mustExist: true });
  const st = await stat(abs);
  if (!st.isFile()) throw new HttpError(400, 'Not a file');
  const text = isTextPath(rel);
  if (st.size > (text ? FS_LIMITS.maxReadText : FS_LIMITS.maxReadBinary)) throw new HttpError(413, `File is too large to open (${Math.round(st.size / 1024)} KB)`);
  const buf = await readFile(abs);
  const binary = !text || looksBinary(buf);
  return {
    path: cleanRelative(rel),
    encoding: binary ? 'base64' : 'utf8',
    content: binary ? buf.toString('base64') : buf.toString('utf8'),
    size: st.size,
    mtime: st.mtimeMs,
    sha256: sha256(buf),
    mime: mimeFor(abs),
  };
}

/* ------------------------------------------------------------------ */
/* One-time approval tokens                                            */
/* ------------------------------------------------------------------ */

export type Approval<T> = { token: string; kind: string; scope: string; payload: T; expiresAt: number; createdAt: number };

/**
 * Holds prepared write operations until the user approves them. Tokens are
 * random, bound to an operation kind and scope (root), expire, and can be
 * consumed exactly once. The approved payload is stored server-side, so the
 * executing request cannot swap in different content.
 */
export class ApprovalStore {
  private pending = new Map<string, Approval<unknown>>();
  constructor(private ttlMs = FS_LIMITS.approvalTtlMs) {}

  create<T>(kind: string, scope: string, payload: T): { token: string; expiresAt: number } {
    this.sweep();
    if (this.pending.size > 64) {
      const oldest = [...this.pending.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
      if (oldest) this.pending.delete(oldest.token);
    }
    const token = randomBytes(18).toString('base64url');
    const now = Date.now();
    this.pending.set(token, { token, kind, scope, payload, createdAt: now, expiresAt: now + this.ttlMs });
    return { token, expiresAt: now + this.ttlMs };
  }

  consume<T>(token: unknown, kind: string, scope?: string): T {
    this.sweep();
    if (typeof token !== 'string' || !token) throw new HttpError(403, 'This write needs an approval token from the prepare step');
    const entry = this.pending.get(token);
    if (!entry) throw new HttpError(403, 'Approval token is invalid, expired or already used — prepare the operation again');
    if (entry.kind !== kind || (scope !== undefined && entry.scope !== scope)) throw new HttpError(403, 'Approval token was issued for a different operation');
    this.pending.delete(token);
    return entry.payload as T;
  }

  cancel(token: string) {
    this.pending.delete(token);
  }

  private sweep() {
    const now = Date.now();
    for (const [k, v] of this.pending) if (v.expiresAt < now) this.pending.delete(k);
  }
}

/* ------------------------------------------------------------------ */
/* Two-step writes                                                     */
/* ------------------------------------------------------------------ */

export type WriteRequest = { path: string; text?: string; base64?: string; delete?: boolean; baseSha256?: string | null };

export type PreparedFile = {
  path: string;
  abs: string;
  content: Buffer | null;
  exists: boolean;
  /** Hash of the file on disk at prepare time (null when it does not exist). */
  currentSha256: string | null;
  /** The client edited a different version than what is on disk now. */
  conflict: boolean;
  bytes: number;
  action: 'create' | 'update' | 'delete';
};

export type PreparedWrite = { root: string; files: PreparedFile[]; totalBytes: number };

export async function prepareWrites(root: string, files: WriteRequest[]): Promise<PreparedWrite> {
  if (!Array.isArray(files) || !files.length) throw new HttpError(400, 'files[] required');
  if (files.length > FS_LIMITS.maxWriteFiles) throw new HttpError(413, `Too many files in one write (max ${FS_LIMITS.maxWriteFiles})`);
  const seen = new Set<string>();
  const out: PreparedFile[] = [];
  let total = 0;
  for (const f of files) {
    const rel = cleanRelative(String(f.path ?? ''));
    if (!rel) throw new HttpError(400, 'Empty path');
    if (seen.has(rel)) throw new HttpError(400, `Duplicate path: ${rel}`);
    seen.add(rel);
    const abs = await resolveInside(root, rel);
    let exists = false;
    let currentSha256: string | null = null;
    try {
      const st = await stat(abs);
      if (st.isDirectory()) throw new HttpError(400, `${rel} is a directory`);
      exists = true;
      currentSha256 = sha256(await readFile(abs));
    } catch (err) {
      if (err instanceof HttpError) throw err;
    }
    let content: Buffer | null = null;
    if (!f.delete) {
      content = f.base64 !== undefined ? Buffer.from(String(f.base64), 'base64') : Buffer.from(String(f.text ?? ''), 'utf8');
      if (content.length > FS_LIMITS.maxWriteFile) throw new HttpError(413, `${rel} exceeds the ${FS_LIMITS.maxWriteFile / 1024 / 1024} MB per-file limit`);
      total += content.length;
    } else if (!exists) throw new HttpError(404, `Cannot delete ${rel}: it does not exist`);
    if (total > FS_LIMITS.maxWriteTotal) throw new HttpError(413, 'The write exceeds the total size limit');
    const conflict = f.baseSha256 !== undefined && f.baseSha256 !== currentSha256;
    out.push({ path: rel, abs, content, exists, currentSha256, conflict, bytes: content?.length ?? 0, action: f.delete ? 'delete' : exists ? 'update' : 'create' });
  }
  return { root, files: out, totalBytes: total };
}

export function summarizePrepared(p: PreparedWrite) {
  return {
    files: p.files.map((f) => ({ path: f.path, action: f.action, bytes: f.bytes, exists: f.exists, conflict: f.conflict, currentSha256: f.currentSha256 })),
    totalBytes: p.totalBytes,
    conflicts: p.files.filter((f) => f.conflict).length,
  };
}

/** Execute an approved write. Re-checks every file and writes atomically (temp + rename). */
export async function executeWrites(p: PreparedWrite): Promise<{ written: string[]; deleted: string[] }> {
  // Nothing may have changed on disk since the user reviewed the diff.
  for (const f of p.files) {
    const abs = await resolveInside(p.root, f.path);
    if (abs !== f.abs) throw new HttpError(409, `${f.path} moved since it was approved`);
    let now: string | null = null;
    try {
      now = sha256(await readFile(abs));
    } catch {
      now = null;
    }
    if (now !== f.currentSha256) throw new HttpError(409, `${f.path} changed on disk after it was reviewed — nothing was written. Review the diff again.`);
  }
  const written: string[] = [];
  const deleted: string[] = [];
  for (const f of p.files) {
    if (f.action === 'delete') {
      await unlink(f.abs);
      deleted.push(f.path);
      continue;
    }
    await mkdir(path.dirname(f.abs), { recursive: true });
    // mkdir may have created directories: re-validate before writing.
    await resolveInside(p.root, f.path);
    const tmp = `${f.abs}.ifdy-${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, f.content ?? Buffer.alloc(0));
    await rename(tmp, f.abs);
    written.push(f.path);
  }
  return { written, deleted };
}
