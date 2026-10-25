import { Accessibility, ScanSearch, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { IssueSeverity, ViewportState } from '@shared/types';
import { registerActions } from '@/app/actions';
import { bus } from '@/lib/events';
import { studio } from '@/store';
import { runA11yAudit } from '@/modules/accessibility-lab/runner';
import { mountQaHosts } from './hosts';
import { runResponsiveAudit } from './runner';
import { startScrollTracking } from './scroll';
import { startAuditWorker } from './worker';

export { runResponsiveAudit, useResponsiveAudit } from './runner';
export { classifyIssues, groupIssues, filterIssues, issuesToJson, issuesToMarkdown } from './classify';
export { runSweep } from './sweep';
export { withWorker } from './worker';
export { runA11yAudit } from '@/modules/accessibility-lab/runner';

export type AuditCounts = {
  responsive: number;
  a11y: number;
  /** Responsive issues classified as likely regressions / needing review. */
  regressions: number;
  suspicious: number;
  bySeverity: Record<IssueSeverity, number>;
  viewports: number;
  errors: string[];
};

/**
 * Responsive audit (canvas viewport + other profiles through the background
 * preview) followed by the accessibility audit on the canvas page. Used by the
 * test runner and AI modules; results also land in the store.
 */
export async function runAllAudits(opts: { profiles?: ViewportState[]; responsive?: boolean; a11y?: boolean } = {}): Promise<AuditCounts> {
  const errors: string[] = [];
  const responsive = opts.responsive === false ? [] : await runResponsiveAudit({ profiles: opts.profiles }).catch((e: Error) => (errors.push(`Responsive: ${e.message}`), []));
  const a11y = opts.a11y === false ? [] : await runA11yAudit().catch((e: Error) => (errors.push(`Accessibility: ${e.message}`), []));
  const bySeverity: Record<IssueSeverity, number> = { critical: 0, serious: 0, moderate: 0, minor: 0, info: 0 };
  for (const i of responsive) bySeverity[i.severity]++;
  for (const i of a11y) bySeverity[i.impact]++;
  return {
    responsive: responsive.length,
    a11y: a11y.length,
    regressions: responsive.filter((i) => i.classification === 'regression').length,
    suspicious: responsive.filter((i) => i.classification === 'suspicious').length,
    bySeverity,
    viewports: new Set(responsive.map((i) => `${i.viewport.deviceId}|${i.viewport.posture}|${i.viewport.width}`)).size,
    errors,
  };
}

const hasPreview = () => Boolean(studio().project && studio().instances.primary?.status === 'ready');

async function runWithToast(label: string, fn: () => Promise<string>) {
  const id = toast.loading(`${label}…`);
  try {
    toast.success(await fn(), { id });
  } catch (err) {
    toast.error(`${label} failed`, { id, description: err instanceof Error ? err.message : String(err) });
  }
}

export function registerResponsiveAudit() {
  startAuditWorker();
  startScrollTracking();
  mountQaHosts();
  registerActions([
    {
      id: 'audit.responsive',
      label: 'Run responsive audit (all postures + reference viewports)',
      group: 'Test',
      icon: ScanSearch,
      keywords: 'overflow hinge fold tap target breakpoint',
      enabled: hasPreview,
      run: () => {
        studio().setBottomTab('responsive');
        return runWithToast('Responsive audit', async () => {
          const list = await runResponsiveAudit();
          const reg = list.filter((i) => i.classification === 'regression').length;
          return `${list.length} responsive finding${list.length === 1 ? '' : 's'}${reg ? ` · ${reg} likely regression${reg === 1 ? '' : 's'}` : ''}`;
        });
      },
    },
    {
      id: 'audit.a11y',
      label: 'Run accessibility audit (axe-core + IFDY checks)',
      group: 'Test',
      icon: Accessibility,
      keywords: 'a11y wcag axe contrast label keyboard',
      enabled: hasPreview,
      run: () => {
        studio().setBottomTab('a11y');
        return runWithToast('Accessibility audit', async () => {
          const list = await runA11yAudit();
          const nodes = list.reduce((n, i) => n + i.nodes.length, 0);
          return `${list.length} accessibility rule${list.length === 1 ? '' : 's'} failed · ${nodes} element${nodes === 1 ? '' : 's'}`;
        });
      },
    },
    {
      id: 'audit.all',
      label: 'Run all audits (responsive + accessibility)',
      group: 'Test',
      icon: ShieldCheck,
      enabled: hasPreview,
      run: () =>
        runWithToast('Audits', async () => {
          const c = await runAllAudits();
          if (c.errors.length) throw new Error(c.errors.join(' · '));
          return `${c.responsive} responsive · ${c.a11y} accessibility findings`;
        }),
    },
  ]);
  bus.on('run-audits', () => void runAllAudits());
}
