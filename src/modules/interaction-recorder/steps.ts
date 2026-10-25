/**
 * Pure helpers for test steps: creation, human-readable descriptions,
 * locator summaries, secret placeholders and scenario (de)serialisation.
 * No store or DOM access here so everything is unit-testable.
 */
import type { Assertion, Locator, Scenario, StepAction, TestStep, ViewportState, WaitCondition } from '@shared/types';

export const DEFAULT_TIMEOUT = 5000;

let seq = 0;
export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function makeStep(action: StepAction, description?: string, opts: { expect?: string; timeout?: number; timestamp?: number } = {}): TestStep {
  return {
    id: newId('st'),
    action,
    timestamp: opts.timestamp ?? Date.now(),
    timeout: opts.timeout ?? DEFAULT_TIMEOUT,
    description: description ?? describeAction(action),
    expect: opts.expect,
  };
}

/* ------------------------------------------------------------------ */
/* Locators                                                            */
/* ------------------------------------------------------------------ */

/** Short human label for a locator, mirroring the agent's strategy order. */
export function locatorLabel(l: Locator | undefined): string {
  if (!l) return 'the focused element';
  if (l.testId) return `[data-testid="${l.testId}"]`;
  if (l.role && l.name) return `${l.role} “${l.name}”`;
  if (l.label) return `field “${l.label}”`;
  if (l.placeholder) return `placeholder “${l.placeholder}”`;
  if (l.text) return `text “${l.text}”`;
  return l.css;
}

/** Friendlier label for reproduction steps (accessible name first). */
export function locatorPhrase(l: Locator | undefined): string {
  if (!l) return 'the focused element';
  if (l.role && l.name) return `the ${l.role} “${l.name}”`;
  if (l.label) return `the field “${l.label}”`;
  if (l.text) return `“${l.text}”`;
  if (l.placeholder) return `the field with placeholder “${l.placeholder}”`;
  if (l.testId) return `[data-testid="${l.testId}"]`;
  return `\`${l.css}\``;
}

export type LocatorStrategy = { key: 'testId' | 'role+name' | 'label' | 'placeholder' | 'css' | 'text'; label: string; value: string };

/** Strategies in the order the agent tries them. */
export function locatorStrategies(l: Locator): LocatorStrategy[] {
  const out: LocatorStrategy[] = [];
  if (l.testId) out.push({ key: 'testId', label: 'Test id', value: l.testId });
  if (l.role && l.name) out.push({ key: 'role+name', label: 'Role + name', value: `${l.role} “${l.name}”` });
  if (l.label) out.push({ key: 'label', label: 'Label', value: l.label });
  if (l.placeholder) out.push({ key: 'placeholder', label: 'Placeholder', value: l.placeholder });
  out.push({ key: 'css', label: 'CSS', value: l.css });
  if (l.text) out.push({ key: 'text', label: 'Text', value: l.text });
  return out;
}

export const testIdLocator = (testId: string, extra: Partial<Locator> = {}): Locator => ({ testId, css: `[data-testid="${testId}"]`, ...extra });
export const cssLocator = (css: string, extra: Partial<Locator> = {}): Locator => ({ css, ...extra });

