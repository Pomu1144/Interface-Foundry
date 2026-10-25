import type {
  A11yIssue,
  Change,
  ConsoleEntry,
  DesignToken,
  DeviceProfile,
  DomSnapshot,
  NetworkEntry,
  NodeId,
  NodeInfo,
  Orientation,
  Posture,
  Rect,
  ResponsiveIssue,
  Scenario,
  ScenarioRun,
  TestStep,
  ViewportContext,
  ViewportState,
} from '@shared/types';
import type { TransitionMode } from '@/modules/device-simulator/viewport';

export type LeftTab = 'pages' | 'layers' | 'assets' | 'components' | 'tokens' | 'scenarios' | 'files' | 'devices';
export type RightTab = 'design' | 'layout' | 'styles' | 'dom' | 'computed' | 'box' | 'a11y' | 'events' | 'responsive' | 'component' | 'ai';
export type BottomTab = 'console' | 'network' | 'errors' | 'a11y' | 'responsive' | 'timeline' | 'history' | 'tests' | 'export';
export type Tool = 'select' | 'pan';
export type InteractionMode = 'interact' | 'inspect';

/** Where the previewed page comes from. */
export type PreviewSource =
  | { kind: 'demo'; label: string; entry: string }
  | { kind: 'vfs'; label: string; projectId: string; entry: string }
  | { kind: 'proxy'; label: string; target: string; origin: string; entry: string }
  | { kind: 'fs'; label: string; rootId: string; entry: string }
  | { kind: 'url'; label: string; url: string; engine: 'embed' | 'remote' };

export type ProjectMeta = {
  id: string;
  name: string;
  source: PreviewSource;
  createdAt: number;
  updatedAt: number;
};

export type RouteEntry = { id: string; label: string; path: string; group?: string };

export type DocKind = 'canvas' | 'file' | 'wall' | 'hierarchy' | 'diff' | 'report' | 'welcome';
export type DocTab = { id: string; kind: DocKind; title: string; data?: Record<string, unknown>; pinned?: boolean; dirty?: boolean };

export type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error' | 'crashed' | 'blocked';
export type PreviewInstance = {
  id: string;
  /** Logical role: the primary canvas device, compare partner, wall tile, sweep worker. */
  role: 'primary' | 'compare' | 'wall' | 'worker';
  status: PreviewStatus;
  url: string;
  title: string;
  viewport: { width: number; height: number; dpr: number } | null;
  lastHeartbeat: number;
  error?: string;
  engine: 'frame' | 'remote' | 'embed';
};

export type Duplicate = { id: string; deviceId: string; posture: Posture; orientation: Orientation };

export type TransitionState = {
  /** 0 = folded, 1 = expanded. */
  progress: number;
  playing: boolean;
  direction: 1 | -1;
  duration: number;
  mode: TransitionMode;
  style: 'hinge' | 'reflow';
  loop: boolean;
};

export type CaptureRef = {
  id: string;
  label: string;
  kind: 'raster' | 'chromium';
  route: string;
  viewport: ViewportContext;
  dataUrl: string;
  width: number;
  height: number;
  createdAt: number;
  /** Change-set count at capture time (before/after comparisons). */
  changeCount: number;
};

export type StylePreset = {
  id: string;
  name: string;
  /** Declarations applied together, e.g. typography + colors + radius. */
  declarations: { property: string; value: string }[];
  source: string;
  createdAt: number;
};

export type AssetRef = {
  id: string;
  name: string;
  type: 'image' | 'icon' | 'font' | 'media';
  mime: string;
  size: number;
  dataUrl: string;
  createdAt: number;
  source: 'upload' | 'page' | 'library';
  tags: string[];
};

export type ServerInfo = {
  status: 'unknown' | 'online' | 'offline';
  token: string | null;
  previewOrigin: string | null;
  capabilities: {
    browser: { available: boolean; reason: string };
    ai: { anthropic: boolean; model: string; local: boolean; localModel: string | null };
    fs: { available: boolean; roots: { id: string; path: string; name: string }[] };
    localProxy: { available: boolean };
  } | null;
};

