import { useEffect } from 'react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/ui';
import { useStudio } from '@/store';
import { Workspace } from './Workspace';
import { Welcome } from './welcome/Welcome';
import { CommandPalette } from './command/CommandPalette';
import { Dialogs } from './dialogs/Dialogs';
import { useShortcuts } from './useShortcuts';

export function App() {
  const project = useStudio((st) => st.project);
  const theme = useStudio((st) => st.settings.theme);
  useShortcuts();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return (
    <TooltipProvider>
      {project ? <Workspace /> : <Welcome />}
      <CommandPalette />
      <Dialogs />
      <Toaster
        theme={theme}
        position="bottom-right"
        offset={44}
        toastOptions={{
          style: {
            background: 'var(--bg-3)',
            color: 'var(--text-0)',
            border: '1px solid var(--line-2)',
            fontFamily: 'var(--font-ui)',
            fontSize: '12.5px',
            borderRadius: '12px',
            boxShadow: 'var(--shadow-pop)',
          },
        }}
      />
    </TooltipProvider>
  );
}
