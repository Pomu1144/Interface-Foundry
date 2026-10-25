import { openDB, type IDBPDatabase } from 'idb';
import type { A11yIssue, Change, DesignToken, DeviceProfile, ResponsiveIssue, Scenario, ViewportState } from '@shared/types';
import { studio, useStudio, type AssetRef, type CaptureRef, type ProjectMeta, type RouteEntry, type Settings, type StudioState, type StylePreset } from '@/store';

/**
 * Local project persistence (IndexedDB). Stores the workspace configuration,
 * edits, tokens, assets, scenarios, screenshots and baselines per project.
 * Secrets are never persisted: fixtures marked as secrets and AI keys stay out.
 */
export type SavedProject = {
  version: 1;
  project: ProjectMeta;
  routes: RouteEntry[];
  currentRoute: string;
  changes: Change[];
  tokens: DesignToken[];
  assets: AssetRef[];
  scenarios: Scenario[];
  captures: CaptureRef[];
  stylePresets?: StylePreset[];
  /** Latest audit reports (responsive + accessibility) for this project. */
  audits?: { responsive: ResponsiveIssue[]; a11y: A11yIssue[]; at: number | null };
  baselines: Record<string, string>;
  customDevices: DeviceProfile[];
  viewport: ViewportState;
  compare: StudioState['compare'];
  settings: Partial<Settings>;
  panels: StudioState['panels'];
  savedAt: number;
};

type DB = IDBPDatabase<unknown>;
let dbPromise: Promise<DB> | null = null;

function db(): Promise<DB> {
  if (!dbPromise) {
    dbPromise = openDB('ifdy', 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects');
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
      },
    });
  }
  return dbPromise;
}

export async function loadProject(id: string): Promise<SavedProject | null> {
  const d = await db();
  return ((await d.get('projects', id)) as SavedProject | undefined) ?? null;
}

export async function listProjects(): Promise<SavedProject['project'][]> {
  const d = await db();
  const all = (await d.getAll('projects')) as SavedProject[];
  return all.map((p) => ({ ...p.project, updatedAt: p.savedAt })).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string) {
  const d = await db();
  await d.delete('projects', id);
  await d.delete('files', id);
}

/** Remove every IFDY record stored in this browser. */
export async function clearAllData() {
  const d = await db();
  await d.clear('projects');
  await d.clear('files');
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('ifdy.')) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export async function putProjectFiles(projectId: string, files: { path: string; data: ArrayBuffer }[]) {
  const d = await db();
  await d.put('files', files, projectId);
}

export async function getProjectFiles(projectId: string): Promise<{ path: string; data: ArrayBuffer }[]> {
  const d = await db();
  return ((await d.get('files', projectId)) as { path: string; data: ArrayBuffer }[] | undefined) ?? [];
}

export async function updateProjectFile(projectId: string, path: string, data: ArrayBuffer) {
  const files = await getProjectFiles(projectId);
  const i = files.findIndex((f) => f.path === path);
  if (i >= 0) files[i] = { path, data };
  else files.push({ path, data });
  await putProjectFiles(projectId, files);
}

function snapshot(): SavedProject | null {
  const s = studio();
  if (!s.project) return null;
  const { fixtures: _fixtures, aiConsent: _consent, ...settings } = s.settings;
  return {
    version: 1,
    project: { ...s.project, updatedAt: Date.now() },
    routes: s.routes,
    currentRoute: s.currentRoute,
    changes: s.changes,
    tokens: s.tokens,
    assets: s.assets,
    scenarios: s.scenarios.filter((x) => !x.builtIn),
    captures: s.captures,
    stylePresets: s.stylePresets,
    audits: { responsive: s.responsiveIssues, a11y: s.a11yIssues, at: s.auditStatus.at ?? null },
    baselines: s.baselines,
    customDevices: s.customDevices,
    viewport: s.viewport,
    compare: s.compare,
    settings,
    panels: s.panels,
    savedAt: Date.now(),
  };
}

export async function saveProjectNow() {
  const snap = snapshot();
  if (!snap) return;
  useStudio.setState({ saveStatus: 'saving' });
  try {
    const d = await db();
    await d.put('projects', snap, snap.project.id);
    useStudio.setState({ saveStatus: 'saved' });
  } catch (err) {
    console.error('[ifdy] save failed', err);
    useStudio.setState({ saveStatus: 'error' });
  }
}

/** Debounced autosave whenever persisted state changes. */
export function startAutosave() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (!studio().project) return;
    if (timer) clearTimeout(timer);
    useStudio.setState({ saveStatus: 'unsaved' });
    timer = setTimeout(() => void saveProjectNow(), 700);
  };
  const keys = ['changes', 'tokens', 'assets', 'stylePresets', 'scenarios', 'captures', 'baselines', 'customDevices', 'viewport', 'compare', 'settings', 'currentRoute', 'panels', 'responsiveIssues', 'a11yIssues'] as const;
  for (const k of keys) useStudio.subscribe((s) => s[k], schedule);
  window.addEventListener('beforeunload', (e) => {
    if (studio().saveStatus === 'unsaved' || studio().saveStatus === 'saving') {
      void saveProjectNow();
      e.preventDefault();
    }
  });
}