export function stepLocator(action: StepAction): Locator | undefined {
  switch (action.type) {
    case 'click':
    case 'fill':
    case 'focus':
    case 'select':
    case 'check':
      return action.locator;
    case 'press':
      return action.locator;
    case 'wait':
      return action.condition.kind === 'visible' || action.condition.kind === 'hidden' ? action.condition.locator : undefined;
    case 'assert':
      return 'locator' in action.assertion ? action.assertion.locator : undefined;
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Secrets                                                             */
/* ------------------------------------------------------------------ */

const SECRET_RE = /\{\{secret:([A-Za-z0-9_.-]+)\}\}/g;

export const secretPlaceholder = (name: string) => `{{secret:${name}}}`;

/** Names of all `{{secret:name}}` placeholders in a string. */
export function secretNames(value: string): string[] {
  return [...value.matchAll(SECRET_RE)].map((m) => m[1]);
}

export function hasSecret(value: string): boolean {
  return secretNames(value).length > 0;
}

/** Render a value for display: secrets become a bullet placeholder, never the real value. */
export function maskValue(value: string): string {
  return value.replace(SECRET_RE, (_m, name: string) => `•••• (${name})`);
}

/** Replace placeholders with fixture values. Missing fixtures are reported, never guessed. */
export function resolveSecrets(value: string, fixtures: Record<string, string>): { value: string; missing: string[]; used: Record<string, string> } {
  const missing: string[] = [];
  const used: Record<string, string> = {};
  const out = value.replace(SECRET_RE, (m, name: string) => {
    if (Object.prototype.hasOwnProperty.call(fixtures, name)) {
      used[name] = fixtures[name];
      return fixtures[name];
    }
    missing.push(name);
    return m;
  });
  return { value: out, missing, used };
}

/** Deep-resolve every string inside a step action (fill values, assertion values/texts, waits). */
export function resolveActionSecrets(action: StepAction, fixtures: Record<string, string>): { action: StepAction; missing: string[]; used: Record<string, string> } {
  const missing = new Set<string>();
  const used: Record<string, string> = {};
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const r = resolveSecrets(v, fixtures);
      r.missing.forEach((m) => missing.add(m));
      Object.assign(used, r.used);
      return r.value;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { action: walk(action) as StepAction, missing: [...missing], used };
}

/** Does this action contain any secret placeholder? */
export function actionHasSecret(action: StepAction): boolean {
  return hasSecret(JSON.stringify(action));
}

/**
 * Remove resolved secret values from text that leaves the run (errors, console
 * output). Longest values first so overlapping secrets are fully covered.
 */
export function redactSecrets(text: string, used: Record<string, string>): string {
  let out = text;
  const entries = Object.entries(used)
    .filter(([, v]) => v && v.length >= 3)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [name, v] of entries) out = out.split(v).join(secretPlaceholder(name));
  return out;
}

/* ------------------------------------------------------------------ */
/* Descriptions                                                        */
/* ------------------------------------------------------------------ */

export const ACTION_LABELS: Record<StepAction['type'], string> = {
  click: 'Click',
  fill: 'Type',
  press: 'Key',
  focus: 'Focus',
  select: 'Select',
  check: 'Check',
  navigate: 'Navigate',
  viewport: 'Viewport',
  fold: 'Posture',
  wait: 'Wait',
  assert: 'Assert',
  screenshot: 'Screenshot',
};

export const ASSERTION_LABELS: Record<Assertion['kind'], string> = {
  visible: 'Visible',
  hidden: 'Hidden',
  text: 'Text',
  value: 'Value',
  focused: 'Focused',
  'no-horizontal-overflow': 'No horizontal overflow',
  'in-viewport': 'In viewport',
  count: 'Count',
  enabled: 'Enabled',
};

const q = (s: string) => `“${s}”`;

export function describeWait(c: WaitCondition): string {
  switch (c.kind) {
    case 'visible':
      return `Wait until ${locatorLabel(c.locator)} is visible`;
    case 'hidden':
      return `Wait until ${locatorLabel(c.locator)} is hidden`;
    case 'text':
      return `Wait for text ${q(maskValue(c.text))}`;
    case 'url':
      return `Wait for the URL to include ${q(c.includes)}`;
    case 'delay':
      return `Wait ${c.ms} ms`;
  }
}

export function describeAssertion(a: Assertion): string {
  switch (a.kind) {
    case 'visible':
      return `${locatorLabel(a.locator)} is visible`;
    case 'hidden':
      return `${locatorLabel(a.locator)} is hidden`;
    case 'text':
      return `${a.locator ? locatorLabel(a.locator) : 'Page'} contains ${q(maskValue(a.text))}`;
    case 'value':
      return `${locatorLabel(a.locator)} has value ${q(maskValue(a.value))}`;
    case 'focused':
      return `${locatorLabel(a.locator)} has focus`;
    case 'no-horizontal-overflow':
      return 'Page does not overflow horizontally';
    case 'in-viewport':
      return `${locatorLabel(a.locator)} fits inside the viewport`;
    case 'count':
      return `Exactly ${a.count} × ${a.locator.css}`;
    case 'enabled':
      return `${locatorLabel(a.locator)} is ${a.enabled ? 'enabled' : 'disabled'}`;
  }
}

export function describeViewportState(v: ViewportState, deviceName?: string): string {
  return `${deviceName ?? v.deviceId} · ${v.posture}${v.orientation === 'landscape' ? ' · landscape' : ''}`;
}

export function describeAction(a: StepAction, deviceName?: (id: string) => string | undefined): string {
  switch (a.type) {
    case 'click':
      return `${(a.clickCount ?? 1) > 1 ? 'Double-click' : 'Click'} ${locatorLabel(a.locator)}`;
    case 'fill':
      return `Type ${a.masked || hasSecret(a.value) ? '•••••' : q(a.value)} into ${locatorLabel(a.locator)}`;
    case 'press':
      return `Press ${a.key}${a.locator ? ` on ${locatorLabel(a.locator)}` : ''}`;
    case 'focus':
      return `Focus ${locatorLabel(a.locator)}`;
    case 'select':
      return `Select ${q(a.value)} in ${locatorLabel(a.locator)}`;
    case 'check':
      return `${a.checked ? 'Check' : 'Uncheck'} ${locatorLabel(a.locator)}`;
    case 'navigate':
      return `Navigate to ${a.url}`;
    case 'viewport':
      return `Switch to ${describeViewportState(a.state, deviceName?.(a.state.deviceId))}`;
    case 'fold':
      return a.posture === 'expanded' ? 'Unfold the device' : 'Fold the device';
    case 'wait':
      return describeWait(a.condition);
    case 'assert':
      return `Assert ${describeAssertion(a.assertion)}`;
    case 'screenshot':
      return `Screenshot “${a.label}”`;
  }
}

/** The "value" a step carries, for compact display (masked placeholders stay masked). */
export function stepValue(a: StepAction): string | null {
  switch (a.type) {
    case 'fill':
      return a.masked || hasSecret(a.value) ? maskValue(hasSecret(a.value) ? a.value : '{{secret:value}}') : a.value;
    case 'select':
      return a.value;
    case 'press':
      return a.key;
    case 'check':
      return a.checked ? 'checked' : 'unchecked';
    case 'navigate':
      return a.url;
    case 'wait':
      return a.condition.kind === 'delay' ? `${a.condition.ms} ms` : a.condition.kind === 'url' ? a.condition.includes : a.condition.kind === 'text' ? maskValue(a.condition.text) : null;
    case 'assert':
      return a.assertion.kind === 'text' ? maskValue(a.assertion.text) : a.assertion.kind === 'value' ? maskValue(a.assertion.value) : a.assertion.kind === 'count' ? String(a.assertion.count) : null;
    case 'screenshot':
      return a.label;
    case 'fold':
      return a.posture;
    default:
      return null;
  }
}

/** Steps executed by the studio itself rather than by the in-page agent. */
export function isStudioStep(a: StepAction): boolean {
  return a.type === 'viewport' || a.type === 'fold' || a.type === 'navigate' || a.type === 'screenshot';
}

/**
 * Assertions are "soft": a failure is recorded and the run continues so one
 * report shows every broken expectation. Action failures stop the run.
 */
export function isSoftStep(a: StepAction): boolean {
  return a.type === 'assert' || a.type === 'screenshot';
}

/* ------------------------------------------------------------------ */
/* Serialisation                                                       */
/* ------------------------------------------------------------------ */

export const SCENARIO_FORMAT = 'ifdy.scenario';
export const SCENARIO_FORMAT_VERSION = 1;

type Envelope = { format: typeof SCENARIO_FORMAT; version: number; scenario: Scenario };

export function serializeScenario(sc: Scenario): string {
  const env: Envelope = { format: SCENARIO_FORMAT, version: SCENARIO_FORMAT_VERSION, scenario: { ...sc, steps: sc.steps.map((s) => ({ ...s })) } };
  return JSON.stringify(env, null, 2);
}

const STEP_TYPES = new Set(Object.keys(ACTION_LABELS));
const ASSERT_KINDS = new Set(Object.keys(ASSERTION_LABELS));

function validateLocator(l: unknown, where: string) {
  if (!l || typeof l !== 'object' || typeof (l as Locator).css !== 'string') throw new Error(`${where}: locator needs a css selector`);
}

export function validateStep(step: unknown, index: number): TestStep {
  const where = `Step ${index + 1}`;
  if (!step || typeof step !== 'object') throw new Error(`${where} is not an object`);
  const s = step as TestStep;
  if (typeof s.id !== 'string' || !s.id) throw new Error(`${where} has no id`);
  if (!s.action || typeof s.action !== 'object' || !STEP_TYPES.has(s.action.type)) throw new Error(`${where} has an unknown action type`);
  const a = s.action;
  if (a.type === 'click' || a.type === 'fill' || a.type === 'focus' || a.type === 'select' || a.type === 'check') validateLocator(a.locator, where);
  if (a.type === 'fill' && typeof a.value !== 'string') throw new Error(`${where}: fill needs a string value`);
  if (a.type === 'press' && typeof a.key !== 'string') throw new Error(`${where}: press needs a key`);
  if (a.type === 'assert') {
    if (!a.assertion || !ASSERT_KINDS.has(a.assertion.kind)) throw new Error(`${where}: unknown assertion`);
    if ('locator' in a.assertion && a.assertion.locator) validateLocator(a.assertion.locator, where);
  }
  if (a.type === 'wait' && (!a.condition || typeof a.condition.kind !== 'string')) throw new Error(`${where}: wait needs a condition`);
  if (a.type === 'viewport' && (!a.state || typeof a.state.deviceId !== 'string')) throw new Error(`${where}: viewport needs a device`);
  return {
    id: s.id,
    action: a,
    timestamp: typeof s.timestamp === 'number' ? s.timestamp : 0,
    timeout: typeof s.timeout === 'number' && s.timeout > 0 ? Math.min(120_000, s.timeout) : DEFAULT_TIMEOUT,
    description: typeof s.description === 'string' ? s.description : describeAction(a),
    expect: typeof s.expect === 'string' ? s.expect : undefined,
  };
}

/** Parse a serialised scenario (or a bare scenario object). Imported scenarios are never built-in. */
export function parseScenario(text: string): Scenario {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Not valid JSON.');
  }
  const env = data as Partial<Envelope>;
  const raw = (env && env.format === SCENARIO_FORMAT ? env.scenario : data) as Partial<Scenario> | undefined;
  if (env?.format === SCENARIO_FORMAT && (env.version ?? 0) > SCENARIO_FORMAT_VERSION) throw new Error(`Scenario format v${env.version} is newer than this IFDY build supports.`);
  if (!raw || typeof raw !== 'object') throw new Error('No scenario found.');
  if (typeof raw.name !== 'string' || !raw.name.trim()) throw new Error('Scenario needs a name.');
  if (!Array.isArray(raw.steps)) throw new Error('Scenario needs a steps array.');
  const steps = raw.steps.map((s, i) => validateStep(s, i));
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId('sc'),
    name: raw.name.trim(),
    description: typeof raw.description === 'string' ? raw.description : '',
    suite: typeof raw.suite === 'string' ? raw.suite : undefined,
    route: typeof raw.route === 'string' ? raw.route : undefined,
    steps,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    builtIn: false,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
  };
}

/** Copy a scenario (e.g. to edit a built-in), with fresh ids. */
export function duplicateScenario(sc: Scenario, name = `${sc.name} (copy)`): Scenario {
  return {
    ...sc,
    id: newId('sc'),
    name,
    builtIn: false,
    createdAt: Date.now(),
    suite: sc.builtIn ? 'My scenarios' : sc.suite,
    tags: [...sc.tags.filter((t) => t !== 'built-in'), 'copy'],
    steps: sc.steps.map((s) => ({ ...s, id: newId('st') })),
  };
}

/** Move a step within a list (drag reorder). */
export function moveStep<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}
