import { PanelLeftClose } from 'lucide-react';
import { IconButton, PanelHeader } from '@/ui';
import { studio, useStudio } from '@/store';
import { LEFT_TABS } from '../ActivityBar';
import { LayersPanel } from '@/modules/element-inspector/LayersPanel';
import { PagesPanel } from '@/modules/project-adapter/PagesPanel';
import { FilesPanel } from '@/modules/code-editor/FilesPanel';
import { ComponentsPanel } from '@/modules/component-mapper/ComponentsPanel';
import { AssetsPanel } from '@/modules/asset-manager/AssetsPanel';
import { TokensPanel } from '@/modules/design-tokens/TokensPanel';
import { ScenariosPanel } from '@/modules/interaction-recorder/ScenariosPanel';
import { DevicesPanel } from '@/modules/device-simulator/DevicesPanel';

export function LeftSidebar() {
  const tab = useStudio((st) => st.leftTab);
  const label = LEFT_TABS.find((t) => t.id === tab)?.label ?? '';
  return (
    <>
      <PanelHeader
        title={label}
        actions={
          <IconButton size="sm" label="Hide sidebar" shortcut="Mod+\" onClick={() => studio().togglePanel('left', false)}>
            <PanelLeftClose size={14} />
          </IconButton>
        }
      />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tab === 'layers' && <LayersPanel />}
        {tab === 'pages' && <PagesPanel />}
        {tab === 'files' && <FilesPanel />}
        {tab === 'components' && <ComponentsPanel />}
        {tab === 'assets' && <AssetsPanel />}
        {tab === 'tokens' && <TokensPanel />}
        {tab === 'scenarios' && <ScenariosPanel />}
        {tab === 'devices' && <DevicesPanel />}
      </div>
    </>
  );
}
