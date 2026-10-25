/**
 * Scenario replay engine.
 *
 * Runs scenarios against the primary canvas preview: agent-executed steps go
 * through `replay.step`; viewport / posture / navigation / screenshot steps are
 * executed by the studio and wait for the preview to report back. Results are
 * published live as `ScenarioRun`s through `studio().upsertRun`.
 *
 * Secrets: `{{secret:name}}` placeholders are resolved from `settings.fixtures`
 * just before a step is sent to the page. Resolved values are never written to
 * runs, errors or console captures (they are redacted back to placeholders).
 */
import type { A11yIssue, ResponsiveIssue, Scenario, ScenarioRun, StepResult, TestStep, ViewportState } from '@shared/types';
import type { AgentEvent } from '@shared/protocol';
import { studio } from '@/store';
import { previews } from '@/modules/preview-runtime/registry';
import type { PreviewConnection } from '@/modules/preview-runtime/connection';
import { canFold } from '@/modules/device-simulator/viewport';
import { currentFold, currentViewportContext } from '@/modules/device-simulator/context';
import { isSoftStep, newId, redactSecrets, resolveActionSecrets } from '@/modules/interaction-recorder/steps';
import { useRunner, type PauseDecision } from './runner-store';
import { contextFor, viewportLabel } from './matrix';

export const PRIMARY = 'primary';

export class RunAborted extends Error {
  constructor() {
    super('Run stopped');
    this.name = 'RunAborted';
  }
}

export type RunOptions = {
  /** Viewport to run at (applied before the page is reset). */
  viewport?: ViewportState;
  /** Index of the first step to execute; earlier steps are reported as skipped. */
  startAt?: number;
  /** Stop at a failed step and wait for Retry / Continue / Stop. */
  pauseOnFailure?: boolean;
  signal?: AbortSignal;
  /** Audit the page's end state (responsive + accessibility) and attach the findings. */
  audits?: boolean;
  /** Reload the page at the scenario's route first (default: true unless startAt > 0). */
  reset?: boolean;
  /** Restore the viewport the user had before the run (default true). */
  restoreViewport?: boolean;
  /** Switch the preview to interact mode for the run and restore it after (default true). */
  manageInteraction?: boolean;
  captureFinal?: boolean;
};

/* ------------------------------------------------------------------ */
/* Small async helpers                                                 */
/* ------------------------------------------------------------------ */

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new RunAborted());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new RunAborted());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

async function waitUntil(fn: () => boolean, timeout: number, signal?: AbortSignal, interval = 50): Promise<boolean> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(interval, signal);
  }
  return fn();
}

function withAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(new RunAborted());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new RunAborted());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

function nextEvent(conn: PreviewConnection, events: AgentEvent[], timeout: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const offs = events.map((e) => conn.on(e, () => done(resolve)));
    const t = setTimeout(() => done(() => reject(new Error(`The preview did not report ${events.join(' / ')} within ${Math.round(timeout / 1000)} s`))), timeout);
    const onAbort = () => done(() => reject(new RunAborted()));
    signal?.addEventListener('abort', onAbort, { once: true });
    function done(fn: () => void) {
      offs.forEach((o) => o());
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
      fn();
    }
  });
}

function conn(): PreviewConnection {
  const c = previews.get(PRIMARY);
  if (!c) throw new Error('No preview is connected. Open a project first.');
  return c;
}

/** Wait until the primary preview is connected and ready. */
export async function ensurePreview(signal?: AbortSignal, timeout = 20_000): Promise<void> {
  if (!studio().project) throw new Error('Open a project first.');
  const ok = await waitUntil(() => Boolean(previews.get(PRIMARY)?.ready && studio().instances[PRIMARY]?.status === 'ready'), timeout, signal, 100);
  if (!ok) {
    const inst = studio().instances[PRIMARY];
    throw new Error(inst?.error ?? `The preview is ${inst?.status ?? 'not mounted'}. Show the canvas and wait for it to load.`);
  }
}

