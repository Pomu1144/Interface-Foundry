import { Keyboard, ListOrdered } from 'lucide-react';
import { toast } from 'sonner';
import { registerActions } from '@/app/actions';
import { studio } from '@/store';
import { runKeyboardAudit, useA11yLab } from './runner';

export { runA11yAudit, runKeyboardAudit, useA11yLab } from './runner';

const hasPreview = () => Boolean(studio().project && studio().instances.primary?.status === 'ready');

export async function toggleTabOrderOverlay(on = !useA11yLab.getState().overlay) {
  if (on && !useA11yLab.getState().keyboard) await runKeyboardAudit();
  useA11yLab.setState({ overlay: on });
}

export function registerAccessibilityLab() {
  registerActions([
    {
      id: 'audit.keyboard',
      label: 'Keyboard test (tab order, visible focus, unreachable controls)',
      group: 'Test',
      icon: Keyboard,
      enabled: hasPreview,
      run: async () => {
        studio().setBottomTab('a11y');
        try {
          const r = await runKeyboardAudit();
          const noFocus = r.order.filter((o) => !o.visibleFocus).length;
          toast.success(`${r.order.length} tab stops`, { description: `${noFocus} without a visible focus indicator · ${r.traps.length} unreachable` });
        } catch (err) {
          toast.error('Keyboard test failed', { description: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    {
      id: 'a11y.tabOrderOverlay',
      label: 'Toggle tab-order overlay on the canvas',
      group: 'View',
      icon: ListOrdered,
      enabled: hasPreview,
      run: async () => {
        try {
          await toggleTabOrderOverlay();
        } catch (err) {
          toast.error('Keyboard test failed', { description: err instanceof Error ? err.message : String(err) });
        }
      },
    },
  ]);
}
