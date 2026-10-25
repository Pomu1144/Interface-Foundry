/**
 * Studio <-> preview agent protocol.
 *
 * The agent runs inside the previewed page (an isolated, cross-origin iframe or a
 * server-controlled Chromium page). Transport is postMessage (iframe) or a
 * WebSocket bridge (controlled browser); both carry the same envelopes.
 *
 * Every inbound message is validated with `isEnvelope` and checked against the
 * session nonce. Only methods listed in `AGENT_METHODS` may be invoked.
 */
import type {
  A11yIssue,
  BoxModel,
  ComponentInfo,
  DomNode,
  DomSnapshot,
  LogLevel,
  NodeId,
  NodeInfo,
  PatchSet,
  Rect,
  ResponsiveIssue,
  StepAction,
  StylesPayload,
  TestStep,
  ViewportContext,
} from './types';

export const PROTOCOL_VERSION = 1;
export const ENVELOPE_TAG = '__ifdy';

export type Envelope = {
  [ENVELOPE_TAG]: typeof PROTOCOL_VERSION;
  session: string;
  kind: 'request' | 'response' | 'event';
  id?: number;
  method?: string;
  event?: string;
  payload?: unknown;
  error?: string;
};

export function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v[ENVELOPE_TAG] === PROTOCOL_VERSION &&
    typeof v.session === 'string' &&
    (v.kind === 'request' || v.kind === 'response' || v.kind === 'event')
  );
}

/* ------------------------------------------------------------------ */
/* Requests (studio -> agent)                                          */
/* ------------------------------------------------------------------ */

export type InspectMode = 'interact' | 'inspect';

export type ElementQuery = { text: string; limit?: number };

export type LayoutSnapshotEntry = {
  selector: string;
  label: string;
  role: string;
  rect: Rect;
  visible: boolean;
  inViewport: boolean;
  text?: string;
  primary: boolean;
};

export type Hierarchy3DNode = {
  id: NodeId;
  depth: number;
  rect: Rect;
  label: string;
  bg: string | null;
  border: string | null;
  text?: string;
  isImage: boolean;
};

export type BreakpointInfo = { query: string; min?: number; max?: number; count: number };

export type ListenerInfo = {
  type: string;
  source: 'attribute' | 'instrumented' | 'chromium';
  capture?: boolean;
  passive?: boolean;
  once?: boolean;
  handler: string;
  on: { id: NodeId; label: string };
};

export type RecorderOptions = { maskAllInputs: boolean };

export type ReplayResult = { ok: boolean; error?: string; usedLocator?: string; durationMs: number };

export type CaptureOptions = { scale?: number; fullPage?: boolean; maxWidth?: number };

export type ResponsiveAuditOptions = {
  viewport: ViewportContext;
  fold?: { axis: 'vertical' | 'horizontal'; offset: number; maskLength: number; kind: 'hinge' | 'crease' } | null;
  minTapSize: number;
  minFontSize: number;
  maxLineLength: number;
  ignoreSelectors: string[];
};

/** An asset referenced by the page (assets.scan). */
export type PageAsset = {
  kind: 'image' | 'icon' | 'background' | 'video' | 'font';
  /** Absolute URL (empty for system fonts). */
  url: string;
  label: string;
  /** Number of elements / rules using it. */
  count: number;
  selector?: string;
  nodeId?: NodeId;
  width?: number;
  height?: number;
  alt?: string;
  /** Fonts: family, weight/style, and load status from document.fonts. */
  family?: string;
  weight?: string;
  style?: string;
  status?: 'loaded' | 'loading' | 'unloaded' | 'error' | 'system';
};

/** Rules and inline styles that reference a custom property (tokens.usage). */
export type TokenUsage = { selector: string; property: string; value: string; source: string; media?: string; matches: number };

export type PreviewEnv = {
  fontScale?: number;
  colorScheme?: 'light' | 'dark' | null;
  instrumentEvents?: boolean;
  instrumentNetwork?: boolean;
  freezeAnimations?: boolean;
  focusRings?: boolean;
};

