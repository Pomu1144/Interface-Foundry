import { useEffect, useRef, useState } from 'react';
import type { Rect } from '@shared/types';
import type { CaptureRef } from '@/store';
import { getLayout, type CaptureLayout } from '@/modules/screenshots/layouts';
import type { DiffRequest, DiffResponse } from './diff.worker';
import { structuralDiff, type StructuralRow, type StructuralSummary } from './structural';

/* ------------------------------------------------------------------ */
/* Pixel diff (Web Worker)                                             */
/* ------------------------------------------------------------------ */

const CRASHED = 'The diff worker stopped unexpectedly.';
let worker: Worker | null = null;
let reqSeq = 0;
const pending = new Map<number, (r: DiffResponse) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./diff.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<DiffResponse>) => {
      pending.get(e.data.id)?.(e.data);
      pending.delete(e.data.id);
    };
    worker.onerror = (e) => {
      for (const [id, done] of pending) done({ id, ok: false, error: e.message || CRASHED });
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

const blobCache = new Map<string, Promise<Blob>>();
function blobFor(c: CaptureRef): Promise<Blob> {
  let p = blobCache.get(c.id);
  if (!p) {
    p = fetch(c.dataUrl).then((r) => r.blob());
    blobCache.set(c.id, p);
  }
  return p;
}

export const captureScale = (c: CaptureRef) => (c.viewport.width ? c.width / c.viewport.width : 1);

export type PixelDiff = Extract<DiffResponse, { ok: true }> & { canvas: HTMLCanvasElement; dataUrl: () => string };

export async function computePixelDiff(a: CaptureRef, b: CaptureRef, threshold: number, ignore: Rect[]): Promise<PixelDiff> {
  const [ba, bb] = await Promise.all([blobFor(a), blobFor(b)]);
  const id = ++reqSeq;
  const req: DiffRequest = { id, a: ba, b: bb, scaleA: captureScale(a), scaleB: captureScale(b), threshold, ignore };
  const send = (rid: number) =>
    new Promise<DiffResponse>((resolve) => {
      pending.set(rid, resolve);
      getWorker().postMessage({ ...req, id: rid });
    });
  let res = await send(id);
  // A worker that failed to start (e.g. a dev-server dependency reload) is recreated once.
  if (!res.ok && res.error === CRASHED) res = await send(++reqSeq);
  if (!res.ok) throw new Error(res.error);
  const canvas = document.createElement('canvas');
  canvas.width = res.width;
  canvas.height = res.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(res.rgba), res.width, res.height), 0, 0);
  return { ...res, canvas, dataUrl: () => canvas.toDataURL('image/png') };
}

export function usePixelDiff(a: CaptureRef | null, b: CaptureRef | null, threshold: number, ignore: Rect[], enabled: boolean) {
  const [state, setState] = useState<{ diff: PixelDiff | null; loading: boolean; error: string | null; key: string }>({ diff: null, loading: false, error: null, key: '' });
  const key = a && b ? `${a.id}|${b.id}|${threshold}|${JSON.stringify(ignore)}` : '';
  const latest = useRef(key);
  useEffect(() => {
    latest.current = key;
    if (!enabled || !a || !b) return;
    if (state.key === key && (state.diff || state.error)) return;
    setState((st) => ({ ...st, loading: true, error: null }));
    const t = setTimeout(() => {
      computePixelDiff(a, b, threshold, ignore)
        .then((diff) => latest.current === key && setState({ diff, loading: false, error: null, key }))
        .catch((err: Error) => latest.current === key && setState({ diff: null, loading: false, error: err.message, key }));
    }, 120);
    return () => clearTimeout(t);
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

/* ------------------------------------------------------------------ */
/* Structural diff                                                     */
/* ------------------------------------------------------------------ */

export type StructuralState = { rows: StructuralRow[]; summary: StructuralSummary; layoutA: CaptureLayout; layoutB: CaptureLayout } | null;

export function pairNames(a: CaptureRef, b: CaptureRef): [string, string] {
  if (a.viewport.deviceId === b.viewport.deviceId && a.viewport.posture !== b.viewport.posture) return [a.viewport.posture, b.viewport.posture];
  if (a.viewport.deviceId !== b.viewport.deviceId) return [a.viewport.deviceName, b.viewport.deviceName];
  return ['A', 'B'];
}

export function useStructural(a: CaptureRef | null, b: CaptureRef | null, minTapSize: number) {
  const [state, setState] = useState<{ data: StructuralState; loading: boolean; missing: boolean }>({ data: null, loading: false, missing: false });
  useEffect(() => {
    if (!a || !b) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    Promise.all([getLayout(a.id), getLayout(b.id)]).then(([la, lb]) => {
      if (!alive) return;
      if (!la || !lb || !la.entries.length || !lb.entries.length) {
        setState({ data: null, loading: false, missing: true });
        return;
      }
      const res = structuralDiff(
        { entries: la.entries, viewport: la.viewport, fold: la.fold, scroll: la.scroll },
        { entries: lb.entries, viewport: lb.viewport, fold: lb.fold, scroll: lb.scroll },
        { minTapSize, names: pairNames(a, b) },
      );
      setState({ data: { ...res, layoutA: la, layoutB: lb }, loading: false, missing: false });
    });
    return () => {
      alive = false;
    };
  }, [a?.id, b?.id, minTapSize]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
