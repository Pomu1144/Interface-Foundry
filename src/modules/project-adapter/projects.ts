import { toast } from 'sonner';
import { studio, useStudio, CANVAS_DOC, type PreviewSource, type ProjectMeta, type RouteEntry } from '@/store';
import { DEFAULT_DEVICE_ID } from '@/modules/device-simulator/devices';
import { api, connectCompanion, CompanionError } from './server-api';
import { loadProject, saveProjectNow } from '@/modules/project-storage/storage';

export const DEMO_PROJECT_ID = 'demo-harborline';

export const DEMO_ROUTES: RouteEntry[] = [
  { id: 'login', label: 'Sign in', path: '#/login', group: 'Authentication' },
  { id: 'session-expired', label: 'Session expired', path: '#/session-expired', group: 'Authentication' },
  { id: 'dashboard', label: 'Dashboard', path: '#/dashboard', group: 'Account' },
  { id: 'statement', label: 'Mortgage statement', path: '#/statement', group: 'Account' },
  { id: 'payment', label: 'Payment review', path: '#/payment', group: 'Payments' },
  { id: 'profile', label: 'Account maintenance', path: '#/profile', group: 'Account' },
  { id: 'keyboard', label: 'Keyboard lab', path: '#/keyboard', group: 'Quality' },
];

function resetWorkspaceFor(project: ProjectMeta, routes: RouteEntry[], route: string) {
  const s = studio();
  s.setSource(project.source);
  useStudio.setState({
    project,
    routes,
    currentRoute: route,
    documents: [CANVAS_DOC],
    activeDocId: 'canvas',
    console: [],
    network: [],
    a11yIssues: [],
    responsiveIssues: [],
    changes: [],
    undoStack: [],
    redoStack: [],
    transient: [],
    runs: [],
    dom: null,
    selection: { instanceId: null, nodeId: null, selector: null, info: null, loading: false },
    saveStatus: 'saved',
  });
}

/** Open a project: restores a saved workspace if one exists, otherwise starts fresh. */
export async function openProject(meta: ProjectMeta, routes: RouteEntry[], defaultRoute: string) {
  const saved = await loadProject(meta.id).catch(() => null);
  resetWorkspaceFor({ ...meta, createdAt: saved?.project.createdAt ?? meta.createdAt }, saved?.routes?.length ? saved.routes : routes, saved?.currentRoute || defaultRoute);
  if (saved) {
    useStudio.setState({
      changes: saved.changes ?? [],
      tokens: saved.tokens ?? [],
      assets: saved.assets ?? [],
      scenarios: saved.scenarios?.length ? saved.scenarios : studio().scenarios,
      captures: saved.captures ?? [],
      baselines: saved.baselines ?? {},
      customDevices: saved.customDevices ?? [],
      viewport: saved.viewport ?? studio().viewport,
      compare: saved.compare ?? studio().compare,
      settings: { ...studio().settings, ...(saved.settings ?? {}) },
      panels: saved.panels ?? studio().panels,
      saveStatus: 'saved',
    });
    toast.success(`Restored “${meta.name}”`, { description: `${saved.changes?.length ?? 0} edits, ${saved.scenarios?.length ?? 0} scenarios, ${saved.captures?.length ?? 0} screenshots` });
  } else {
    await saveProjectNow();
  }
  studio().fitCamera();
}