/** Wait until the agent reports the viewport the simulator is set to. */
async function viewportSettled(signal: AbortSignal | undefined, timeout = 6000): Promise<boolean> {
  const ok = await waitUntil(
    () => {
      const s = studio();
      if (s.transition.playing) return false;
      const exp = currentViewportContext();
      const vp = s.instances[PRIMARY]?.viewport;
      return Boolean(vp && Math.abs(vp.width - exp.width) <= 1 && Math.abs(vp.height - exp.height) <= 1);
    },
    timeout,
    signal,
  );
  // Give resize handlers and layout a moment to settle.
  await sleep(120, signal);
  return ok;
}

export async function applyViewport(v: ViewportState, signal?: AbortSignal): Promise<boolean> {
  const s = studio();
  const dev = s.allDevices().find((d) => d.id === v.deviceId);
  if (!dev) throw new Error(`Unknown device “${v.deviceId}”.`);
  const target: ViewportState = { deviceId: v.deviceId, orientation: v.orientation, posture: canFold(dev) ? v.posture : 'folded' };
  const cur = s.viewport;
  const midTransition = s.transition.playing || (s.transition.progress > 0 && s.transition.progress < 1);
  if (cur.deviceId !== target.deviceId || cur.orientation !== target.orientation || cur.posture !== target.posture || midTransition) s.setViewport(target);
  return viewportSettled(signal, 8000);
}

/** Fresh page load at `route` so in-memory app state starts clean. */
async function resetPage(route: string | undefined, signal: AbortSignal | undefined) {
  const c = conn();
  if (route && !route.startsWith('#') && !/^https?:/.test(route)) {
    const hello = nextEvent(c, ['hello'], 20_000, signal);
    c.tell('nav.go', { url: route });
    await hello;
  } else {
    if (route) {
      await withAbort(c.call('nav.go', { url: route }, 4000), signal).catch((e) => {
        if (e instanceof RunAborted) throw e;
      });
      await sleep(60, signal);
    }
    const hello = nextEvent(c, ['hello'], 20_000, signal);
    c.tell('nav.reload');
    await hello;
  }
  await waitUntil(() => studio().instances[PRIMARY]?.status === 'ready', 5000, signal);
  await sleep(150, signal);
}

/* ------------------------------------------------------------------ */
/* Pause / abort                                                       */
/* ------------------------------------------------------------------ */

let pendingDecision: ((d: PauseDecision) => void) | null = null;

function waitDecision(runId: string, scenarioId: string, stepIndex: number, error: string, signal?: AbortSignal): Promise<PauseDecision> {
  return new Promise<PauseDecision>((resolve) => {
    pendingDecision = resolve;
    useRunner.setState({ paused: { runId, scenarioId, stepIndex, error } });
    signal?.addEventListener('abort', () => resolve('stop'), { once: true });
  }).finally(() => {
    pendingDecision = null;
    useRunner.setState({ paused: null });
  });
}