export type Settings = {
  theme: 'dark' | 'light';
  maskAllInputs: boolean;
  instrumentEvents: boolean;
  instrumentNetwork: boolean;
  minTapSize: number;
  minFontSize: number;
  maxLineLength: number;
  ignoreSelectors: string[];
  aiProvider: 'anthropic' | 'local' | 'heuristic';
  aiConsent: boolean;
  telemetry: boolean;
  showRulers: boolean;
  showSystemUI: boolean;
  showHinge: boolean;
  reducedMotion: boolean;
  diffThreshold: number;
  fixtures: Record<string, string>;
};

export type SelectionState = {
  instanceId: string | null;
  nodeId: NodeId | null;
  selector: string | null;
  info: NodeInfo | null;
  loading: boolean;
};

export type HoverState = { instanceId: string | null; nodeId: NodeId | null; rect: Rect | null; label: string };

export type StudioState = {
  /* project */
  project: ProjectMeta | null;
  saveStatus: 'saved' | 'saving' | 'unsaved' | 'error';
  routes: RouteEntry[];
  currentRoute: string;

  /* workspace */
  leftTab: LeftTab;
  rightTab: RightTab;
  bottomTab: BottomTab;
  panels: { left: boolean; right: boolean; bottom: boolean };
  tool: Tool;
  interaction: InteractionMode;
  documents: DocTab[];
  activeDocId: string;
  commandOpen: boolean;
  dialogs: { settings: boolean; deviceManager: boolean; importProject: boolean; export: boolean; shortcuts: boolean; simulateUrl: boolean };

  /* devices */
  customDevices: DeviceProfile[];
  viewport: ViewportState;
  transition: TransitionState;
  compare: { enabled: boolean; partner: ViewportState };
  /** Extra live copies of the current view on other devices ("Duplicate into"). */
  duplicates: Duplicate[];
  colorScheme: 'light' | 'dark' | null;
  fontScale: number;
  camera: { x: number; y: number; zoom: number; fitNonce: number };
  /** Size of the free-form "Responsive" device (drag handles on the canvas). */
  responsiveSize: { width: number; height: number };
  /** Where new style edits apply: this element or every match of its class selector; all widths or a media range. */
  editTarget: { scope: 'element' | 'selector'; media: 'all' | 'at-most' | 'at-least' };

  /* preview */
  source: PreviewSource | null;
  instances: Record<string, PreviewInstance>;
  reloadNonce: number;

  /* inspection */
  selection: SelectionState;
  hover: HoverState;
  dom: DomSnapshot | null;
  domVersion: number;
  expanded: Record<NodeId, boolean>;

  /* changes */
  changes: Change[];
  undoStack: Change[][];
  redoStack: Change[][];
  /** Transient preview (scrubbing / dragging) not yet committed. */
  transient: Change[];

  /* diagnostics */
  console: ConsoleEntry[];
  network: NetworkEntry[];
  a11yIssues: A11yIssue[];
  responsiveIssues: ResponsiveIssue[];
  auditStatus: { a11y: 'idle' | 'running' | 'done' | 'error'; responsive: 'idle' | 'running' | 'done' | 'error'; at?: number; error?: string };

  /* design system */
  tokens: DesignToken[];
  assets: AssetRef[];
  /** Reusable styles saved from elements (Figma-style "styles"). */
  stylePresets: StylePreset[];

  /* testing */
  scenarios: Scenario[];
  runs: ScenarioRun[];
  recording: { active: boolean; instanceId: string | null; steps: TestStep[]; startedAt: number | null };
  captures: CaptureRef[];
  baselines: Record<string, string>;

  /* server + settings */
  server: ServerInfo;
  settings: Settings;
};

export type ViewportPatch = Partial<ViewportState> & { posture?: Posture; orientation?: Orientation };
