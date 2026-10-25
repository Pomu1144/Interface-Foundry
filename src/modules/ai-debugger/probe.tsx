import { createRoot } from 'react-dom/client';
import type { FoldGeometry, NodeInfo, PatchSet, ResponsiveIssue, StylesPayload, ViewportContext, ViewportState } from '@shared/types';
import { studio, useStudio } from '@/store';
import { PreviewFrame } from '@/modules/preview-runtime/PreviewFrame';
import { previews } from '@/modules/preview-runtime/registry';
import { currentPatchSet } from '@/modules/preview-runtime/sync';
import { RESPONSIVE_ID, responsiveDevice } from '@/modules/device-simulator/devices';
import { foldInViewport, resolveViewport, viewportContext } from '@/modules/device-simulator/viewport';
import type { PreviewConnection } from '@/modules/preview-runtime/connection';

/**
 * Measure the current page at another viewport (usually the other posture)
 * without touching the user's canvas: a hidden worker preview loads the same
 * URL, gets the requested patch sets applied in turn, and runs the responsive
 * audit (and optionally inspects one element) for each.
 */

export type ProbeSample = { issues: ResponsiveIssue[]; info: NodeInfo | null; styles: StylesPayload | null };
export type ProbeResult = { viewport: ViewportContext; fold: FoldGeometry | null; samples: ProbeSample[]; method: 'compare-preview' | 'worker-probe' };

let seq = 0;

export function otherViewportState(): { state: ViewportState; label: string } {
  const s = studio();
  const d = s.device();
  if (d.expanded) {
    const posture = s.viewport.posture === 'expanded' ? 'folded' : 'expanded';
    return { state: { deviceId: d.id, posture, orientation: s.viewport.orientation }, label: posture === 'expanded' ? 'expanded' : 'folded' };
  }
  if (s.compare.enabled) return { state: s.compare.partner, label: 'compare viewport' };
  return { state: { deviceId: d.category === 'desktop' ? 'iphone-16-pro' : 'desktop-1440', posture: 'folded', orientation: 'portrait' }, label: d.category === 'desktop' ? 'phone' : 'desktop' };
}

export function resolveState(state: ViewportState) {
  const s = studio();
  const device = state.deviceId === RESPONSIVE_ID ? responsiveDevice(s.responsiveSize) : s.allDevices().find((d) => d.id === state.deviceId) ?? s.device();
  const resolved = resolveViewport(device, state.posture, state.orientation);
  return { device, viewport: viewportContext(device, state.posture, state.orientation), fold: foldInViewport(resolved.geometry) };
}

function auditOptions(viewport: ViewportContext, fold: FoldGeometry | null) {
  const st = studio().settings;
  return { viewport, fold, minTapSize: st.minTapSize, minFontSize: st.minFontSize, maxLineLength: st.maxLineLength, ignoreSelectors: st.ignoreSelectors };
}

async function sampleOn(conn: PreviewConnection, viewport: ViewportContext, fold: FoldGeometry | null, selector: string | null, withStyles: boolean): Promise<ProbeSample> {
  const issues = await conn.call('audit.responsive', auditOptions(viewport, fold), 20_000);
  let info: NodeInfo | null = null;
  let styles: StylesPayload | null = null;
  if (selector) {
    const id = await conn.call('dom.resolve', { selector }).catch(() => null);
    if (id) {
      [info, styles] = await Promise.all([conn.call('node.info', { id }).catch(() => null), withStyles ? conn.call('node.styles', { id }).catch(() => null) : Promise.resolve(null)]);
    }
  }
  return { issues, info, styles };
}

const frames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 40))));

function waitReady(id: string, timeoutMs: number): Promise<PreviewConnection> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const inst = studio().instances[id];
      const conn = previews.get(id);
      if (inst?.status === 'ready' && conn?.ready) {
        done();
        resolve(conn);
      } else if (inst?.status === 'error' || inst?.status === 'blocked') {
        done();
        reject(new Error(inst.error ?? 'The probe preview failed to load.'));
      }
    };
    const unsub = useStudio.subscribe((st) => st.instances[id], check);
    const timer = setTimeout(() => {
      done();
      reject(new Error('The probe preview did not become ready in time.'));
    }, timeoutMs);
    const done = () => {
      unsub();
      clearTimeout(timer);
    };
    check();
  });
}

/**
 * Measure at `state`. Each patch set in `patchSets` is applied in order and
 * sampled; by default the current edits are used. Reuses a ready compare
 * preview at the same viewport when there is no patch-set variation.
 */
export async function probeAt(state: ViewportState, selector: string | null, opts: { patchSets?: PatchSet[]; withStyles?: boolean; timeoutMs?: number } = {}): Promise<ProbeResult> {
  const s = studio();
  const { viewport, fold } = resolveState(state);
  const patchSets = opts.patchSets ?? [currentPatchSet()];
  const withStyles = opts.withStyles ?? true;

  // Cheap path: a live compare preview already shows this viewport with the current edits.
  if (!opts.patchSets && s.compare.enabled) {
    const p = s.compare.partner;
    const compareInst = Object.values(s.instances).find((i) => i.role === 'compare' && i.status === 'ready');
    const conn = compareInst ? previews.get(compareInst.id) : undefined;
    if (conn?.ready && p.deviceId === state.deviceId && p.posture === state.posture && p.orientation === state.orientation) {
      return { viewport, fold, method: 'compare-preview', samples: [await sampleOn(conn, viewport, fold, selector, withStyles)] };
    }
  }

  const primary = Object.values(s.instances).find((i) => i.role === 'primary' && i.status === 'ready' && i.url);
  if (!primary) throw new Error('No ready preview to measure.');
  const id = `ai-probe-${++seq}`;
  const host = document.createElement('div');
  host.setAttribute('data-ifdy-probe', id);
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    width: `${viewport.width}px`,
    height: `${viewport.height}px`,
    overflow: 'hidden',
    pointerEvents: 'none',
    opacity: '0',
    zIndex: '-1',
    contain: 'strict',
  });
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(<PreviewFrame instanceId={id} role="worker" src={primary.url} width={viewport.width} height={viewport.height} interactive={false} title="IFDY layout probe" />);
    const conn = await waitReady(id, opts.timeoutMs ?? 15_000);
    conn.tell('env.set', { fontScale: s.fontScale });
    const samples: ProbeSample[] = [];
    for (const set of patchSets) {
      await conn.call('patch.apply', set);
      await frames();
      samples.push(await sampleOn(conn, viewport, fold, selector, withStyles));
    }
    return { viewport, fold, samples, method: 'worker-probe' };
  } finally {
    root.unmount();
    host.remove();
  }
}
