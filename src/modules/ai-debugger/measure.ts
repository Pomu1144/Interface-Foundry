import type { Change, PatchSet, ViewportState } from '@shared/types';
import { studio } from '@/store';
import { previews } from '@/modules/preview-runtime/registry';
import { currentPatchSet } from '@/modules/preview-runtime/sync';
import { buildPatchSet } from '@/modules/change-manager/changes';
import { auditOptionsNow } from './context';
import { compareMeasurements, summarize, type Measurement, type MeasurementComparison } from './metrics';
import { otherViewportState, probeAt } from './probe';

/**
 * Re-measure after fixes and experiments: the element (node.info) plus the
 * responsive audit at the current viewport, and — for "Re-run checks" — the
 * other posture measured before/after in a hidden worker preview.
 */

const frames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30))));

/** Measure the selected element + audit on the primary preview, with the current change set applied first. */
export async function measureCurrent(selector: string | null): Promise<Measurement> {
  const s = studio();
  const conn = previews.get(s.selection.instanceId) ?? previews.primary();
  if (!conn?.ready) throw new Error('No preview is connected.');
  // Make sure the latest edits are applied before measuring (idempotent).
  await conn.call('patch.apply', currentPatchSet());
  await frames();
  const opts = auditOptionsNow();
  const id = selector ? await conn.call('dom.resolve', { selector }).catch(() => null) : null;
  const [info, issues] = await Promise.all([id ? conn.call('node.info', { id }).catch(() => null) : Promise.resolve(null), conn.call('audit.responsive', opts, 20_000)]);
  return summarize(issues, info, opts.viewport, opts.fold, selector, id);
}

/** Patch set for the current changes without the given group (the "before" state of a fix). */
export function patchSetWithout(groupId: string): PatchSet {
  const s = studio();
  const without: Change[] = s.changes.filter((c) => c.groupId !== groupId && c.id !== groupId);
  return buildPatchSet(without, s.tokens, false);
}

export type RerunRow = { label: string; viewport: Measurement['viewport']; before: Measurement; after: Measurement; comparison: MeasurementComparison; source: string };
export type SharedAudit = { status: 'ran' | 'unavailable' | 'failed'; responsive?: number; viewports?: number; errors?: string[] };
export type RerunResult = { rows: RerunRow[]; shared: SharedAudit; at: number };

/**
 * Re-run the shared responsive audit (responsive-audit module, written by another
 * team) at this viewport and the other posture so its panels refresh. Guarded:
 * the before/after numbers below never depend on it.
 */
async function runSharedAudits(profiles: ViewportState[]): Promise<SharedAudit> {
  try {
    const mod = await import('@/modules/responsive-audit');
    if (typeof mod.runAllAudits !== 'function') return { status: 'unavailable' };
    const counts = await mod.runAllAudits({ profiles, a11y: false });
    return { status: 'ran', responsive: counts.responsive, viewports: counts.viewports, errors: counts.errors };
  } catch {
    return { status: 'failed' };
  }
}

/**
 * Re-run checks after a fix: this viewport (before = baseline captured at diagnosis
 * or preview time) and the other posture (before/after measured with and without
 * the fix's changes in a hidden preview).
 */
export async function rerunChecks(opts: { selector: string | null; groupId: string | null; baseline: Measurement | null }): Promise<RerunResult> {
  const rows: RerunRow[] = [];
  const after = await measureCurrent(opts.selector);
  if (opts.baseline) rows.push({ label: 'This viewport', viewport: after.viewport, before: opts.baseline, after, comparison: compareMeasurements(opts.baseline, after), source: 'agent audit.responsive' });
  const other = otherViewportState();
  try {
    const sets = opts.groupId ? [patchSetWithout(opts.groupId), currentPatchSet()] : [currentPatchSet(), currentPatchSet()];
    const probe = await probeAt(other.state, opts.selector, { patchSets: sets, withStyles: false });
    const [b, a] = probe.samples.map((smp) => summarize(smp.issues, smp.info, probe.viewport, probe.fold, opts.selector, smp.info?.id));
    const name = other.label.charAt(0).toUpperCase() + other.label.slice(1);
    rows.push({ label: other.label === 'expanded' || other.label === 'folded' ? `${name} posture` : name, viewport: probe.viewport, before: b, after: a, comparison: compareMeasurements(b, a), source: 'hidden worker preview' });
  } catch {
    /* other posture unavailable — the UI shows only this viewport */
  }
  // Refresh the shared Responsive panels afterwards so they do not race our measurements.
  return { rows, shared: await runSharedAudits([studio().viewport, other.state]), at: Date.now() };
}