/** Method name -> [params, result]. */
export interface AgentMethods {
  'agent.ping': [void, { ts: number }];
  'dom.snapshot': [{ maxNodes?: number } | void, DomSnapshot];
  'dom.children': [{ id: NodeId }, DomNode[]];
  'dom.find': [ElementQuery, { id: NodeId; label: string; match: string }[]];
  'dom.resolve': [{ selector: string }, NodeId | null];
  'node.info': [{ id: NodeId }, NodeInfo | null];
  'node.styles': [{ id: NodeId }, StylesPayload | null];
  'node.computed': [{ id: NodeId }, Record<string, string> | null];
  'node.box': [{ id: NodeId }, BoxModel | null];
  'node.component': [{ id: NodeId }, ComponentInfo | null];
  'node.listeners': [{ id: NodeId }, ListenerInfo[]];
  'node.scrollIntoView': [{ id: NodeId }, void];
  'node.focus': [{ id: NodeId }, void];
  'overlay.watch': [{ ids: NodeId[] }, void];
  'mode.set': [{ mode: InspectMode }, void];
  'patch.apply': [PatchSet, { applied: number; failed: string[] }];
  'text.beginEdit': [{ id: NodeId }, { before: string } | null];
  'layout.snapshot': [{ selectors?: string[] } | void, LayoutSnapshotEntry[]];
  'layout.breakpoints': [void, BreakpointInfo[]];
  'layout.hierarchy3d': [{ maxNodes?: number } | void, Hierarchy3DNode[]];
  'audit.responsive': [ResponsiveAuditOptions, ResponsiveIssue[]];
  'audit.a11y': [{ viewport: ViewportContext } | void, A11yIssue[]];
  'audit.keyboard': [void, { order: { id: NodeId; label: string; rect: Rect; visibleFocus: boolean }[]; traps: string[] }];
  'capture.raster': [CaptureOptions | void, { dataUrl: string; width: number; height: number }];
  'record.start': [RecorderOptions, void];
  'record.stop': [void, void];
  'replay.step': [{ action: StepAction; timeout: number }, ReplayResult];
  'tokens.scan': [void, { name: string; value: string; usage: number }[]];
  'tokens.usage': [{ name: string }, TokenUsage[]];
  'assets.scan': [void, PageAsset[]];
  'env.set': [PreviewEnv, void];
  'nav.go': [{ url: string }, void];
  'nav.reload': [void, void];
  'scroll.set': [{ x: number; y: number; ratio?: boolean }, void];
  'state.form': [void, { selector: string; value: string; focused: boolean }[]];
}

export type AgentMethod = keyof AgentMethods;
export type AgentParams<M extends AgentMethod> = AgentMethods[M][0];
export type AgentResult<M extends AgentMethod> = AgentMethods[M][1];

export const AGENT_METHODS: readonly AgentMethod[] = [
  'agent.ping',
  'dom.snapshot',
  'dom.children',
  'dom.find',
  'dom.resolve',
  'node.info',
  'node.styles',
  'node.computed',
  'node.box',
  'node.component',
  'node.listeners',
  'node.scrollIntoView',
  'node.focus',
  'overlay.watch',
  'mode.set',
  'patch.apply',
  'text.beginEdit',
  'layout.snapshot',
  'layout.breakpoints',
  'layout.hierarchy3d',
  'audit.responsive',
  'audit.a11y',
  'audit.keyboard',
  'capture.raster',
  'record.start',
  'record.stop',
  'replay.step',
  'tokens.scan',
  'tokens.usage',
  'assets.scan',
  'env.set',
  'nav.go',
  'nav.reload',
  'scroll.set',
  'state.form',
] as const;

/* ------------------------------------------------------------------ */
/* Events (agent -> studio)                                            */
/* ------------------------------------------------------------------ */

export type AgentHello = {
  version: number;
  url: string;
  title: string;
  viewport: { width: number; height: number; dpr: number };
  userAgent: string;
  capabilities: { cssom: boolean; axe: boolean; raster: boolean; react: boolean };
};

export interface AgentEvents {
  hello: AgentHello;
  heartbeat: { ts: number };
  hover: { id: NodeId | null; rect: Rect | null; label: string };
  select: { id: NodeId; rect: Rect; label: string; additive: boolean };
  dblselect: { id: NodeId };
  rects: { rects: Record<NodeId, Rect | null>; scroll: { x: number; y: number } };
  'dom.changed': { reason: string };
  console: { level: LogLevel; args: string[]; ts: number; source?: string; stack?: string };
  error: { message: string; source?: string; line?: number; column?: number; stack?: string; ts: number; kind: 'runtime' | 'promise' | 'resource' };
  network: {
    entries: {
      url: string;
      method: string;
      status: number | null;
      type: string;
      startTime: number;
      duration: number;
      transferSize: number | null;
      failed: boolean;
      failureReason?: string;
      initiator?: string;
      source: 'resource-timing' | 'instrumented';
    }[];
  };
  navigation: { url: string; title: string };
  viewport: { width: number; height: number; dpr: number };
  'text.edited': { id: NodeId; selector: string; before: string; after: string };
  'record.step': { step: TestStep };
  scroll: { x: number; y: number; ratioX: number; ratioY: number };
  key: { key: string; code: string; meta: boolean; ctrl: boolean; shift: boolean; alt: boolean };
  wheel: { deltaX: number; deltaY: number; ctrl: boolean; clientX: number; clientY: number };
  perf: { fps: number; cls: number; longTasks: number };
}

export type AgentEvent = keyof AgentEvents;

export const AGENT_EVENTS: readonly AgentEvent[] = [
  'hello',
  'heartbeat',
  'hover',
  'select',
  'dblselect',
  'rects',
  'dom.changed',
  'console',
  'error',
  'network',
  'navigation',
  'viewport',
  'text.edited',
  'record.step',
  'scroll',
  'key',
  'wheel',
  'perf',
] as const;

/** Window name prefix used to hand the session nonce + studio origin to the agent. */
export const WINDOW_NAME_PREFIX = 'ifdy:';

export function encodeWindowName(session: string, studioOrigin: string): string {
  return `${WINDOW_NAME_PREFIX}${session}|${studioOrigin}`;
}

export function decodeWindowName(name: string): { session: string; studioOrigin: string } | null {
  if (!name.startsWith(WINDOW_NAME_PREFIX)) return null;
  const [session, studioOrigin] = name.slice(WINDOW_NAME_PREFIX.length).split('|');
  if (!session || !studioOrigin) return null;
  return { session, studioOrigin };
}
