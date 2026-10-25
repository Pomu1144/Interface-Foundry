/**
 * Domain types shared by the studio, the preview agent and the companion server.
 * Keep this file free of runtime imports so it can be bundled anywhere.
 */

export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Insets = { top: number; right: number; bottom: number; left: number };

/* ------------------------------------------------------------------ */
/* Devices                                                             */
/* ------------------------------------------------------------------ */

export type Platform = 'ios' | 'android' | 'windows' | 'desktop' | 'generic';
export type DeviceCategory = 'phone' | 'foldable' | 'tablet' | 'desktop' | 'custom';
export type Posture = 'folded' | 'expanded';
export type Orientation = 'portrait' | 'landscape';

/** Hinge/fold geometry, in CSS px of the *expanded portrait* viewport. */
export type FoldGeometry = {
  /** Axis of the fold line when the device is in portrait orientation. */
  axis: 'vertical' | 'horizontal';
  /** Offset of the fold's leading edge from the left (vertical) or top (horizontal). */
  offset: number;
  /** Width of the region that is physically not displayable (0 for a crease). */
  maskLength: number;
  kind: 'hinge' | 'crease';
};

export type PostureGeometry = {
  /** Full display area in CSS px (portrait). */
  screen: Size;
  /** Browser layout viewport in CSS px (portrait). */
  viewport: Size;
  safeArea: Insets;
  /** Heights of simulated browser UI above/below the viewport. */
  browserChrome: { top: number; bottom: number };
  cornerRadius: number;
  /** Physical bezel around the screen (CSS px). */
  bezel: Insets;
  fold?: FoldGeometry;
};

export type VerificationLevel = 'reference' | 'provisional' | 'custom';

export type DeviceProfile = {
  id: string;
  name: string;
  vendor?: string;
  platform: Platform;
  category: DeviceCategory;
  pixelRatio: number;
  userAgent?: string;
  touch: boolean;
  /** Visual style of the frame. */
  frameStyle: 'iphone-island' | 'iphone-notch' | 'iphone-home' | 'android-punch' | 'foldable-book' | 'dual-screen' | 'ipad' | 'android-tablet' | 'laptop' | 'monitor' | 'bare';
  folded: PostureGeometry;
  /** Present only for devices that can change posture. */
  expanded?: PostureGeometry;
  verification: { level: VerificationLevel; source: string; note?: string };
  builtIn: boolean;
};

export type ViewportState = {
  deviceId: string;
  posture: Posture;
  orientation: Orientation;
};

/** Fully resolved geometry for rendering a device at a given state (orientation applied). */
export type ResolvedViewport = {
  device: DeviceProfile;
  posture: Posture;
  orientation: Orientation;
  geometry: PostureGeometry;
  /** Frame outer size including bezel. */
  frame: Size;
};

/* ------------------------------------------------------------------ */
/* DOM / inspection                                                    */
/* ------------------------------------------------------------------ */

export type NodeId = number;

export type DomNode = {
  id: NodeId;
  /** 1 = element, 3 = text, 8 = comment (comments are never sent). */
  type: 1 | 3;
  tag?: string;
  idAttr?: string;
  classes?: string[];
  /** Short text preview for text nodes and leaf elements. */
  text?: string;
  attrs?: [string, string][];
  children?: NodeId[];
  childCount: number;
  visible: boolean;
  /** Display type, e.g. flex / grid / block / inline / none. */
  display?: string;
  component?: string;
  /** Children beyond the snapshot cap that must be fetched lazily. */
  truncated?: boolean;
};

export type DomSnapshot = {
  rootId: NodeId;
  nodes: Record<NodeId, DomNode>;
  nodeCount: number;
  truncated: boolean;
  url: string;
  title: string;
};

export type BoxModel = {
  content: Rect;
  padding: Insets;
  border: Insets;
  margin: Insets;
  /** Rect of the border box relative to the preview viewport. */
  borderBox: Rect;
  boxSizing: string;
  position: string;
  offsets: Insets;
};

export type LayoutContext = {
  display: string;
  /** Parent's display if the element participates in flex/grid. */
  parentDisplay?: string;
  flexDirection?: string;
  isFlexItem: boolean;
  isGridItem: boolean;
  isPositioned: boolean;
  /** Ancestors that clip overflow. */
  overflowAncestors: { id: NodeId; label: string; overflow: string }[];
};

