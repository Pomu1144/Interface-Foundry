import { FileDiff, FileText, FolderTree, Palette, Images, Radar, Component } from 'lucide-react';
import { toast } from 'sonner';
import { bus } from '@/lib/events';
import { registerActions } from '@/app/actions';
import { studio } from '@/store';
import { revealInEditor } from '@/modules/code-editor/open';

/**
 * Startup for the source/ship modules: export engine (Mod+E), QA report,
 * design tokens, assets, components, code editor (reveal-in-editor) and git.
 */
export function registerSourceModules() {
  const hasProject = () => Boolean(studio().project);
  registerActions([
    { id: 'export.open', label: 'Export changes & review patches', group: 'Export', shortcut: 'Mod+E', icon: FileDiff, keywords: 'patch diff css git commit download', enabled: hasProject, run: () => studio().setBottomTab('export') },
    { id: 'export.report', label: 'Open responsive QA report', group: 'Export', icon: FileText, keywords: 'report html qa accessibility', enabled: hasProject, run: () => studio().openDoc({ id: 'report', kind: 'report', title: 'QA report' }) },
    {
      id: 'tokens.scan',
      label: 'Scan page for design tokens',
      group: 'Inspect',
      icon: Radar,
      keywords: 'css variables custom properties :root',
      enabled: hasProject,
      run: async () => {
        studio().setLeftTab('tokens');
        try {
          const { scanPageTokens } = await import('@/modules/design-tokens/tokens');
          const r = await scanPageTokens();
          toast.success(`Scanned ${r.total} custom properties`, { description: `${r.added} new, ${r.updated} updated` });
        } catch (err) {
          toast.error('Scan failed', { description: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { id: 'tokens.open', label: 'Design tokens', group: 'Navigate', icon: Palette, enabled: hasProject, run: () => studio().setLeftTab('tokens') },
    { id: 'assets.open', label: 'Asset library', group: 'Navigate', icon: Images, enabled: hasProject, run: () => studio().setLeftTab('assets') },
    { id: 'components.open', label: 'Components', group: 'Navigate', icon: Component, enabled: hasProject, run: () => studio().setLeftTab('components') },
    { id: 'files.open', label: 'Source files', group: 'Navigate', icon: FolderTree, keywords: 'code editor', enabled: hasProject, run: () => studio().setLeftTab('files') },
  ]);
  bus.on('reveal-in-editor', (p) => void revealInEditor(p));
}
