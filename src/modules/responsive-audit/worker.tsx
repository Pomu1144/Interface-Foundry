import type { AgentMethod, AgentMethods } from '@shared/protocol';
import { create } from 'zustand';
import { studio, useStudio } from '@/store';
import { PreviewFrame } from '@/modules/preview-runtime/PreviewFrame';
import { previews } from '@/modules/preview-runtime/registry';
import { currentPatchSet } from '@/modules/preview-runtime/sync';
import type { PreviewConnection } from '@/modules/preview-runtime/connection';
import { sourceUrl } from '@/modules/project-adapter/source';

/**
 * Hidden background preview used to audit, measure and capture the page at
 * viewports other than the one on the canvas, without disturbing the user's
 * preview (focus, typed input, scroll). One job runs at a time; the frame is
 * mounted on demand and unmounted after a quiet period.
 */

export const WORKER_ID = 'audit-worker';
const IDLE_UNMOUNT_MS = 45_000;

type WorkerUi = { active: boolean; width: number; height: number; busy: string | null };
export const useAuditWorker = create<WorkerUi>(() => ({ active: false, width: 1024, height: 900, busy: null }));

export function workerSupport(): { ok: true } | { ok: false; reason: string } {
  const src = studio().source;
  if (!src) return { ok: false, reason: 'Open a project first.' };
  if (src.kind === 'url')
    return { ok: false, reason: 'Other viewports need a page served through IFDY (demo, imported project or local dev server). Embedded and remote URLs cannot host a background preview.' };
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Connection tracking                                                 */
/* ------------------------------------------------------------------ */

let hooked: PreviewConnection | null = null;
let helloSeq = 0;
let patchedSeq = -1;
const waiters = new Set<() => void>();
const notify = () => waiters.forEach((w) => w());

function hook() {
  const conn = previews.get(WORKER_ID) ?? null;
  if (conn === hooked) return;
  hooked = conn;
  patchedSeq = -1;
  if (!conn) return notify();
  conn.on('hello', async () => {
    const seq = ++helloSeq;
    try {
      // wire.ts does not re-apply state to workers: apply the current edits ourselves.
      await conn.call('patch.apply', currentPatchSet());
      await conn.call('env.set', { fontScale: studio().fontScale, freezeAnimations: true });
    } catch {
      /* navigating again; the next hello retries */
    }
    if (seq === helloSeq) patchedSeq = seq;
    notify();
  });
  conn.on('viewport', notify);
}

let started = false;
/** Wire worker bookkeeping once at startup. */
export function startAuditWorker() {
  if (started) return;
  started = true;
  previews.subscribe(hook);
  // Keep edits in sync while the worker is alive (sync.ts skips workers on purpose).
  const push = () => {
    const c = previews.get(WORKER_ID);
    if (c?.ready) c.tell('patch.apply', currentPatchSet());
  };
  useStudio.subscribe((s) => s.changes, push);
  useStudio.subscribe((s) => s.tokens, push);
}

function isReady() {
  const c = previews.get(WORKER_ID);
  return Boolean(c?.ready && patchedSeq === helloSeq && studio().instances[WORKER_ID]?.status === 'ready');
}

function waitUntil(test: () => boolean, timeoutMs: number, what: string): Promise<void> {
  if (test()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (test()) {
        cleanup();
        resolve();
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      const err = studio().instances[WORKER_ID]?.error;
      reject(new Error(err ?? `Background preview did not ${what} within ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);
    const poll = setInterval(check, 120);
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(poll);
      waiters.delete(check);
    };
    waiters.add(check);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

export type WorkerHandle = {
  /** Resize the hidden preview and wait until the page has re-laid out. */
  resize(width: number, height: number): Promise<void>;
  call<M extends AgentMethod>(method: M, params?: AgentMethods[M][0], timeoutMs?: number): Promise<AgentMethods[M][1]>;
};

let users = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let chain: Promise<unknown> = Promise.resolve();

const handle: WorkerHandle = {
  async resize(width, height) {
    width = Math.round(width);
    height = Math.round(height);
    const st = useAuditWorker.getState();
    const conn = previews.get(WORKER_ID);
    if (!conn) throw new Error('Background preview is not mounted.');
    if (st.width !== width || st.height !== height) {
      const seen = new Promise<boolean>((resolve) => {
        const off = conn.on('viewport', (v) => {
          if (v.width === width && v.height === height) {
            off();
            resolve(true);
          }
        });
        setTimeout(() => {
          off();
          resolve(false);
        }, 1500);
      });
      useAuditWorker.setState({ width, height });
      await seen;
    }
    await waitUntil(isReady, 15_000, 'become ready');
    // Verify the layout width (allowing for a classic scrollbar) and let resize handlers settle.
    for (let attempt = 0; attempt < 6; attempt++) {
      await sleep(attempt === 0 ? 60 : 200);
      const [html] = await conn.call('layout.snapshot', { selectors: ['html'] }, 5000).catch(() => []);
      if (!html || Math.abs(html.rect.width - width) <= 20) return;
    }
    throw new Error(`Background preview did not resize to ${width}px.`);
  },
  call(method, params, timeoutMs) {
    const conn = previews.get(WORKER_ID);
    if (!conn?.ready) return Promise.reject(new Error('Background preview is not connected.'));
    return conn.call(method, params, timeoutMs);
  },
};

/** Run `fn` with exclusive use of the background preview (queued FIFO). */
export function withWorker<T>(label: string, fn: (w: WorkerHandle) => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const sup = workerSupport();
    if (!sup.ok) throw new Error(sup.reason);
    users++;
    if (idleTimer) clearTimeout(idleTimer);
    useAuditWorker.setState({ active: true, busy: label });
    try {
      await waitUntil(() => Boolean(previews.get(WORKER_ID)), 5000, 'mount');
      // Follow the canvas route: the frame navigates when the route changes.
      await waitUntil(isReady, 20_000, 'load');
      return await fn(handle);
    } finally {
      users--;
      useAuditWorker.setState({ busy: null });
      if (!users) idleTimer = setTimeout(() => useAuditWorker.setState({ active: false }), IDLE_UNMOUNT_MS);
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

/* ------------------------------------------------------------------ */
/* Host                                                                */
/* ------------------------------------------------------------------ */

/**
 * Renders the hidden frame. It stays inside the window (opacity 0, behind the
 * studio, inert) because browsers throttle layout events in off-screen frames.
 */
export function AuditWorkerHost() {
  const active = useAuditWorker((s) => s.active);
  const width = useAuditWorker((s) => s.width);
  const height = useAuditWorker((s) => s.height);
  const source = useStudio((s) => s.source);
  const route = useStudio((s) => s.currentRoute);
  const colorScheme = useStudio((s) => s.colorScheme);
  if (!active || !source || source.kind === 'url') return null;
  return (
    <div
      aria-hidden
      inert
      data-ifdy-worker-host=""
      style={{ position: 'fixed', left: 0, top: 0, width, height, opacity: 0, pointerEvents: 'none', zIndex: -1, overflow: 'hidden' }}
    >
      <PreviewFrame instanceId={WORKER_ID} role="worker" src={sourceUrl(source, route)} width={width} height={height} colorScheme={colorScheme} interactive={false} title="IFDY background preview" />
    </div>
  );
}
