/**
 * Pure run analytics: aggregation, latest-result lookup, per-step timing,
 * run comparison and auto-generated reproduction steps.
 */
import type { A11yIssue, ResponsiveIssue, Scenario, ScenarioRun, StepAction, StepResult, TestStep } from '@shared/types';
import { describeAssertion, describeWait, locatorPhrase, maskValue, secretNames } from '@/modules/interaction-recorder/steps';
import { viewportKey } from './matrix';

export type RunSummary = {
  total: number;
  passed: number;
  failed: number;
  aborted: number;
  running: number;
  /** passed / finished (0..1); null when nothing finished. */
  passRate: number | null;
  durationMs: number;
  steps: { total: number; passed: number; failed: number; skipped: number };
  issues: number;
  consoleErrors: number;
  scenarios: number;
  viewports: number;
};

export function runDuration(run: ScenarioRun): number {
  if (run.finishedAt) return Math.max(0, run.finishedAt - run.startedAt);
  return run.steps.reduce((n, s) => n + s.durationMs, 0);
}

export function summarizeRuns(runs: ScenarioRun[]): RunSummary {
  const out: RunSummary = {
    total: runs.length,
    passed: 0,
    failed: 0,
    aborted: 0,
    running: 0,
    passRate: null,
    durationMs: 0,
    steps: { total: 0, passed: 0, failed: 0, skipped: 0 },
    issues: 0,
    consoleErrors: 0,
    scenarios: new Set(runs.map((r) => r.scenarioId)).size,
    viewports: new Set(runs.map((r) => viewportKey(r.viewport))).size,
  };
  for (const r of runs) {
    out[r.status === 'running' ? 'running' : r.status] += 1;
    out.durationMs += runDuration(r);
    out.issues += r.issues.length;
    out.consoleErrors += r.consoleErrors.length;
    for (const s of r.steps) {
      out.steps.total += 1;
      out.steps[s.status] += 1;
    }
  }
  const finished = out.passed + out.failed;
  out.passRate = finished ? out.passed / finished : null;
  return out;
}

export const runCellKey = (scenarioId: string, v: Parameters<typeof viewportKey>[0]) => `${scenarioId}::${viewportKey(v)}`;

/** Latest run per scenario × viewport. */
export function latestRuns(runs: ScenarioRun[]): Map<string, ScenarioRun> {
  const map = new Map<string, ScenarioRun>();
  for (const r of runs) {
    const k = runCellKey(r.scenarioId, r.viewport);
    const prev = map.get(k);
    if (!prev || r.startedAt > prev.startedAt) map.set(k, r);
  }
  return map;
}

/** Latest run per scenario (any viewport). */
export function latestRunByScenario(runs: ScenarioRun[]): Map<string, ScenarioRun> {
  const map = new Map<string, ScenarioRun>();
  for (const r of runs) {
    const prev = map.get(r.scenarioId);
    if (!prev || r.startedAt > prev.startedAt) map.set(r.scenarioId, r);
  }
  return map;
}

/** Start offset (ms since run start) of each step, from cumulative durations. */
export function stepOffsets(results: Pick<StepResult, 'durationMs'>[]): number[] {
  let t = 0;
  return results.map((r) => {
    const at = t;
    t += r.durationMs;
    return at;
  });
}

export function firstFailure(run: ScenarioRun): number {
  return run.steps.findIndex((s) => s.status === 'failed');
}

export function failedSteps(run: ScenarioRun): StepResult[] {
  return run.steps.filter((s) => s.status === 'failed');
}

export type StepComparison = {
  stepId: string;
  index: number;
  description: string;
  a?: StepResult;
  b?: StepResult;
  /** b - a in ms when both ran. */
  deltaMs: number | null;
  change: 'same' | 'fixed' | 'regressed' | 'changed' | 'only-a' | 'only-b';
};

/** Step-by-step comparison of two runs (usually of the same scenario). */
export function compareRuns(a: ScenarioRun, b: ScenarioRun, scenario?: Scenario): { steps: StepComparison[]; durationDeltaMs: number; statusChanged: boolean } {
  const order: string[] = scenario?.steps.map((s) => s.id) ?? [];
  for (const r of [...a.steps, ...b.steps]) if (!order.includes(r.stepId)) order.push(r.stepId);
  const byA = new Map(a.steps.map((s) => [s.stepId, s]));
  const byB = new Map(b.steps.map((s) => [s.stepId, s]));
  const desc = new Map(scenario?.steps.map((s) => [s.id, s.description]) ?? []);
  const steps = order.map((id, index): StepComparison => {
    const ra = byA.get(id);
    const rb = byB.get(id);
    let change: StepComparison['change'] = 'same';
    if (ra && !rb) change = 'only-a';
    else if (!ra && rb) change = 'only-b';
    else if (ra && rb && ra.status !== rb.status) change = ra.status === 'failed' && rb.status === 'passed' ? 'fixed' : rb.status === 'failed' ? 'regressed' : 'changed';
    const ran = (r?: StepResult) => r && r.status !== 'skipped';
    return { stepId: id, index, description: desc.get(id) ?? id, a: ra, b: rb, deltaMs: ran(ra) && ran(rb) ? rb!.durationMs - ra!.durationMs : null, change };
  });
  return { steps, durationDeltaMs: runDuration(b) - runDuration(a), statusChanged: a.status !== b.status };
}

