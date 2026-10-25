import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { StepAction, TestStep } from '@shared/types';
import { bus } from '@/lib/events';
import { previews } from '@/modules/preview-runtime/registry';
import { useWall } from './state';

/** Short-lived "replayed: Click Sign in" feedback per follower tile. */
type Feedback = { text: string; ok: boolean; at: number };
export const useMirrorFeedback = create<{ map: Record<string, Feedback>; push: (id: string, f: Feedback) => void; clear: () => void }>()((set) => ({
  map: {},
  push: (id, f) => set((s) => ({ map: { ...s.map, [id]: f } })),
  clear: () => set({ map: {} }),
}));

/** Steps that make sense to mirror live (assertions/screenshots/device changes do not). */
export function mirrorable(a: StepAction): boolean {
  return a.type === 'click' || a.type === 'fill' || a.type === 'press' || a.type === 'focus' || a.type === 'select' || a.type === 'check' || a.type === 'navigate' || a.type === 'wait';
}

/**
 * Mirrors scrolling and interactions from the tile being used (the leader) to
 * every other tile:
 *  - scroll: the agent's `scroll` events (as ratios) -> `scroll.set` on followers;
 *  - interactions: the agent recorder on the leader (`record.start`) -> each step
 *    is replayed on followers with `replay.step`. Nothing is written to the
 *    studio's own recording; sensitive fields are never mirrored.
 */
export function useMirroring(tileIds: string[]) {
  const ids = useRef(new Set<string>());
  ids.current = new Set(tileIds);
  const mirrorScroll = useWall((s) => s.mirrorScroll);
  const mirrorInput = useWall((s) => s.mirrorInput);
  const leader = useWall((s) => s.leader);

  // Scroll mirroring.
  useEffect(() => {
    if (!mirrorScroll) return;
    const suppressUntil = new Map<string, number>();
    let pending: { x: number; y: number; from: string } | null = null;
    let raf = 0;
    const flush = () => {
      raf = 0;
      const p = pending;
      pending = null;
      if (!p) return;
      for (const id of ids.current) {
        if (id === p.from) continue;
        const c = previews.get(id);
        if (!c?.ready) continue;
        suppressUntil.set(id, performance.now() + 450);
        c.tell('scroll.set', { x: p.x, y: p.y, ratio: true });
      }
    };
    const off = bus.on('agent-scroll', (sc) => {
      if (!ids.current.has(sc.instanceId)) return;
      if ((suppressUntil.get(sc.instanceId) ?? 0) > performance.now()) return;
      const lead = useWall.getState().leader;
      if (lead && lead !== sc.instanceId && ids.current.has(lead)) return;
      if (!lead || !ids.current.has(lead)) useWall.getState().setLeader(sc.instanceId);
      pending = { x: Number.isFinite(sc.ratioX) ? sc.ratioX : 0, y: Number.isFinite(sc.ratioY) ? sc.ratioY : 0, from: sc.instanceId };
      if (!raf) raf = requestAnimationFrame(flush);
    });
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, [mirrorScroll]);

  // Interaction mirroring.
  useEffect(() => {
    if (!mirrorInput || !leader) return;
    const chains = new Map<string, Promise<unknown>>();
    let offStep: (() => void) | null = null;
    let warnedMasked = false;
    const push = useMirrorFeedback.getState().push;

    const replay = (step: TestStep) => {
      const a = step.action;
      if (!mirrorable(a)) return;
      const followers = [...ids.current].filter((id) => id !== leader);
      if (a.type === 'fill' && a.masked) {
        if (!warnedMasked) followers.forEach((id) => push(id, { text: 'Sensitive field — not mirrored', ok: false, at: Date.now() }));
        warnedMasked = true;
        return;
      }
      for (const id of followers) {
        const c = previews.get(id);
        if (!c?.ready) continue;
        const prev = chains.get(id) ?? Promise.resolve();
        const next = prev
          .then(() => c.call('replay.step', { action: a, timeout: a.type === 'wait' ? 4000 : 2500 }, 9000))
          .then((r) => push(id, { text: r.ok ? step.description : `${step.description} — ${r.error ?? 'failed'}`, ok: r.ok, at: Date.now() }))
          .catch((err: Error) => push(id, { text: `${step.description} — ${err.message}`, ok: false, at: Date.now() }));
        chains.set(id, next);
      }
    };

    const start = () => {
      const conn = previews.get(leader);
      if (!conn?.ready) return;
      offStep?.();
      offStep = conn.on('record.step', ({ step }) => replay(step));
      conn.tell('record.start', { maskAllInputs: false });
    };
    start();
    const offHello = bus.on('preview-hello', ({ instanceId }) => {
      if (instanceId === leader) start();
    });
    return () => {
      offHello();
      const conn = previews.get(leader);
      conn?.tell('record.stop');
      // Let a pending fill flushed by record.stop arrive before unsubscribing.
      const off = offStep;
      setTimeout(() => off?.(), 700);
    };
  }, [mirrorInput, leader]);
}
