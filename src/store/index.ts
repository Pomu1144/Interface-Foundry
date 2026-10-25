import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { A11yIssue, Change, ConsoleEntry, DesignToken, DeviceProfile, DomSnapshot, NetworkEntry, NodeId, NodeInfo, ResponsiveIssue, Scenario, ScenarioRun, TestStep, ViewportState } from '@shared/types';
import { BUILT_IN_DEVICES, DEFAULT_DEVICE_ID, RESPONSIVE_ID, responsiveDevice } from '@/modules/device-simulator/devices';
import { canFold } from '@/modules/device-simulator/viewport';
import * as cm from '@/modules/change-manager/changes';
import type {
  AssetRef,
  BottomTab,
  CaptureRef,
  DocTab,
  HoverState,
  InteractionMode,
  LeftTab,
  PreviewInstance,
  PreviewSource,
  ProjectMeta,
  RightTab,
  RouteEntry,
  ServerInfo,
  Settings,
  StylePreset,
  StudioState,
  Tool,
  TransitionState,
} from './types';

export * from './types';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  maskAllInputs: true,
  instrumentEvents: false,
  instrumentNetwork: false,
  minTapSize: 24,
  minFontSize: 12,
  maxLineLength: 110,
  ignoreSelectors: ['[data-ifdy-ignore]'],
  aiProvider: 'heuristic',
  aiConsent: false,
  telemetry: false,
  showRulers: true,
  showSystemUI: true,
  showHinge: true,
  reducedMotion: false,
  diffThreshold: 0.1,
  fixtures: { username: 'demo.borrower', password: 'Harbor!2026' },
};

const CONSOLE_CAP = 2000;
const NETWORK_CAP = 1500;

type Actions = {
  /* project */
  setProject: (p: ProjectMeta | null) => void;
  setSaveStatus: (s: StudioState['saveStatus']) => void;
  setRoutes: (r: RouteEntry[]) => void;
  setCurrentRoute: (path: string) => void;

  /* workspace */
  setLeftTab: (t: LeftTab) => void;
  setRightTab: (t: RightTab) => void;
  setBottomTab: (t: BottomTab) => void;
  togglePanel: (p: keyof StudioState['panels'], open?: boolean) => void;
  setTool: (t: Tool) => void;
  setInteraction: (m: InteractionMode) => void;
  openDoc: (d: DocTab) => void;
  closeDoc: (id: string) => void;
  setActiveDoc: (id: string) => void;
  updateDoc: (id: string, patch: Partial<DocTab>) => void;
  setCommandOpen: (o: boolean) => void;
  setDialog: (d: keyof StudioState['dialogs'], open: boolean) => void;

  /* devices */
  allDevices: () => DeviceProfile[];
  device: () => DeviceProfile;
  setViewport: (v: Partial<ViewportState>) => void;
  setTransition: (t: Partial<TransitionState>) => void;
  /** Animate to a posture (or jump when reduced motion is on). */
  foldTo: (posture: 'folded' | 'expanded') => void;
  toggleFold: () => void;
  setCompare: (c: Partial<StudioState['compare']>) => void;
  setColorScheme: (s: StudioState['colorScheme']) => void;
  setFontScale: (n: number) => void;
  setCamera: (c: Partial<StudioState['camera']>) => void;
  setResponsiveSize: (size: { width: number; height: number }) => void;
  setEditTarget: (t: Partial<StudioState['editTarget']>) => void;
  fitCamera: () => void;
  saveDevice: (d: DeviceProfile) => void;
  deleteDevice: (id: string) => void;

  /* preview */
  setSource: (s: PreviewSource | null) => void;
  upsertInstance: (id: string, patch: Partial<PreviewInstance>) => void;
  removeInstance: (id: string) => void;
  reloadPreview: () => void;

  /* inspection */
  select: (instanceId: string | null, nodeId: NodeId | null, selector?: string | null) => void;
  setSelectionInfo: (info: NodeInfo | null) => void;
  setHover: (h: Partial<HoverState>) => void;
  setDom: (d: DomSnapshot | null) => void;
  setExpanded: (id: NodeId, open: boolean) => void;
  expandPath: (ids: NodeId[]) => void;

  /* changes */
  commitChange: (c: Change | Change[]) => void;
  previewChange: (c: Change | Change[] | null) => void;
  undo: () => void;
  redo: () => void;
  removeChange: (id: string) => void;
  resetChanges: () => void;
  promoteExperiment: (id: string) => void;
  setExportStatus: (ids: string[], status: Change['exportStatus']) => void;
  setChanges: (changes: Change[]) => void;

  /* diagnostics */
  pushConsole: (e: ConsoleEntry) => void;
  clearConsole: () => void;
  pushNetwork: (entries: NetworkEntry[]) => void;
  clearNetwork: () => void;
  setA11yIssues: (i: A11yIssue[]) => void;
  setResponsiveIssues: (i: ResponsiveIssue[]) => void;
  setAuditStatus: (s: Partial<StudioState['auditStatus']>) => void;

  /* design system */
  setTokens: (t: DesignToken[]) => void;
  upsertToken: (t: DesignToken) => void;
  deleteToken: (id: string) => void;
  setAssets: (a: AssetRef[]) => void;
  addAsset: (a: AssetRef) => void;
  deleteAsset: (id: string) => void;
  upsertStylePreset: (p: StylePreset) => void;
  deleteStylePreset: (id: string) => void;

  /* testing */
  setScenarios: (s: Scenario[]) => void;
  upsertScenario: (s: Scenario) => void;
  deleteScenario: (id: string) => void;
  upsertRun: (r: ScenarioRun) => void;
  clearRuns: () => void;
  startRecording: (instanceId: string) => void;
  stopRecording: () => TestStep[];
  addRecordedStep: (s: TestStep) => void;
  setRecordedSteps: (s: TestStep[]) => void;
  addCapture: (c: CaptureRef) => void;
  removeCapture: (id: string) => void;
  setBaseline: (key: string, captureId: string | null) => void;

  /* server + settings */
  setServer: (s: Partial<ServerInfo>) => void;
  updateSettings: (s: Partial<Settings>) => void;
};

