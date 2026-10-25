import { useEffect } from 'react';
import { studio } from '@/store';
import { bus } from '@/lib/events';
import { isTyping } from '@/modules/canvas/useCamera';
import { refreshSelection } from '@/modules/preview-runtime/sync';
import { allActions, matchesShortcut } from './actions';

/** Global keyboard shortcuts, also honouring keys forwarded from previews. */
export function useShortcuts() {
  useEffect(() => {
    const handle = (e: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean }, typing: boolean): boolean => {
      const mod = Boolean(e.metaKey ?? e.meta) || Boolean(e.ctrlKey ?? e.ctrl);
      // Single-key shortcuts never fire while typing.
      if (typing && !mod) return false;
      if ((e.key === 'k' || e.key === 'K') && mod) {
        studio().setCommandOpen(!studio().commandOpen);
        return true;
      }
      if (e.key === 'Escape') {
        const st = studio();
        if (st.selection.nodeId !== null) {
          // Escape walks up to the parent, then clears.
          const parent = st.selection.info?.path.at(-2);
          if (parent && parent.label !== 'html') {
            st.select(st.selection.instanceId, parent.id, null);
            void refreshSelection();
          } else st.select(null, null);
          return true;
        }
        return false;
      }
      if (e.key === '/' && !mod && !typing) {
        studio().setCommandOpen(true);
        return true;
      }
      for (const a of allActions()) {
        if (a.shortcut && matchesShortcut(e, a.shortcut)) {
          if (a.enabled && !a.enabled()) return true;
          void a.run();
          return true;
        }
      }
      // Alt+1..8 switch navigator tabs.
      if ((e.altKey ?? e.alt) && /^[1-8]$/.test(e.key)) {
        const tabs = ['layers', 'pages', 'files', 'components', 'assets', 'tokens', 'scenarios', 'devices'] as const;
        studio().setLeftTab(tabs[Number(e.key) - 1]);
        return true;
      }
      return false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (handle(e, isTyping(e))) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    const off = bus.on('agent-key', (k) => {
      handle(k, false);
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      off();
    };
  }, []);
}
