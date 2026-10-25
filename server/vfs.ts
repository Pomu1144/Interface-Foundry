import { HttpError } from './http';

/**
 * In-memory virtual file system for imported static projects.
 * Files are uploaded by the studio and served from the isolated preview origin.
 * Nothing is written to disk.
 */
export type VfsFile = { content: Buffer; updatedAt: number };

const MAX_PROJECT_BYTES = 80 * 1024 * 1024;
const MAX_PROJECTS = 24;
const ID_RE = /^[a-zA-Z0-9_-]{4,64}$/;

export class VirtualFileSystem {
  private projects = new Map<string, Map<string, VfsFile>>();

  static validId(id: string) {
    return ID_RE.test(id);
  }

  put(projectId: string, files: { path: string; content: Buffer }[], replace: boolean) {
    if (!VirtualFileSystem.validId(projectId)) throw new HttpError(400, 'Invalid project id');
    let project = this.projects.get(projectId);
    if (!project || replace) {
      project = new Map();
      this.projects.set(projectId, project);
      if (this.projects.size > MAX_PROJECTS) {
        const oldest = this.projects.keys().next().value;
        if (oldest && oldest !== projectId) this.projects.delete(oldest);
      }
    }
    for (const f of files) {
      const p = normalizePath(f.path);
      if (!p) throw new HttpError(400, `Invalid path: ${f.path}`);
      project.set(p, { content: f.content, updatedAt: Date.now() });
    }
    let total = 0;
    for (const f of project.values()) total += f.content.length;
    if (total > MAX_PROJECT_BYTES) {
      this.projects.delete(projectId);
      throw new HttpError(413, 'Project exceeds the 80 MB preview limit');
    }
    return { files: project.size, bytes: total };
  }

  remove(projectId: string, filePath: string) {
    const p = normalizePath(filePath);
    if (p) this.projects.get(projectId)?.delete(p);
  }

  get(projectId: string, filePath: string): VfsFile | null {
    const project = this.projects.get(projectId);
    if (!project) return null;
    const p = normalizePath(filePath || 'index.html');
    if (!p) return null;
    return project.get(p) ?? project.get(p.replace(/\/?$/, '/index.html').replace(/^\//, '')) ?? null;
  }

  has(projectId: string) {
    return this.projects.has(projectId);
  }

  list(projectId: string): string[] {
    return [...(this.projects.get(projectId)?.keys() ?? [])];
  }
}

/** Normalise to a relative POSIX path without traversal; null if invalid. */
export function normalizePath(p: string): string | null {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') return null;
    parts.push(seg);
  }
  return parts.join('/') || null;
}
