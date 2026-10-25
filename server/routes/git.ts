import type { ApprovalStore } from '../fs';
import { rootFor } from '../fs';
import { branches, diff, executeOp, prepareOp, repoInfo, status, type GitOp } from '../git';
import { HttpError, readJson } from '../http';
import type { RouteContext, Router } from '../router';
import type { IfdyServices } from '../services';

/**
 *   GET  /api/git/status?root=           repo info, branch, files, branches
 *   GET  /api/git/diff?root=&path=&staged=1
 *   POST /api/git/prepare { root, action, params } → { token, summary }
 *   POST /api/git/branch  { token }      create or switch (as approved)
 *   POST /api/git/apply   { token }
 *   POST /api/git/commit  { token }
 *
 * Push / pull requests are deliberately not implemented.
 */
export function registerGitRoutes(router: Router, services: IfdyServices, approvals: ApprovalStore) {
  const roots = () => services.config.allowedRoots;

  router.get('/api/git/status', async ({ url }) => {
    const rootId = url.searchParams.get('root');
    const root = rootFor(roots(), rootId);
    const info = await repoInfo(root);
    if (!info.repo) return { root: rootId, ...info, status: null, branches: [] };
    const [st, br] = await Promise.all([status(root), branches(root)]);
    return { root: rootId, ...info, status: st, branches: br };
  });

  router.get('/api/git/diff', async ({ url }) => {
    const root = rootFor(roots(), url.searchParams.get('root'));
    const info = await repoInfo(root);
    if (!info.repo) throw new HttpError(409, info.reason ?? 'Not a git repository');
    return diff(root, { staged: url.searchParams.get('staged') === '1', path: url.searchParams.get('path') ?? undefined });
  });

  router.post('/api/git/prepare', async ({ req }) => {
    const body = await readJson<{ root: string; action: GitOp['action']; params?: Record<string, unknown> }>(req, 8 * 1024 * 1024);
    const root = rootFor(roots(), body.root);
    const { op, summary } = await prepareOp(root, { action: body.action, ...(body.params ?? {}) } as GitOp);
    const { token, expiresAt } = approvals.create(`git.${op.action}`, String(body.root), { root, op });
    return { token, expiresAt, summary };
  });

  const execute = (kinds: GitOp['action'][]) => async ({ req }: RouteContext) => {
    const body = await readJson<{ token: string; root?: string }>(req);
    let payload: { root: string; op: GitOp } | null = null;
    let lastErr: unknown = null;
    for (const k of kinds) {
      try {
        payload = approvals.consume<{ root: string; op: GitOp }>(body.token, `git.${k}`, body.root !== undefined ? String(body.root) : undefined);
        break;
      } catch (err) {
        lastErr = err;
        if (err instanceof HttpError && /different operation/.test(err.message)) continue;
        throw err;
      }
    }
    if (!payload) throw lastErr ?? new HttpError(403, 'Missing approval');
    return executeOp(payload.root, payload.op);
  };

  router.post('/api/git/branch', execute(['branch.create', 'branch.switch']));
  router.post('/api/git/apply', execute(['apply']));
  router.post('/api/git/commit', execute(['commit']));
}
