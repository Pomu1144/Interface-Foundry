import type { ResponsiveAuditOptions } from '@shared/protocol';
import type { ResponsiveIssue, ViewportContext, ViewportState } from '@shared/types';
import { create } from 'zustand';
import { studio } from '@/store';
import { currentFold, currentViewportContext } from '@/modules/device-simulator/context';
import { callPrimary } from '@/modules/preview-runtime/registry';
import { classifyIssues, viewportKey, type ProfileRun } from './classify';
import { defaultProfiles, resolveProfile } from './profiles';
import { withWorker, workerSupport } from './worker';

/** Per-run details the panel shows (which viewports ran where, failures, progress). */
export type RunSummary = { viewport: ViewportContext; source: 'primary' | 'worker'; count: number; error?: string; ms: number };
type AuditUi = {
  progress: { done: number; total: number; label: string } | null;
  runs: RunSummary[];
  startedAt: number | null;
  durationMs: number | null;
  route: string | null;
};
export const useResponsiveAudit = create<AuditUi>(() => ({ progress: null, runs: [], startedAt: null, durationMs: null, route: null }));

export function auditOptions(viewport: ViewportContext, fold: ResponsiveAuditOptions['fold']): ResponsiveAuditOptions {
  const st = studio().settings;
  return { viewport, fold: fold ?? null, minTapSize: st.minTapSize, minFontSize: st.minFontSize, maxLineLength: st.maxLineLength, ignoreSelectors: st.ignoreSelectors };
}

let inflight: Promise<ResponsiveIssue[]> | null = null;

/**
 * Audit the current canvas viewport (primary preview, live state) plus other
 * profiles through the hidden worker preview, then classify across viewports.
 */
export function runResponsiveAudit(opts: { profiles?: ViewportState[] } = {}): Promise<ResponsiveIssue[]> {
  if (inflight) return inflight;
  inflight = doRun(opts).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doRun(opts: { profiles?: ViewportState[] }): Promise<ResponsiveIssue[]> {
  const s = studio();
  if (!s.project) throw new Error('Open a project first.');
  const t0 = Date.now();
  s.setAuditStatus({ responsive: 'running', error: undefined });
  const current = currentViewportContext();
  const curKey = viewportKey(current);
  const others = (opts.profiles ?? defaultProfiles())
    .map(resolveProfile)
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .filter((p, i, arr) => viewportKey(p.ctx) !== curKey && arr.findIndex((q) => viewportKey(q.ctx) === viewportKey(p.ctx)) === i);
  const total = 1 + others.length;
  const runs: ProfileRun[] = [];
  const summaries: RunSummary[] = [];
  useResponsiveAudit.setState({ progress: { done: 0, total, label: current.deviceName }, startedAt: t0, route: s.currentRoute });

  try {
    const t1 = Date.now();
    const issues = await callPrimary('audit.responsive', auditOptions(current, currentFold()), 30_000);
    runs.push({ viewport: current, issues, source: 'primary' });
    summaries.push({ viewport: current, source: 'primary', count: issues.length, ms: Date.now() - t1 });

    if (others.length) {
      const sup = workerSupport();
      if (!sup.ok) {
        for (const o of others) {
          runs.push({ viewport: o.ctx, issues: [], source: 'worker', error: sup.reason });
          summaries.push({ viewport: o.ctx, source: 'worker', count: 0, error: sup.reason, ms: 0 });
        }
      } else {
        await withWorker('Responsive audit', async (w) => {
          for (const [i, o] of others.entries()) {
            useResponsiveAudit.setState({ progress: { done: 1 + i, total, label: `${o.ctx.deviceName}${o.ctx.posture === 'expanded' ? ' · expanded' : ''}` } });
            const t2 = Date.now();
            try {
              await w.resize(o.ctx.width, o.ctx.height);
              const list = await w.call('audit.responsive', auditOptions(o.ctx, o.fold), 30_000);
              // Node ids belong to the worker document; selection resolves by selector instead.
              runs.push({ viewport: o.ctx, issues: list.map((x) => ({ ...x, nodeId: undefined })), source: 'worker' });
              summaries.push({ viewport: o.ctx, source: 'worker', count: list.length, ms: Date.now() - t2 });
            } catch (err) {
              const error = err instanceof Error ? err.message : String(err);
              runs.push({ viewport: o.ctx, issues: [], source: 'worker', error });
              summaries.push({ viewport: o.ctx, source: 'worker', count: 0, error, ms: Date.now() - t2 });
            }
          }
        }).catch((err) => {
          const error = err instanceof Error ? err.message : String(err);
          for (const o of others) {
            if (summaries.some((x) => viewportKey(x.viewport) === viewportKey(o.ctx))) continue;
            runs.push({ viewport: o.ctx, issues: [], source: 'worker', error });
            summaries.push({ viewport: o.ctx, source: 'worker', count: 0, error, ms: 0 });
          }
        });
      }
    }

    const classified = classifyIssues(runs).map((i) => ({ ...i, id: `${viewportKey(i.viewport)}::${i.id}` }));
    s.setResponsiveIssues(classified);
    s.setAuditStatus({ responsive: 'done', at: Date.now() });
    useResponsiveAudit.setState({ runs: summaries, progress: null, durationMs: Date.now() - t0 });
    return classified;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    s.setAuditStatus({ responsive: 'error', error });
    useResponsiveAudit.setState({ runs: summaries, progress: null, durationMs: Date.now() - t0 });
    throw err;
  }
}
