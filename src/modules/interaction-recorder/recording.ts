/**
 * Recording controller: starts/stops the in-page recorder on the primary
 * preview, appends studio-side steps (device, posture, orientation changes,
 * assertions, waits, screenshots) and edits the steps of the current
 * recording or a user scenario.
 */
import { create } from 'zustand';
import { toast } from 'sonner';
import type { Assertion, Locator, NodeInfo, Scenario, TestStep, ViewportState, WaitCondition } from '@shared/types';
import { studio, useStudio } from '@/store';
import { bus } from '@/lib/events';
import { previews } from '@/modules/preview-runtime/registry';
import { isRunning, runner, showInTimeline, useRunner } from '@/modules/interaction-replayer';
import { describeAction, describeViewportState, makeStep, moveStep, newId, secretPlaceholder } from './steps';

const PRIMARY = 'primary';

type RecorderUi = {
  /** Context captured when recording started. */
  meta: { route: string; viewport: ViewportState; startedAt: number; deviceName: string } | null;
  saveOpen: boolean;
  importOpen: boolean;
  starting: boolean;
};

export const useRecorderUi = create<RecorderUi>()(() => ({ meta: null, saveOpen: false, importOpen: false, starting: false }));

const deviceName = (id: string) => studio().allDevices().find((d) => d.id === id)?.name ?? id;

/* ------------------------------------------------------------------ */
/* Start / stop                                                        */
/* ------------------------------------------------------------------ */

export async function startRecording() {
  const s = studio();
  if (!s.project) throw new Error('Open a project to record an interaction.');
  if (isRunning()) throw new Error('Stop the running test before recording.');
  if (s.recording.active) return;
  const conn = previews.get(PRIMARY);
  if (!conn?.ready) throw new Error('The preview is still loading. Try again in a moment.');
  useRecorderUi.setState({ starting: true });
  try {
    await conn.call('record.start', { maskAllInputs: s.settings.maskAllInputs }, 5000);
  } finally {
    useRecorderUi.setState({ starting: false });
  }
  studio().startRecording(PRIMARY);
  useRecorderUi.setState({ meta: { route: s.currentRoute, viewport: { ...s.viewport }, startedAt: Date.now(), deviceName: s.device().name }, saveOpen: false });
  // The recorder only sees real page input in interact mode.
  if (studio().interaction !== 'interact') studio().setInteraction('interact');
  showInTimeline({ kind: 'recording' });
  studio().setBottomTab('timeline');
}

export async function stopRecording(): Promise<TestStep[]> {
  const s = studio();
  if (!s.recording.active) return s.recording.steps;
  // record.stop flushes pending typing as events that arrive before the response.
  await previews
    .get(PRIMARY)
    ?.call('record.stop', undefined, 4000)
    .catch(() => {});
  flushViewport();
  const steps = studio().stopRecording();
  useRecorderUi.setState({ saveOpen: steps.length > 0 });
  if (!steps.length) toast('Recording stopped', { description: 'No steps were captured. Switch to Interact mode and use the page while recording.' });
  return steps;
}

export async function toggleRecording() {
  try {
    if (studio().recording.active) await stopRecording();
    else await startRecording();
  } catch (e) {
    toast.error((e as Error).message);
  }
}

export function saveRecording(input: { name: string; suite?: string; description?: string }): Scenario {
  const s = studio();
  const meta = useRecorderUi.getState().meta;
  const sc: Scenario = {
    id: newId('sc'),
    name: input.name.trim() || 'Recorded scenario',
    description: input.description?.trim() ?? '',
    suite: input.suite?.trim() || 'Recorded',
    route: meta?.route ?? s.currentRoute,
    steps: s.recording.steps,
    createdAt: Date.now(),
    builtIn: false,
    tags: ['recorded', meta?.deviceName ?? s.device().name],
  };
  s.upsertScenario(sc);
  s.setRecordedSteps([]);
  useRecorderUi.setState({ saveOpen: false });
  showInTimeline({ kind: 'scenario', scenarioId: sc.id, runId: null });
  toast.success(`Saved “${sc.name}”`, { description: `${sc.steps.length} steps · ${sc.suite}` });
  return sc;
}