/** Answer a pause-at-failure prompt. */
export function resolvePause(d: PauseDecision) {
  pendingDecision?.(d);
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

type RunCtx = { signal?: AbortSignal; used: Record<string, string>; hellos: number };

async function executeStep(step: TestStep, ctx: RunCtx): Promise<StepResult> {
  const t0 = performance.now();
  const elapsed = () => Math.round(performance.now() - t0);
  const ok = (extra: Partial<StepResult> = {}): StepResult => ({ stepId: step.id, status: 'passed', durationMs: elapsed(), ...extra });
  const fail = (error: string, extra: Partial<StepResult> = {}): StepResult => ({ stepId: step.id, status: 'failed', error: redactSecrets(error, ctx.used), durationMs: elapsed(), ...extra });
  const a = step.action;
  const { signal } = ctx;

  switch (a.type) {
    case 'viewport': {
      const dev = studio().allDevices().find((d) => d.id === a.state.deviceId);
      if (!dev) return fail(`Unknown device “${a.state.deviceId}”.`);
      const settled = await applyViewport(a.state, signal);
      const now = currentViewportContext();
      return settled ? ok() : fail(`The preview did not report ${now.width}×${now.height} within ${Math.round(step.timeout / 1000)} s.`);
    }
    case 'fold': {
      const dev = studio().device();
      if (!canFold(dev)) return { stepId: step.id, status: 'skipped', error: `Not applicable: ${dev.name} has a single posture.`, durationMs: 0 };
      const s = studio();
      if (s.viewport.posture !== a.posture || s.transition.playing) {
        s.foldTo(a.posture);
        const landed = await waitUntil(() => !studio().transition.playing && studio().viewport.posture === a.posture, studio().transition.duration + step.timeout, signal);
        if (!landed) return fail(`The ${a.posture === 'expanded' ? 'unfold' : 'fold'} transition did not finish in time.`);
      }
      const settled = await viewportSettled(signal, 5000);
      return settled ? ok() : fail('The preview did not report the new viewport after the posture change.');
    }
    case 'navigate': {
      const c = conn();
      const isHash = a.url.startsWith('#');
      const cur = studio().instances[PRIMARY]?.url ?? '';
      if (isHash && cur.endsWith(a.url)) return ok();
      const evt = nextEvent(c, isHash ? ['navigation', 'hello'] : ['hello'], step.timeout + (isHash ? 0 : 10_000), signal);
      c.tell('nav.go', { url: a.url });
      try {
        await evt;
      } catch (e) {
        if (e instanceof RunAborted) throw e;
        return fail((e as Error).message);
      }
      return ok();
    }
    case 'screenshot': {
      try {
        const shot = await withAbort(conn().call('capture.raster', { scale: 1, maxWidth: 480 }, 25_000), signal);
        return ok({ screenshot: shot.dataUrl });
      } catch (e) {
        if (e instanceof RunAborted) throw e;
        return fail(`Screenshot failed: ${(e as Error).message}`);
      }
    }
    default: {
      const { action, missing, used } = resolveActionSecrets(a, studio().settings.fixtures);
      Object.assign(ctx.used, used);
      if (missing.length) {
        return fail(`Missing fixture ${missing.map((m) => `“${m}”`).join(', ')}. Add synthetic values under Settings → Fixtures; masked values are never stored with the scenario.`);
      }
      for (let attempt = 0; ; attempt++) {
        const hellosBefore = ctx.hellos;
        try {
          const res = await withAbort(conn().call('replay.step', { action, timeout: step.timeout }, step.timeout + 6000), signal);
          return res.ok ? ok({ usedLocator: res.usedLocator }) : fail(res.error ?? 'Step failed', { usedLocator: res.usedLocator });
        } catch (e) {
          if (e instanceof RunAborted) throw e;
          // The page may have reloaded mid-step (e.g. a link to a new document).
          const reloaded = ctx.hellos > hellosBefore || (await waitUntil(() => ctx.hellos > hellosBefore, 3000, signal));
          if (reloaded && /^(click|press|check|select)$/.test(a.type)) return ok({ usedLocator: 'navigation' });
          if (reloaded && attempt === 0) {
            await sleep(250, signal);
            continue;
          }
          return fail((e as Error).message);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

function collectConsoleErrors(since: number, used: Record<string, string>): string[] {
  const out = new Set<string>();
  for (const c of studio().console) {
    if (c.instanceId !== PRIMARY || c.level !== 'error' || c.timestamp < since) continue;
    const text = redactSecrets(c.args.join(' '), used).slice(0, 500);
    out.add(c.count > 1 ? `${text} (×${c.count})` : text);
  }
  return [...out].slice(0, 50);
}

async function auditEndState(signal?: AbortSignal): Promise<(ResponsiveIssue | A11yIssue)[]> {
  const c = conn();
  const s = studio().settings;
  const viewport = currentViewportContext();
  const fold = currentFold();
  const [responsive, a11y] = await Promise.all([
    withAbort(
      c.call(
        'audit.responsive',
        {
          viewport,
          fold: fold ? { axis: fold.axis, offset: fold.offset, maskLength: fold.maskLength, kind: fold.kind } : null,
          minTapSize: s.minTapSize,
          minFontSize: s.minFontSize,
          maxLineLength: s.maxLineLength,
          ignoreSelectors: s.ignoreSelectors,
        },
        20_000,
      ),
      signal,
    ).catch((e) => {
      if (e instanceof RunAborted) throw e;
      return [] as ResponsiveIssue[];
    }),
    withAbort(c.call('audit.a11y', { viewport }, 30_000), signal).catch((e) => {
      if (e instanceof RunAborted) throw e;
      return [] as A11yIssue[];
    }),
  ]);
  return [...responsive, ...a11y];
}

/** Run one scenario on the primary preview. Never throws for step failures; returns the final run. */
export async function runScenario(scenario: Scenario, opts: RunOptions = {}): Promise<ScenarioRun> {
  const { signal } = opts;
  const s0 = studio();
  if (s0.recording.active) throw new Error('Stop the recording before replaying.');
  const prevViewport = { ...s0.viewport };
  const prevInteraction = s0.interaction;
  const manageInteraction = opts.manageInteraction ?? true;
  const startAt = Math.max(0, Math.min(scenario.steps.length, opts.startAt ?? 0));
  const reset = opts.reset ?? startAt === 0;
  const startedAt = Date.now();
  const results: StepResult[] = scenario.steps.map((st) => ({ stepId: st.id, status: 'skipped', durationMs: 0 }));
  const initialCtx = (opts.viewport && contextFor(opts.viewport, s0.allDevices())) || currentViewportContext();
  let run: ScenarioRun = {
    id: newId('run'),
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    viewport: initialCtx,
    startedAt,
    status: 'running',
    steps: results,
    issues: [],
    consoleErrors: [],
  };
  const publish = (patch: Partial<ScenarioRun> = {}) => {
    run = { ...run, ...patch, steps: [...results] };
    studio().upsertRun(run);
  };
  const ctx: RunCtx = { signal, used: {}, hellos: 0 };
  const setStep = (i: number) =>
    useRunner.setState((st) => (st.active?.current ? { active: { ...st.active, current: { ...st.active.current, runId: run.id, stepIndex: i, stepCount: scenario.steps.length } } } : st));
  publish();

  let offHello: (() => void) | null = null;
  let aborted = false;
  let infraError: string | null = null;
  try {
    await ensurePreview(signal);
    offHello = conn().on('hello', () => {
      ctx.hellos += 1;
    });
    if (manageInteraction && studio().interaction !== 'interact') studio().setInteraction('interact');
    if (opts.viewport) await applyViewport(opts.viewport, signal);
    publish({ viewport: currentViewportContext() });
    if (reset) await resetPage(scenario.route, signal);

    for (let i = startAt; i < scenario.steps.length; i++) {
      if (signal?.aborted) throw new RunAborted();
      const step = scenario.steps[i];
      setStep(i);
      const res = await executeStep(step, ctx);
      results[i] = res;
      publish();
      if (res.status !== 'failed') continue;
      if (!results.some((r, j) => j !== i && r.screenshot && r.status === 'failed')) {
        try {
          const shot = await withAbort(conn().call('capture.raster', { scale: 1, maxWidth: 480 }, 20_000), signal);
          results[i] = { ...results[i], screenshot: results[i].screenshot ?? shot.dataUrl };
          publish();
        } catch (e) {
          if (e instanceof RunAborted) throw e;
        }
      }
      if (opts.pauseOnFailure) {
        const d = await waitDecision(run.id, scenario.id, i, res.error ?? 'Step failed', signal);
        if (signal?.aborted) throw new RunAborted();
        if (d === 'retry') {
          i -= 1;
          continue;
        }
        if (d === 'stop') break;
        continue;
      }
      if (!isSoftStep(step.action)) break;
    }

    if (opts.audits) publish({ issues: await auditEndState(signal) });
    if (opts.captureFinal ?? true) {
      try {
        const shot = await withAbort(conn().call('capture.raster', { scale: 1, maxWidth: 480 }, 20_000), signal);
        publish({ finalScreenshot: shot.dataUrl });
      } catch (e) {
        if (e instanceof RunAborted) throw e;
      }
    }
  } catch (e) {
    if (e instanceof RunAborted) aborted = true;
    else infraError = redactSecrets((e as Error).message, ctx.used);
  } finally {
    offHello?.();
    const failed = results.some((r) => r.status === 'failed');
    if (infraError) {
      // Attribute infrastructure failures to the step that was running (or the first one).
      const idx = Math.max(startAt, results.findIndex((r, j) => j >= startAt && r.status === 'skipped'));
      if (results[idx]) results[idx] = { ...results[idx], status: 'failed', error: infraError };
    }
    publish({
      finishedAt: Date.now(),
      status: infraError || failed ? 'failed' : aborted ? 'aborted' : 'passed',
      consoleErrors: collectConsoleErrors(startedAt, ctx.used),
    });
    if (manageInteraction && studio().interaction !== prevInteraction) studio().setInteraction(prevInteraction);
    if (opts.restoreViewport ?? true) {
      const cur = studio().viewport;
      if (cur.deviceId !== prevViewport.deviceId || cur.posture !== prevViewport.posture || cur.orientation !== prevViewport.orientation) studio().setViewport(prevViewport);
    }
  }
  return run;
}

/* ------------------------------------------------------------------ */
/* Batches (single runs, suites, device matrices)                      */
/* ------------------------------------------------------------------ */

let controller: AbortController | null = null;

export const isRunning = () => Boolean(useRunner.getState().active);

export type BatchOptions = {
  label?: string;
  /** Viewports to run on sequentially. Empty / omitted = the current device as it is. */
  matrix?: ViewportState[];
  audits?: boolean;
  pauseOnFailure?: boolean;
  startAt?: number;
  reset?: boolean;
};

/**
 * Run scenarios sequentially, viewport-major (fewer device switches), restoring
 * the user's viewport and interaction mode at the end.
 */
export async function runBatch(scenarios: Scenario[], opts: BatchOptions = {}): Promise<ScenarioRun[]> {
  if (isRunning()) throw new Error('A run is already in progress.');
  if (studio().recording.active) throw new Error('Stop the recording before replaying.');
  if (!scenarios.length) return [];
  const s0 = studio();
  const devices = s0.allDevices();
  const matrix = (opts.matrix ?? []).filter((v) => devices.some((d) => d.id === v.deviceId));
  const entries: (ViewportState | undefined)[] = matrix.length ? matrix : [undefined];
  const prevViewport = { ...s0.viewport };
  const prevInteraction = s0.interaction;
  controller = new AbortController();
  const { signal } = controller;
  const batchId = newId('batch');
  const label = opts.label ?? (scenarios.length === 1 ? scenarios[0].name : `${scenarios.length} scenarios`);
  useRunner.setState({ active: { id: batchId, label, startedAt: Date.now(), total: scenarios.length * entries.length, done: 0, failed: 0, current: null }, follow: true });
  const out: ScenarioRun[] = [];
  try {
    await ensurePreview(signal, 10_000);
    if (studio().interaction !== 'interact') studio().setInteraction('interact');
    outer: for (const vp of entries) {
      for (const sc of scenarios) {
        if (signal.aborted) break outer;
        const ctxLabel = vp ? viewportLabel(contextFor(vp, devices) ?? currentViewportContext(), devices) : viewportLabel(currentViewportContext(), devices);
        useRunner.setState((st) => (st.active ? { active: { ...st.active, current: { scenarioId: sc.id, scenarioName: sc.name, runId: null, viewportLabel: ctxLabel, stepIndex: opts.startAt ?? 0, stepCount: sc.steps.length } } } : st));
        const r = await runScenario(sc, {
          viewport: vp,
          signal,
          audits: opts.audits,
          pauseOnFailure: opts.pauseOnFailure,
          startAt: opts.startAt,
          reset: opts.reset,
          restoreViewport: false,
          manageInteraction: false,
        });
        out.push(r);
        useRunner.setState((st) => {
          if (!st.active) return st;
          const followPatch = st.follow && st.subject?.kind === 'scenario' ? { subject: { kind: 'scenario' as const, scenarioId: sc.id, runId: r.id } } : {};
          return { ...followPatch, active: { ...st.active, done: st.active.done + 1, failed: st.active.failed + (r.status === 'failed' ? 1 : 0) } };
        });
        if (r.status === 'aborted') break outer;
      }
    }
  } finally {
    const aborted = signal.aborted;
    controller = null;
    if (studio().interaction !== prevInteraction) studio().setInteraction(prevInteraction);
    const cur = studio().viewport;
    if (matrix.length && (cur.deviceId !== prevViewport.deviceId || cur.posture !== prevViewport.posture || cur.orientation !== prevViewport.orientation)) studio().setViewport(prevViewport);
    const a = useRunner.getState().active;
    useRunner.setState({
      active: null,
      lastBatch: { id: batchId, label, startedAt: a?.startedAt ?? Date.now(), finishedAt: Date.now(), matrix, scenarioIds: scenarios.map((x) => x.id), runIds: out.map((r) => r.id), aborted },
    });
  }
  return out;
}

/** Abort the active batch (and any pause prompt). */
export function stopRuns() {
  controller?.abort();
  resolvePause('stop');
}
