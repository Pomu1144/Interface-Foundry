import { ChevronDown } from 'lucide-react';
import { IconButton, Tabs, type TabItem } from '@/ui';
import { studio, useStudio, type BottomTab } from '@/store';
import { ConsolePanel } from '@/modules/diagnostics/ConsolePanel';
import { NetworkPanel } from '@/modules/diagnostics/NetworkPanel';
import { ErrorsPanel } from '@/modules/diagnostics/ErrorsPanel';
import { HistoryPanel } from '@/modules/change-manager/HistoryPanel';
import { A11yFindingsPanel } from '@/modules/accessibility-lab/A11yFindingsPanel';
import { ResponsiveIssuesPanel } from '@/modules/responsive-audit/ResponsiveIssuesPanel';
import { TimelinePanel } from '@/modules/interaction-recorder/TimelinePanel';
import { TestsPanel } from '@/modules/financial-ux-suite/TestsPanel';
import { ExportPanel } from '@/modules/export-engine/ExportPanel';

export function BottomPanel() {
  const tab = useStudio((st) => st.bottomTab);
  const errors = useStudio((st) => st.console.filter((c) => c.level === 'error').length);
  const logs = useStudio((st) => st.console.length);
  const net = useStudio((st) => st.network.length);
  const netFailed = useStudio((st) => st.network.filter((n) => n.failed).length);
  const a11y = useStudio((st) => st.a11yIssues.length);
  const responsive = useStudio((st) => st.responsiveIssues.length);
  const steps = useStudio((st) => st.recording.steps.length);
  const changes = useStudio((st) => st.changes.length);
  const failedRuns = useStudio((st) => st.runs.filter((r) => r.status === 'failed').length);
  const runs = useStudio((st) => st.runs.length);
  const pendingExport = useStudio((st) => st.changes.filter((c) => c.exportStatus === 'pending').length);

  const items: TabItem<BottomTab>[] = [
    { id: 'console', label: 'Console', count: logs },
    { id: 'network', label: 'Network', count: netFailed || net, tone: netFailed ? 'danger' : undefined },
    { id: 'errors', label: 'Runtime errors', count: errors, tone: 'danger' },
    { id: 'a11y', label: 'Accessibility', count: a11y, tone: 'warning' },
    { id: 'responsive', label: 'Responsive', count: responsive, tone: 'warning' },
    { id: 'timeline', label: 'Timeline', count: steps, tone: 'accent' },
    { id: 'history', label: 'Changes', count: changes, tone: 'accent' },
    { id: 'tests', label: 'Tests', count: failedRuns || runs, tone: failedRuns ? 'danger' : undefined },
    { id: 'export', label: 'Export & Git', count: pendingExport, tone: 'accent' },
  ];
  return (
    <>
      <Tabs
        ariaLabel="Debug panels"
        value={tab}
        items={items}
        onChange={(t) => studio().setBottomTab(t)}
        trailing={
          <IconButton size="sm" label="Hide panel" shortcut="Mod+J" onClick={() => studio().togglePanel('bottom', false)}>
            <ChevronDown size={14} />
          </IconButton>
        }
      />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tab === 'console' && <ConsolePanel />}
        {tab === 'network' && <NetworkPanel />}
        {tab === 'errors' && <ErrorsPanel />}
        {tab === 'a11y' && <A11yFindingsPanel />}
        {tab === 'responsive' && <ResponsiveIssuesPanel />}
        {tab === 'timeline' && <TimelinePanel />}
        {tab === 'history' && <HistoryPanel />}
        {tab === 'tests' && <TestsPanel />}
        {tab === 'export' && <ExportPanel />}
      </div>
    </>
  );
}