export function discardRecording() {
  studio().setRecordedSteps([]);
  useRecorderUi.setState({ saveOpen: false, meta: null });
}

/* ------------------------------------------------------------------ */
/* Studio-side steps while recording                                   */
/* ------------------------------------------------------------------ */

let vpTimer: ReturnType<typeof setTimeout> | null = null;

function flushViewport() {
  if (vpTimer) clearTimeout(vpTimer);
  vpTimer = null;
  const s = studio();
  const meta = useRecorderUi.getState().meta;
  if (!s.recording.active || !meta) return;
  const v = s.viewport;
  const last = meta.viewport;
  if (v.deviceId === last.deviceId && v.orientation === last.orientation && v.posture === last.posture) return;
  if (v.deviceId === last.deviceId && v.orientation === last.orientation) {
    s.addRecordedStep(makeStep({ type: 'fold', posture: v.posture }, undefined, { expect: 'Typed values, focus and scroll position survive the posture change', timeout: 6000 }));
  } else {
    const state = { ...v };
    s.addRecordedStep(makeStep({ type: 'viewport', state }, `Switch to ${describeViewportState(state, deviceName(state.deviceId))}`, { timeout: 8000 }));
  }
  useRecorderUi.setState({ meta: { ...meta, viewport: { ...v } } });
}

/** Startup wiring: viewport changes become steps, reloads re-arm the in-page recorder. */
export function startRecordingSync() {
  useStudio.subscribe(
    (s) => s.viewport,
    () => {
      if (!studio().recording.active || studio().transition.playing) return;
      if (vpTimer) clearTimeout(vpTimer);
      vpTimer = setTimeout(flushViewport, 350);
    },
  );
  bus.on('preview-hello', ({ instanceId }) => {
    const s = studio();
    if (!s.recording.active || s.recording.instanceId !== instanceId) return;
    previews.get(instanceId)?.tell('record.start', { maskAllInputs: s.settings.maskAllInputs });
  });
}

/* ------------------------------------------------------------------ */
/* Selection → locators and assertions                                 */
/* ------------------------------------------------------------------ */

export function locatorFromInfo(info: NodeInfo): Locator {
  const attr = (n: string) => info.attrs.find(([k]) => k === n)?.[1];
  const role = info.a11y.role && info.a11y.role !== 'generic' && info.a11y.role !== 'none' ? info.a11y.role : undefined;
  const loc: Locator = { css: info.selector };
  const testId = attr('data-testid');
  if (testId) loc.testId = testId;
  if (role && info.a11y.name) {
    loc.role = role;
    loc.name = info.a11y.name.trim();
  }
  const placeholder = attr('placeholder');
  if (placeholder) loc.placeholder = placeholder;
  if (info.text && info.text.length <= 60) loc.text = info.text.replace(/\s+/g, ' ').trim();
  return loc;
}

export type AssertKind = 'visible' | 'hidden' | 'text' | 'value' | 'focused' | 'in-viewport' | 'enabled' | 'no-horizontal-overflow';

export const ELEMENT_ASSERTIONS: AssertKind[] = ['visible', 'text', 'value', 'focused', 'in-viewport', 'enabled', 'hidden'];

export function selectedElement(): { info: NodeInfo; locator: Locator } | null {
  const info = studio().selection.info;
  return info ? { info, locator: locatorFromInfo(info) } : null;
}

/** Current live value of the selected form control (sensitive values come back masked). */
export async function selectedValue(): Promise<{ value: string; sensitive: boolean } | null> {
  const sel = studio().selection;
  if (!sel.info) return null;
  const conn = previews.get(sel.instanceId) ?? previews.get(PRIMARY);
  const fields = await conn?.call('state.form', undefined, 4000).catch(() => null);
  const f = fields?.find((x) => x.selector === sel.info!.selector);
  if (!f) return null;
  return /^•••/.test(f.value) || (f.value === '' && sel.info.attrs.some(([k, v]) => k === 'type' && v === 'password')) ? { value: '', sensitive: true } : { value: f.value, sensitive: false };
}