export type Studio = StudioState & Actions;

const initialViewport: ViewportState = { deviceId: DEFAULT_DEVICE_ID, posture: 'folded', orientation: 'portrait' };

export const CANVAS_DOC: DocTab = { id: 'canvas', kind: 'canvas', title: 'Canvas', pinned: true };

export const useStudio = create<Studio>()(
  subscribeWithSelector((set, get) => ({
    project: null,
    saveStatus: 'saved',
    routes: [],
    currentRoute: '',

    leftTab: 'layers',
    rightTab: 'design',
    bottomTab: 'console',
    panels: { left: true, right: true, bottom: true },
    tool: 'select',
    interaction: 'inspect',
    documents: [CANVAS_DOC],
    activeDocId: 'canvas',
    commandOpen: false,
    dialogs: { settings: false, deviceManager: false, importProject: false, export: false, shortcuts: false, simulateUrl: false },

    customDevices: [],
    viewport: initialViewport,
    transition: { progress: 0, playing: false, direction: 1, duration: 1100, mode: 'continuous', style: 'hinge', loop: false },
    compare: { enabled: false, partner: { deviceId: DEFAULT_DEVICE_ID, posture: 'expanded', orientation: 'portrait' } },
    colorScheme: null,
    fontScale: 1,
    camera: { x: 0, y: 0, zoom: 1, fitNonce: 0 },
    responsiveSize: { width: 820, height: 1000 },
    editTarget: { scope: 'element', media: 'all' },

    source: null,
    instances: {},
    reloadNonce: 0,

    selection: { instanceId: null, nodeId: null, selector: null, info: null, loading: false },
    hover: { instanceId: null, nodeId: null, rect: null, label: '' },
    dom: null,
    domVersion: 0,
    expanded: {},

    changes: [],
    undoStack: [],
    redoStack: [],
    transient: [],

    console: [],
    network: [],
    a11yIssues: [],
    responsiveIssues: [],
    auditStatus: { a11y: 'idle', responsive: 'idle' },

    tokens: [],
    assets: [],
    stylePresets: [],

    scenarios: [],
    runs: [],
    recording: { active: false, instanceId: null, steps: [], startedAt: null },
    captures: [],
    baselines: {},

    server: { status: 'unknown', token: null, previewOrigin: null, capabilities: null },
    settings: DEFAULT_SETTINGS,

    /* ---------------------------------------------------------------- */
    setProject: (project) => set({ project }),
    setSaveStatus: (saveStatus) => set({ saveStatus }),
    setRoutes: (routes) => set({ routes }),
    setCurrentRoute: (currentRoute) => set({ currentRoute }),

    setLeftTab: (leftTab) => set((s) => ({ leftTab, panels: { ...s.panels, left: true } })),
    setRightTab: (rightTab) => set((s) => ({ rightTab, panels: { ...s.panels, right: true } })),
    setBottomTab: (bottomTab) => set((s) => ({ bottomTab, panels: { ...s.panels, bottom: true } })),
    togglePanel: (p, open) => set((s) => ({ panels: { ...s.panels, [p]: open ?? !s.panels[p] } })),
    setTool: (tool) => set({ tool }),
    setInteraction: (interaction) => set({ interaction }),
    openDoc: (d) =>
      set((s) => ({
        documents: s.documents.some((x) => x.id === d.id) ? s.documents.map((x) => (x.id === d.id ? { ...x, ...d } : x)) : [...s.documents, d],
        activeDocId: d.id,
      })),
    closeDoc: (id) =>
      set((s) => {
        const doc = s.documents.find((d) => d.id === id);
        if (!doc || doc.pinned) return s;
        const idx = s.documents.indexOf(doc);
        const documents = s.documents.filter((d) => d.id !== id);
        const activeDocId = s.activeDocId === id ? documents[Math.max(0, idx - 1)]?.id ?? 'canvas' : s.activeDocId;
        return { documents, activeDocId };
      }),
    setActiveDoc: (activeDocId) => set({ activeDocId }),
    updateDoc: (id, patch) => set((s) => ({ documents: s.documents.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),
    setCommandOpen: (commandOpen) => set({ commandOpen }),
    setDialog: (d, open) => set((s) => ({ dialogs: { ...s.dialogs, [d]: open } })),

    allDevices: () => [...BUILT_IN_DEVICES, ...get().customDevices],
    device: () => {
      const id = get().viewport.deviceId;
      if (id === RESPONSIVE_ID) return responsiveDevice(get().responsiveSize);
      return get().allDevices().find((d) => d.id === id) ?? BUILT_IN_DEVICES[0];
    },
    setViewport: (v) =>
      set((s) => {
        const viewport = { ...s.viewport, ...v };
        const dev = viewport.deviceId === RESPONSIVE_ID ? null : [...BUILT_IN_DEVICES, ...s.customDevices].find((d) => d.id === viewport.deviceId) ?? BUILT_IN_DEVICES[0];
        if (!dev || !canFold(dev)) viewport.posture = 'folded';
        const progress = viewport.posture === 'expanded' ? 1 : 0;
        return { viewport, transition: { ...s.transition, progress, playing: false }, camera: v.deviceId && v.deviceId !== s.viewport.deviceId ? { ...s.camera, fitNonce: s.camera.fitNonce + 1 } : s.camera };
      }),
    setTransition: (t) => set((s) => ({ transition: { ...s.transition, ...t } })),
    foldTo: (posture) => {
      const s = get();
      if (!canFold(s.device())) return;
      const target = posture === 'expanded' ? 1 : 0;
      if (s.settings.reducedMotion || s.transition.duration === 0) {
        set({ viewport: { ...s.viewport, posture }, transition: { ...s.transition, progress: target, playing: false } });
        return;
      }
      set({ transition: { ...s.transition, playing: true, direction: target === 1 ? 1 : -1 } });
    },
    toggleFold: () => {
      const s = get();
      const goingTo = s.transition.playing ? (s.transition.direction === 1 ? 'folded' : 'expanded') : s.viewport.posture === 'expanded' ? 'folded' : 'expanded';
      s.foldTo(goingTo);
    },
    setCompare: (c) => set((s) => ({ compare: { ...s.compare, ...c }, camera: { ...s.camera, fitNonce: s.camera.fitNonce + 1 } })),
    setColorScheme: (colorScheme) => set({ colorScheme }),
    setFontScale: (fontScale) => set({ fontScale }),
    setCamera: (c) => set((s) => ({ camera: { ...s.camera, ...c } })),
    fitCamera: () => set((s) => ({ camera: { ...s.camera, fitNonce: s.camera.fitNonce + 1 } })),
    setResponsiveSize: (responsiveSize) =>
      set({ responsiveSize: { width: Math.round(Math.min(3840, Math.max(200, responsiveSize.width))), height: Math.round(Math.min(2400, Math.max(240, responsiveSize.height))) } }),
    setEditTarget: (t) => set((s) => ({ editTarget: { ...s.editTarget, ...t } })),
    saveDevice: (d) => set((s) => ({ customDevices: s.customDevices.some((x) => x.id === d.id) ? s.customDevices.map((x) => (x.id === d.id ? d : x)) : [...s.customDevices, d] })),
    deleteDevice: (id) =>
      set((s) => ({
        customDevices: s.customDevices.filter((d) => d.id !== id),
        viewport: s.viewport.deviceId === id ? initialViewport : s.viewport,
      })),

    setSource: (source) => set({ source, instances: {}, dom: null, selection: { instanceId: null, nodeId: null, selector: null, info: null, loading: false } }),
    upsertInstance: (id, patch) =>
      set((s) => {
        const prev: PreviewInstance = s.instances[id] ?? { id, role: 'primary', status: 'idle', url: '', title: '', viewport: null, lastHeartbeat: 0, engine: 'frame' };
        return { instances: { ...s.instances, [id]: { ...prev, ...patch } } };
      }),
    removeInstance: (id) =>
      set((s) => {
        const instances = { ...s.instances };
        delete instances[id];
        return { instances };
      }),
    reloadPreview: () => set((s) => ({ reloadNonce: s.reloadNonce + 1 })),

    select: (instanceId, nodeId, selector = null) =>
      set((s) => ({
        selection: { instanceId, nodeId, selector: nodeId === null ? null : selector ?? s.selection.selector, info: nodeId === s.selection.nodeId ? s.selection.info : null, loading: nodeId !== null },
      })),
    setSelectionInfo: (info) => set((s) => ({ selection: { ...s.selection, info, selector: info?.selector ?? s.selection.selector, loading: false } })),
    setHover: (h) => set((s) => ({ hover: { ...s.hover, ...h } })),
    setDom: (dom) => set((s) => ({ dom, domVersion: s.domVersion + 1 })),
    setExpanded: (id, open) => set((s) => ({ expanded: { ...s.expanded, [id]: open } })),
    expandPath: (ids) =>
      set((s) => {
        const expanded = { ...s.expanded };
        for (const id of ids) expanded[id] = true;
        return { expanded };
      }),

    commitChange: (c) =>
      set((s) => ({ ...cm.commit({ changes: s.changes, undoStack: s.undoStack, redoStack: s.redoStack }, c), transient: [], saveStatus: 'unsaved' })),
    previewChange: (c) => set({ transient: c === null ? [] : Array.isArray(c) ? c : [c] }),
    undo: () => set((s) => ({ ...cm.undo({ changes: s.changes, undoStack: s.undoStack, redoStack: s.redoStack }), transient: [], saveStatus: 'unsaved' })),
    redo: () => set((s) => ({ ...cm.redo({ changes: s.changes, undoStack: s.undoStack, redoStack: s.redoStack }), transient: [], saveStatus: 'unsaved' })),
    removeChange: (id) =>
      set((s) => ({ ...cm.replaceAll({ changes: s.changes, undoStack: s.undoStack, redoStack: s.redoStack }, s.changes.filter((c) => c.id !== id && c.groupId !== id)), saveStatus: 'unsaved' })),
    resetChanges: () => set((s) => ({ ...cm.replaceAll({ changes: s.changes, undoStack: s.undoStack, redoStack: s.redoStack }, []), transient: [], saveStatus: 'unsaved' })),
    promoteExperiment: (id) =>
      set((s) => ({ ...cm.replaceAll({ changes: s.changes, undoStack: s.undoStack, redoStack: s.redoStack }, s.changes.map((c) => (c.id === id || c.groupId === id ? { ...c, experiment: false } : c))), saveStatus: 'unsaved' })),
    setExportStatus: (ids, status) => set((s) => ({ changes: s.changes.map((c) => (ids.includes(c.id) ? { ...c, exportStatus: status } : c)), saveStatus: 'unsaved' })),
    setChanges: (changes) => set({ changes, undoStack: [], redoStack: [], transient: [] }),

    pushConsole: (e) =>
      set((s) => {
        const last = s.console[s.console.length - 1];
        if (last && last.level === e.level && last.kind === e.kind && last.instanceId === e.instanceId && last.args.join() === e.args.join()) {
          const merged = { ...last, count: last.count + 1, timestamp: e.timestamp };
          return { console: [...s.console.slice(0, -1), merged] };
        }
        const next = [...s.console, e];
        return { console: next.length > CONSOLE_CAP ? next.slice(-CONSOLE_CAP) : next };
      }),
    clearConsole: () => set({ console: [] }),
    pushNetwork: (entries) =>
      set((s) => {
        const next = [...s.network, ...entries];
        return { network: next.length > NETWORK_CAP ? next.slice(-NETWORK_CAP) : next };
      }),
    clearNetwork: () => set({ network: [] }),
    setA11yIssues: (a11yIssues) => set({ a11yIssues }),
    setResponsiveIssues: (responsiveIssues) => set({ responsiveIssues }),
    setAuditStatus: (a) => set((s) => ({ auditStatus: { ...s.auditStatus, ...a } })),

    setTokens: (tokens) => set({ tokens, saveStatus: 'unsaved' }),
    upsertToken: (t) => set((s) => ({ tokens: s.tokens.some((x) => x.id === t.id) ? s.tokens.map((x) => (x.id === t.id ? t : x)) : [...s.tokens, t], saveStatus: 'unsaved' })),
    deleteToken: (id) => set((s) => ({ tokens: s.tokens.filter((t) => t.id !== id), saveStatus: 'unsaved' })),
    setAssets: (assets) => set({ assets }),
    addAsset: (a) => set((s) => ({ assets: [...s.assets, a], saveStatus: 'unsaved' })),
    deleteAsset: (id) => set((s) => ({ assets: s.assets.filter((a) => a.id !== id), saveStatus: 'unsaved' })),
    upsertStylePreset: (p) => set((s) => ({ stylePresets: s.stylePresets.some((x) => x.id === p.id) ? s.stylePresets.map((x) => (x.id === p.id ? p : x)) : [...s.stylePresets, p], saveStatus: 'unsaved' })),
    deleteStylePreset: (id) => set((s) => ({ stylePresets: s.stylePresets.filter((x) => x.id !== id), saveStatus: 'unsaved' })),

    setScenarios: (scenarios) => set({ scenarios }),
    upsertScenario: (sc) => set((s) => ({ scenarios: s.scenarios.some((x) => x.id === sc.id) ? s.scenarios.map((x) => (x.id === sc.id ? sc : x)) : [...s.scenarios, sc], saveStatus: 'unsaved' })),
    deleteScenario: (id) => set((s) => ({ scenarios: s.scenarios.filter((x) => x.id !== id), saveStatus: 'unsaved' })),
    upsertRun: (r) => set((s) => ({ runs: s.runs.some((x) => x.id === r.id) ? s.runs.map((x) => (x.id === r.id ? r : x)) : [r, ...s.runs].slice(0, 200) })),
    clearRuns: () => set({ runs: [] }),
    startRecording: (instanceId) => set({ recording: { active: true, instanceId, steps: [], startedAt: Date.now() } }),
    stopRecording: () => {
      const steps = get().recording.steps;
      set((s) => ({ recording: { ...s.recording, active: false } }));
      return steps;
    },
    addRecordedStep: (step) => set((s) => (s.recording.active ? { recording: { ...s.recording, steps: [...s.recording.steps, step] } } : s)),
    setRecordedSteps: (steps) => set((s) => ({ recording: { ...s.recording, steps } })),
    addCapture: (c) => set((s) => ({ captures: [c, ...s.captures].slice(0, 120), saveStatus: 'unsaved' })),
    removeCapture: (id) => set((s) => ({ captures: s.captures.filter((c) => c.id !== id), saveStatus: 'unsaved' })),
    setBaseline: (key, captureId) =>
      set((s) => {
        const baselines = { ...s.baselines };
        if (captureId) baselines[key] = captureId;
        else delete baselines[key];
        return { baselines, saveStatus: 'unsaved' };
      }),

    setServer: (srv) => set((s) => ({ server: { ...s.server, ...srv } })),
    updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch }, saveStatus: 'unsaved' })),
  })),
);

/** Non-hook accessor for imperative code. */
export const studio = () => useStudio.getState();