export type NodeInfo = {
  id: NodeId;
  tag: string;
  label: string;
  selector: string;
  /** Short readable path, e.g. main > form.login > button.primary */
  path: { id: NodeId; label: string }[];
  attrs: [string, string][];
  classes: string[];
  text?: string;
  rect: Rect;
  box: BoxModel;
  layout: LayoutContext;
  /** Curated computed subset used by Design/Layout tabs. */
  computed: Record<string, string>;
  a11y: A11yInfo;
  component?: ComponentInfo;
  editableText: boolean;
  isImage: boolean;
};

export type A11yInfo = {
  role: string;
  name: string;
  description?: string;
  focusable: boolean;
  tabIndex: number | null;
  hidden: boolean;
  states: string[];
  aria: [string, string][];
  contrast?: { ratio: number; fg: string; bg: string; aa: boolean; aaLarge: boolean; aaa: boolean; fontSize: number; bold: boolean };
};

export type CssDeclaration = {
  property: string;
  value: string;
  important: boolean;
  /** Overridden by a higher-priority declaration. */
  overridden: boolean;
  /** Disabled via an IFDY experiment/edit. */
  disabled?: boolean;
  /** Property is not inherited (for inherited section). */
  inactive?: boolean;
  /** Edit from IFDY applied to this declaration. */
  modified?: boolean;
};

export type CssRuleOrigin = 'inline' | 'author' | 'override' | 'user-agent';

export type MatchedRule = {
  /** Stable key for CSSOM edits: sheetIndex:path. */
  key: string;
  selector: string;
  origin: CssRuleOrigin;
  media?: string[];
  layer?: string;
  specificity: [number, number, number];
  source: { href?: string; label: string; line?: number; sheetIndex: number; ownerNode?: string };
  declarations: CssDeclaration[];
  /** Index for ordering (document order). */
  order: number;
};

export type InheritedRules = { from: { id: NodeId; label: string }; rules: MatchedRule[] };

export type StylesPayload = {
  nodeId: NodeId;
  inline: MatchedRule | null;
  matched: MatchedRule[];
  inherited: InheritedRules[];
  variables: { name: string; value: string; definedOn: string }[];
  activeMedia: string[];
  inaccessibleSheets: string[];
};

export type ComponentInfo = {
  framework: 'react' | 'annotated' | 'vue' | 'svelte' | 'unknown';
  name: string;
  chain: { name: string; source?: SourceLocation }[];
  source?: SourceLocation;
  props?: Record<string, string>;
  instances: number;
  reliability: 'exact' | 'heuristic';
};

export type SourceLocation = { file: string; line?: number; column?: number };

/* ------------------------------------------------------------------ */
/* Changes & patch sets                                                */
/* ------------------------------------------------------------------ */

export type ChangeKind = 'style' | 'rule' | 'text' | 'attribute' | 'visibility' | 'asset' | 'token';
export type ChangeOrigin = 'inspector' | 'canvas' | 'box-model' | 'styles' | 'tokens' | 'ai' | 'experiment' | 'assets' | 'code';
export type ExportStatus = 'pending' | 'exported' | 'committed';

export type ChangeTarget = {
  /** CSS selector used to re-target after reloads. */
  selector: string;
  label: string;
  /** For 'rule' changes: the stylesheet rule key and selector. */
  ruleKey?: string;
  ruleSelector?: string;
  ruleSource?: string;
  ruleMedia?: string[];
};

export type ViewportContext = {
  deviceId: string;
  deviceName: string;
  posture: Posture;
  orientation: Orientation;
  width: number;
  height: number;
};

export type Change = {
  id: string;
  kind: ChangeKind;
  target: ChangeTarget;
  /** CSS property, attribute name, or token name. */
  property: string;
  before: string | null;
  after: string | null;
  /** Restrict the change to a media query, e.g. "(max-width: 540px)". */
  media?: string;
  /** Apply to all elements matching the class-level selector instead of one element. */
  scope: 'element' | 'selector';
  viewport: ViewportContext;
  timestamp: number;
  origin: ChangeOrigin;
  exportStatus: ExportStatus;
  /** Experiments are reversible trials recorded separately from committed changes. */
  experiment: boolean;
  groupId?: string;
  note?: string;
};

export type CssomPatch = {
  id: string;
  ruleKey: string;
  ruleSelector: string;
  property: string;
  /** null disables the declaration. */
  value: string | null;
  important?: boolean;
};

export type DomPatch =
  | { id: string; kind: 'text'; selector: string; value: string }
  | { id: string; kind: 'attr'; selector: string; name: string; value: string | null }
  | { id: string; kind: 'hide'; selector: string };

