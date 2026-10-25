import { useEffect } from 'react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { useStudio } from '@/store';
import { useTransitionDriver } from '@/modules/device-simulator/useTransitionDriver';
import { ActivityBar } from './ActivityBar';
import { BottomPanel } from './bottom/BottomPanel';
import { DocumentArea } from './DocumentArea';
import { RightInspector } from './inspector/RightInspector';
import { LeftSidebar } from './sidebar/LeftSidebar';
import { StatusBar } from './StatusBar';
import { Toolbar } from './toolbar/Toolbar';
import s from './shell.module.css';

export function Workspace() {
  useTransitionDriver();
  const panels = useStudio((st) => st.panels);
  const left = usePanelRef();
  const right = usePanelRef();
  const bottom = usePanelRef();

  // Keep imperative panel state in sync with the store toggles.
  useEffect(() => {
    sync(left.current, panels.left);
    sync(right.current, panels.right);
    sync(bottom.current, panels.bottom);
  }, [panels, left, right, bottom]);

  return (
    <div className={s.app}>
      <Toolbar />
      <div className={s.main}>
        <ActivityBar />
        <div className={s.workArea}>
          <Group orientation="horizontal" id="ifdy-main" style={{ width: '100%', height: '100%' }}>
            <Panel
              id="left"
              panelRef={left}
              defaultSize={272}
              minSize={200}
              maxSize={480}
              collapsible
              collapsedSize={0}
              groupResizeBehavior="preserve-pixel-size"
              onResize={(size) => syncStore('left', size.inPixels > 0)}
            >
              <div className={s.panel} style={{ borderRight: '1px solid var(--line-1)' }}>
                <LeftSidebar />
              </div>
            </Panel>
            <Separator className={s.separator} />
            <Panel id="center" minSize={360}>
              <Group orientation="vertical" id="ifdy-center">
                <Panel id="docs" minSize={200}>
                  <div className={s.center}>
                    <DocumentArea />
                  </div>
                </Panel>
                <Separator className={`${s.separator} ${s.separatorH}`} />
                <Panel
                  id="bottom"
                  panelRef={bottom}
                  defaultSize={240}
                  minSize={120}
                  maxSize="70%"
                  collapsible
                  collapsedSize={0}
                  groupResizeBehavior="preserve-pixel-size"
                  onResize={(size) => syncStore('bottom', size.inPixels > 0)}
                >
                  <div className={s.panel} style={{ borderTop: '1px solid var(--line-1)' }}>
                    <BottomPanel />
                  </div>
                </Panel>
              </Group>
            </Panel>
            <Separator className={s.separator} />
            <Panel
              id="right"
              panelRef={right}
              defaultSize={320}
              minSize={260}
              maxSize={560}
              collapsible
              collapsedSize={0}
              groupResizeBehavior="preserve-pixel-size"
              onResize={(size) => syncStore('right', size.inPixels > 0)}
            >
              <div className={s.panel} style={{ borderLeft: '1px solid var(--line-1)' }}>
                <RightInspector />
              </div>
            </Panel>
          </Group>
        </div>
      </div>
      <StatusBar />
    </div>
  );
}

function sync(panel: { collapse(): void; expand(): void; isCollapsed(): boolean } | null, open: boolean) {
  if (!panel) return;
  if (open && panel.isCollapsed()) panel.expand();
  if (!open && !panel.isCollapsed()) panel.collapse();
}

function syncStore(key: 'left' | 'right' | 'bottom', open: boolean) {
  const st = useStudio.getState();
  if (st.panels[key] !== open) useStudio.setState({ panels: { ...st.panels, [key]: open } });
}