export async function openDemoProject() {
  const now = Date.now();
  if (!studio().server.previewOrigin) await connectCompanion();
  if (studio().viewport.deviceId !== DEFAULT_DEVICE_ID) studio().setViewport({ deviceId: DEFAULT_DEVICE_ID, posture: 'folded' });
  await openProject(
    {
      id: DEMO_PROJECT_ID,
      name: 'Harborline Mortgage',
      source: { kind: 'demo', label: 'Harborline (synthetic)', entry: 'index.html' },
      createdAt: now,
      updatedAt: now,
    },
    DEMO_ROUTES,
    '#/login',
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';

/** Import static files (from a folder picker, drag & drop or zip) into the preview VFS. */
export async function importStaticProject(name: string, files: { path: string; data: ArrayBuffer }[]) {
  if (!files.length) throw new Error('No files selected.');
  // Strip a common top-level folder.
  const first = files[0].path.split('/')[0];
  const common = files.every((f) => f.path.startsWith(first + '/')) ? first + '/' : '';
  const normalized = files.map((f) => ({ path: f.path.slice(common.length), data: f.data }));
  const htmlFiles = normalized.filter((f) => /\.html?$/i.test(f.path)).map((f) => f.path);
  if (!htmlFiles.length) throw new Error('The selection has no HTML files.');
  const entry = htmlFiles.find((p) => /(^|\/)index\.html?$/i.test(p) && !p.includes('/')) ?? htmlFiles.find((p) => /index\.html?$/i.test(p)) ?? htmlFiles[0];
  const id = `${slug(name)}-${Math.random().toString(36).slice(2, 7)}`;
  const toB64 = (buf: ArrayBuffer) => {
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  await api(`/api/vfs/${id}`, { method: 'PUT', json: { files: normalized.map((f) => ({ path: f.path, base64: toB64(f.data) })) } });
  const { putProjectFiles } = await import('@/modules/project-storage/storage');
  await putProjectFiles(id, normalized);
  const now = Date.now();
  await openProject(
    { id, name, source: { kind: 'vfs', label: name, projectId: id, entry }, createdAt: now, updatedAt: now },
    htmlFiles.map((p) => ({ id: p, label: p.replace(/\.html?$/i, ''), path: p, group: 'Pages' })),
    entry,
  );
  return id;
}

/** Re-upload a saved static project's files after the companion restarts. */
export async function ensureVfs(projectId: string) {
  const status = await api<{ exists: boolean }>(`/api/vfs/${projectId}`).catch(() => ({ exists: false }));
  if (status.exists) return true;
  const { getProjectFiles } = await import('@/modules/project-storage/storage');
  const files = await getProjectFiles(projectId);
  if (!files.length) return false;
  const toB64 = (buf: ArrayBuffer) => {
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  await api(`/api/vfs/${projectId}`, { method: 'PUT', json: { files: files.map((f) => ({ path: f.path, base64: toB64(f.data) })) } });
  return true;
}

/** Connect an authorised local dev server (loopback only) through the injecting proxy. */
export async function connectLocalServer(url: string) {
  const r = await api<{ origin: string; target: string }>('/api/proxy', { method: 'POST', json: { url } });
  const target = new URL(url);
  const now = Date.now();
  const id = `local-${slug(target.host)}`;
  await openProject(
    { id, name: target.host, source: { kind: 'proxy', label: target.host, target: r.target, origin: r.origin, entry: target.pathname.replace(/^\//, '') }, createdAt: now, updatedAt: now },
    [{ id: 'root', label: target.pathname || '/', path: target.pathname.replace(/^\//, '') || '', group: 'Routes' }],
    target.hash || '',
  );
}

/** Open a public website. Uses the controlled browser when available, else a plain (read-only) embed. */
export async function openUrl(url: string, opts: { preferEngine?: 'remote' | 'embed' } = {}) {
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`);
  } catch {
    throw new Error('That does not look like a valid URL.');
  }
  const caps = studio().server.capabilities;
  const engine: 'remote' | 'embed' = opts.preferEngine ?? (caps?.browser.available ? 'remote' : 'embed');
  if (engine === 'embed') {
    try {
      const check = await api<{ embeddable: boolean | null; reason: string }>(`/api/frame-check?url=${encodeURIComponent(parsed.href)}`);
      if (check.embeddable === false) {
        toast.warning('This site does not allow embedding', { description: `${check.reason}. Start the controlled browser (Playwright Chromium) to simulate it.` });
      }
    } catch (err) {
      if (!(err instanceof CompanionError)) throw err;
    }
  }
  const now = Date.now();
  const source: PreviewSource = { kind: 'url', label: parsed.host, url: parsed.href, engine };
  await openProject(
    { id: `url-${slug(parsed.host)}`, name: parsed.host, source, createdAt: now, updatedAt: now },
    [{ id: 'root', label: parsed.pathname, path: parsed.href, group: 'URL' }],
    parsed.href,
  );
}

export async function openLocalDirectory(rootId: string, name: string) {
  const now = Date.now();
  await openProject(
    { id: `fs-${rootId}-${slug(name)}`, name, source: { kind: 'fs', label: name, rootId, entry: 'index.html' }, createdAt: now, updatedAt: now },
    [{ id: 'index', label: 'index', path: 'index.html', group: 'Pages' }],
    'index.html',
  );
}

export function closeProject() {
  void saveProjectNow();
  studio().setSource(null);
  useStudio.setState({ project: null, routes: [], currentRoute: '' });
}
