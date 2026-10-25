import { readFile } from 'node:fs/promises';
import { DEMO_DIR } from '../config';
import { listTree, readInside, resolveInside } from '../fs';
import { HttpError } from '../http';
import type { Router } from '../router';
import type { IfdyServices } from '../services';

/**
 * Read-only access to the bundled Harborline demo sources (for the code editor,
 * source patches and "Duplicate as editable project"). Nothing here writes.
 *
 *   GET /api/source/demo/list
 *   GET /api/source/demo?path=src/styles/login.css
 *   GET /api/source/demo/all            every file, base64 (for duplication)
 */
export function registerSourceRoutes(router: Router, _services: IfdyServices) {
  router.get('/api/source/demo/list', async () => {
    const { entries, truncated } = await listTree(DEMO_DIR, '');
    return { root: 'demo', entries, truncated, readOnly: true };
  });

  router.get('/api/source/demo', async ({ url }) => {
    const p = url.searchParams.get('path');
    if (!p) throw new HttpError(400, 'path is required');
    // Component annotations use repo-relative paths ("demo/src/...").
    const rel = p.replace(/^\/?demo\//, '');
    return { ...(await readInside(DEMO_DIR, rel)), readOnly: true };
  });

  router.get('/api/source/demo/all', async () => {
    const { entries } = await listTree(DEMO_DIR, '');
    const files: { path: string; base64: string }[] = [];
    let total = 0;
    for (const e of entries) {
      if (e.type !== 'file') continue;
      total += e.size;
      if (total > 40 * 1024 * 1024) throw new HttpError(413, 'Demo is unexpectedly large');
      const abs = await resolveInside(DEMO_DIR, e.path, { mustExist: true });
      files.push({ path: e.path, base64: (await readFile(abs)).toString('base64') });
    }
    return { files };
  });
}