export type PatchSet = {
  /** Override stylesheet text injected after all author styles. */
  css: string;
  cssom: CssomPatch[];
  dom: DomPatch[];
  /** :root custom properties from design tokens. */
  tokens: Record<string, string>;
};

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export type ConsoleEntry = {
  id: string;
  instanceId: string;
  level: LogLevel;
  args: string[];
  timestamp: number;
  source?: string;
  stack?: string;
  count: number;
  kind: 'console' | 'runtime' | 'promise' | 'system';
};

export type NetworkEntry = {
  id: string;
  instanceId: string;
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
  redacted: boolean;
  source: 'resource-timing' | 'instrumented' | 'chromium';
};

export type IssueSeverity = 'critical' | 'serious' | 'moderate' | 'minor' | 'info';

export type ResponsiveIssue = {
  id: string;
  rule: string;
  title: string;
  severity: IssueSeverity;
  message: string;
  selector: string;
  nodeId?: NodeId;
  rect?: Rect;
  viewport: ViewportContext;
  evidence: Record<string, string | number | boolean>;
  suggestion?: string;
  /** Whether a viewport change is expected to cause this (responsive behaviour vs regression). */
  classification: 'regression' | 'suspicious' | 'expected';
};

export type A11yIssue = {
  id: string;
  ruleId: string;
  impact: IssueSeverity;
  help: string;
  description: string;
  helpUrl: string;
  tags: string[];
  nodes: { selector: string; html: string; summary: string; nodeId?: NodeId }[];
  viewport?: ViewportContext;
};

/* ------------------------------------------------------------------ */
/* Recording                                                           */
/* ------------------------------------------------------------------ */

export type Locator = {
  role?: string;
  name?: string;
  label?: string;
  testId?: string;
  text?: string;
  placeholder?: string;
  css: string;
};

export type StepAction =
  | { type: 'click'; locator: Locator; /** 2 = double-click (both clicks dispatched in the same task). */ clickCount?: number }
  | { type: 'fill'; locator: Locator; value: string; masked: boolean }
  | { type: 'press'; locator?: Locator; key: string }
  | { type: 'focus'; locator: Locator }
  | { type: 'select'; locator: Locator; value: string }
  | { type: 'check'; locator: Locator; checked: boolean }
  | { type: 'navigate'; url: string }
  | { type: 'viewport'; state: ViewportState }
  | { type: 'fold'; posture: Posture }
  | { type: 'wait'; condition: WaitCondition; timeout: number }
  | { type: 'assert'; assertion: Assertion }
  | { type: 'screenshot'; label: string };

export type WaitCondition =
  | { kind: 'visible'; locator: Locator }
  | { kind: 'hidden'; locator: Locator }
  | { kind: 'text'; text: string }
  | { kind: 'url'; includes: string }
  | { kind: 'delay'; ms: number };

export type Assertion =
  | { kind: 'visible'; locator: Locator }
  | { kind: 'hidden'; locator: Locator }
  | { kind: 'text'; locator?: Locator; text: string }
  | { kind: 'value'; locator: Locator; value: string }
  | { kind: 'focused'; locator: Locator }
  | { kind: 'no-horizontal-overflow' }
  | { kind: 'in-viewport'; locator: Locator }
  | { kind: 'count'; locator: Locator; count: number }
  | { kind: 'enabled'; locator: Locator; enabled: boolean };

export type TestStep = {
  id: string;
  action: StepAction;
  timestamp: number;
  timeout: number;
  description: string;
  /** Expected outcome in plain language. */
  expect?: string;
};

export type Scenario = {
  id: string;
  name: string;
  description: string;
  suite?: string;
  route?: string;
  steps: TestStep[];
  createdAt: number;
  builtIn: boolean;
  tags: string[];
};

export type StepResult = {
  stepId: string;
  status: 'passed' | 'failed' | 'skipped';
  error?: string;
  durationMs: number;
  screenshot?: string;
  usedLocator?: string;
};

export type ScenarioRun = {
  id: string;
  scenarioId: string;
  scenarioName: string;
  viewport: ViewportContext;
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'passed' | 'failed' | 'aborted';
  steps: StepResult[];
  issues: (ResponsiveIssue | A11yIssue)[];
  consoleErrors: string[];
  finalScreenshot?: string;
};

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

export type TokenType = 'color' | 'typography' | 'spacing' | 'radius' | 'shadow' | 'breakpoint' | 'z-index' | 'other';

export type DesignToken = {
  id: string;
  name: string;
  type: TokenType;
  value: string;
  description?: string;
  /** CSS custom property name this token maps to (e.g. --color-brand). */
  cssVar: string;
};