/* ------------------------------------------------------------------ */
/* Reproduction steps                                                  */
/* ------------------------------------------------------------------ */

function fixturePhrase(value: string): string {
  const names = secretNames(value);
  if (names.length === 1 && value.trim() === `{{secret:${names[0]}}}`) return `the synthetic fixture value “${names[0]}”`;
  return `“${maskValue(value)}”`;
}

export function reproSentence(action: StepAction, deviceName: (id: string) => string = (id) => id): string {
  switch (action.type) {
    case 'click':
      return `${(action.clickCount ?? 1) > 1 ? 'Double-click' : 'Click'} ${locatorPhrase(action.locator)}.`;
    case 'fill':
      return action.masked && secretNames(action.value).length === 0
        ? `Type a value (masked when recorded) into ${locatorPhrase(action.locator)}.`
        : `Type ${fixturePhrase(action.value)} into ${locatorPhrase(action.locator)}.`;
    case 'press':
      return `Press ${action.key.replace('Space', 'the Space bar')}${action.locator ? ` with focus on ${locatorPhrase(action.locator)}` : ''}.`;
    case 'focus':
      return `Move focus to ${locatorPhrase(action.locator)}.`;
    case 'select':
      return `Choose “${action.value}” in ${locatorPhrase(action.locator)}.`;
    case 'check':
      return `${action.checked ? 'Select' : 'Clear'} ${locatorPhrase(action.locator)}.`;
    case 'navigate':
      return `Go to ${action.url}.`;
    case 'viewport':
      return `Switch the device to ${deviceName(action.state.deviceId)} (${action.state.posture}, ${action.state.orientation}).`;
    case 'fold':
      return action.posture === 'expanded' ? 'Unfold the device to its expanded posture.' : 'Fold the device back to its folded posture.';
    case 'wait':
      return `${describeWait(action.condition)}.`;
    case 'assert':
      return `Check that ${lowerFirst(describeAssertion(action.assertion))}.`;
    case 'screenshot':
      return `Take a screenshot (“${action.label}”).`;
  }
}

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

export type ReproOptions = {
  routeLabel?: (route: string) => string;
  deviceName?: (id: string) => string;
  /** Include steps after the first failure (default: stop at the first failure). */
  all?: boolean;
};

/**
 * Numbered, plain-language reproduction steps for a run. Secrets are named by
 * fixture, never revealed. Steps that were skipped are left out.
 */
export function buildReproSteps(scenario: Pick<Scenario, 'route' | 'steps'>, run: ScenarioRun, opts: ReproOptions = {}): string[] {
  const out: string[] = [];
  const v = run.viewport;
  const where = scenario.route ? (opts.routeLabel?.(scenario.route) ?? scenario.route) : 'the start page';
  out.push(`Open ${where} on ${v.deviceName} (${v.posture}, ${v.orientation}, ${v.width}×${v.height} CSS px) from a fresh page load.`);
  const results = new Map(run.steps.map((r) => [r.stepId, r]));
  const fail = run.steps.findIndex((s) => s.status === 'failed');
  const failId = fail >= 0 ? run.steps[fail].stepId : null;
  for (const step of scenario.steps as TestStep[]) {
    const r = results.get(step.id);
    if (r?.status === 'skipped' && step.id !== failId) continue;
    let line = reproSentence(step.action, opts.deviceName);
    if (r?.status === 'failed') {
      const expected = step.expect ?? (step.action.type === 'assert' ? describeAssertion(step.action.assertion) : 'the step completes');
      line += ` Expected: ${expected}. Actual: ${r.error ?? 'the step failed'}.`;
    }
    out.push(line);
    if (!opts.all && step.id === failId) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Issues                                                              */
/* ------------------------------------------------------------------ */

export type RunIssue = ResponsiveIssue | A11yIssue;

export const isA11yIssue = (i: RunIssue): i is A11yIssue => 'ruleId' in i;

export function issueTitle(i: RunIssue): string {
  return isA11yIssue(i) ? i.help : i.title;
}

export function issueSeverity(i: RunIssue) {
  return isA11yIssue(i) ? i.impact : i.severity;
}

export function issueTarget(i: RunIssue): string {
  return isA11yIssue(i) ? (i.nodes[0]?.selector ?? '') : i.selector;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`;
}
