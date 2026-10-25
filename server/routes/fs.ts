import { ApprovalStore, executeWrites, listTree, prepareWrites, readInside, rootFor, summarizePrepared, type PreparedWrite, type WriteRequest } from '../fs';
import { HttpError, readJson } from '../http';
import type { Router } from '../router';
import type { IfdyServices } from '../services';
import { registerGitRoutes } from './git';
import { registerSourceRoutes } from './source';

/**
 * Local filesystem routes for authorised roots (IFDY_ALLOWED_ROOTS).
 *
 *   GET  /api/fs/roots                   allowed roots
 *   GET  /api/fs/list?root=&dir=         recursive listing (limited)
 *   GET  /api/fs/read?root=&path=        read one file (size limited)
 *   POST /api/fs/prepare                 validate + summarise a write → one-time token
 *   POST /api/fs/write { token }         perform exactly the approved write
 *
 * Also registers the git (/api/git/*) and read-only source (/api/source/*)
 * routes, which share the approval store.
 */
export function registerFsRoutes(router: Router, services: IfdyServices) {
  const approvals = new ApprovalStore();
  services.registry.set('approvals', approvals);
  const roots = () => services.config.allowedRoots;

  router.get('/api/fs/roots', () => ({
    roots: roots().map((p, i) => ({ id: String(i), path: p, name: p.split(/[\\/]/).filter(Boolean).pop() ?? p })),
  }));

  router.get('/api/fs/list', async ({ url }) => {
    const rootId = url.searchParams.get('root');
    const root = rootFor(roots(), rootId);
    const { entries, truncated } = await listTree(root, url.searchParams.get('dir') ?? '');
    return { root: rootId, entries, truncated, readOnly: false, writes: 'approval' };
  });

  router.get('/api/fs/read', async ({ url }) => {
    const root = rootFor(roots(), url.searchParams.get('root'));
    const p = url.searchParams.get('path');
    if (!p) throw new HttpError(400, 'path is required');
    return readInside(root, p);
  });

  router.post('/api/fs/prepare', async ({ req }) => {
    const body = await readJson<{ root: string; files: WriteRequest[]; reason?: string }>(req, 40 * 1024 * 1024);
    const root = rootFor(roots(), body.root);
    const prepared = await prepareWrites(root, body.files);
    const { token, expiresAt } = approvals.create<PreparedWrite>('fs.write', String(body.root), prepared);
    return { token, expiresAt, root: String(body.root), rootPath: root, ...summarizePrepared(prepared) };
  });

  router.post('/api/fs/write', async ({ req }) => {
    const body = await readJson<{ token: string; root: string }>(req);
    const prepared = approvals.consume<PreparedWrite>(body.token, 'fs.write', body.root !== undefined ? String(body.root) : undefined);
    const result = await executeWrites(prepared);
    return { ok: true, ...result };
  });

  router.post('/api/fs/cancel', async ({ req }) => {
    const body = await readJson<{ token: string }>(req);
    if (typeof body.token === 'string') approvals.cancel(body.token);
    return { ok: true };
  });

  registerGitRoutes(router, services, approvals);
  registerSourceRoutes(router, services);
}