export function buildAssertion(kind: AssertKind, locator: Locator | null, params: { text?: string; value?: string; enabled?: boolean } = {}): Assertion | null {
  if (kind === 'no-horizontal-overflow') return { kind };
  if (!locator) return null;
  switch (kind) {
    case 'text':
      return { kind, locator, text: params.text ?? '' };
    case 'value':
      return { kind, locator, value: params.value ?? '' };
    case 'enabled':
      return { kind, locator, enabled: params.enabled ?? true };
    default:
      return { kind, locator };
  }
}

export function assertionStep(a: Assertion, expect?: string): TestStep {
  const step = makeStep({ type: 'assert', assertion: a }, undefined, { timeout: 2000, expect });
  return step;
}

export function waitStep(c: WaitCondition, timeout = 5000): TestStep {
  return makeStep({ type: 'wait', condition: c, timeout }, undefined, { timeout });
}

export function screenshotStep(label: string): TestStep {
  return makeStep({ type: 'screenshot', label: label.trim() || 'Screenshot' }, undefined, { timeout: 20000 });
}

export { secretPlaceholder };

/* ------------------------------------------------------------------ */
/* Editing the timeline subject                                        */
/* ------------------------------------------------------------------ */

export type EditTarget = { kind: 'recording'; steps: TestStep[] } | { kind: 'scenario'; scenario: Scenario; steps: TestStep[] };

/** What the timeline edits right now; null when there is nothing editable. */
export function editTarget(): EditTarget | { readonly: true; reason: string } | null {
  const s = studio();
  const sub = runner().subject;
  if (s.recording.active || sub?.kind === 'recording' || !sub) return { kind: 'recording', steps: s.recording.steps };
  const sc = s.scenarios.find((x) => x.id === sub.scenarioId);
  if (!sc) return null;
  if (sc.builtIn) return { readonly: true, reason: 'Built-in scenarios are read-only. Duplicate it to edit the steps.' };
  return { kind: 'scenario', scenario: sc, steps: sc.steps };
}

function writeSteps(t: EditTarget, steps: TestStep[]) {
  if (t.kind === 'recording') studio().setRecordedSteps(steps);
  else studio().upsertScenario({ ...t.scenario, steps });
}

function requireEditable(): EditTarget {
  const t = editTarget();
  if (!t) throw new Error('Pick a scenario or start a recording first.');
  if ('readonly' in t) throw new Error(t.reason);
  return t;
}

/** Insert after the selected step (or append). Recording appends. */
export function insertStep(step: TestStep) {
  const s = studio();
  if (s.recording.active) {
    s.addRecordedStep(step);
    useRunner.setState({ selectedStepId: step.id });
    return;
  }
  const t = requireEditable();
  const sel = runner().selectedStepId;
  const idx = sel ? t.steps.findIndex((x) => x.id === sel) : -1;
  const next = [...t.steps];
  next.splice(idx >= 0 ? idx + 1 : next.length, 0, step);
  writeSteps(t, next);
  useRunner.setState({ selectedStepId: step.id });
}

export function updateStep(id: string, patch: Partial<TestStep>) {
  const t = requireEditable();
  writeSteps(
    t,
    t.steps.map((x) => {
      if (x.id !== id) return x;
      const next = { ...x, ...patch };
      // Keep generated descriptions in sync when the action changes and the text was never customised.
      if (patch.action && !patch.description && x.description === describeAction(x.action)) next.description = describeAction(next.action);
      return next;
    }),
  );
}

export function deleteStep(id: string) {
  const t = requireEditable();
  const idx = t.steps.findIndex((x) => x.id === id);
  writeSteps(
    t,
    t.steps.filter((x) => x.id !== id),
  );
  const next = t.steps[idx + 1] ?? t.steps[idx - 1];
  useRunner.setState({ selectedStepId: next && next.id !== id ? next.id : null });
}

export function reorderStep(from: number, to: number) {
  const t = requireEditable();
  writeSteps(t, moveStep(t.steps, from, to));
}

/** Wrap an editing call with a toast on failure (for UI handlers). */
export function tryEdit(fn: () => void) {
  try {
    fn();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
