import { create } from 'zustand';
import { studio } from '@/store';
import { sweepWidths } from './profiles';
import { withWorker } from './worker';
import type { SweepPoint } from './sweep-math';

export { overflowZones, type SweepPoint } from './sweep-math';

export type SweepResult = {
  key: string;
  selector: string;
  route: string;
  points: SweepPoint[];
  devices: { width: number; name: string }[];
  status: 'running' | 'done' | 'error' | 'cancelled';
  error?: string;
  total: number;
  at: number;
  height: number;
};

type SweepState = { results: Record<string, SweepResult>; running: string | null };
export const useSweeps = create<SweepState>(() => ({ results: {}, running: null }));

export const sweepKey = (selector: string, route: string, changeCount: number) => `${route}\u0000${selector}\u0000${changeCount}`;

let cancelFlag = false;
export function cancelSweep() {
  cancelFlag = true;
}

/**
 * Measure `selector` in the hidden background preview at every width from
 * 320 to 1600 (40px grid + every device-profile width). Points stream into
 * the store so the chart fills in progressively.
 */
export async function runSweep(selector: string, opts: { height?: number } = {}): Promise<SweepResult> {
  const s = studio();
  const key = sweepKey(selector, s.currentRoute, s.changes.length);
  const { widths, devices } = sweepWidths();
  const height = opts.height ?? 900;
  const base: SweepResult = { key, selector, route: s.currentRoute, points: [], devices, status: 'running', total: widths.length, at: Date.now(), height };
  const put = (patch: Partial<SweepResult>) => useSweeps.setState((st) => ({ results: { ...st.results, [key]: { ...(st.results[key] ?? base), ...patch } } }));
  put(base);
  useSweeps.setState({ running: key });
  cancelFlag = false;
  try {
    await withWorker('Responsive sweep', async (w) => {
      const points: SweepPoint[] = [];
      for (const vw of widths) {
        if (cancelFlag) break;
        await w.resize(vw, height);
        const entries = await w.call('layout.snapshot', { selectors: [selector] }, 8000).catch(() => []);
        const e = entries.find((x) => x.selector === selector) ?? entries[0];
        points.push(
          e
            ? { vw, present: true, visible: e.visible, x: e.rect.x, width: e.rect.width, right: e.rect.x + e.rect.width, height: e.rect.height }
            : { vw, present: false, visible: false, x: 0, width: 0, right: 0, height: 0 },
        );
        put({ points: [...points] });
      }
    });
    const status = cancelFlag ? 'cancelled' : 'done';
    put({ status, at: Date.now() });
  } catch (err) {
    put({ status: 'error', error: err instanceof Error ? err.message : String(err) });
  } finally {
    useSweeps.setState({ running: null });
  }
  return useSweeps.getState().results[key];
}
