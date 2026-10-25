import { ArrowLeft, Sparkles } from 'lucide-react';
import { Badge, EmptyState, IconButton, PanelHeader, Tabs, type TabItem } from '@/ui';
import { studio, useStudio, type RightTab } from '@/store';
import { art } from '@/app/art';
import { DesignTab } from '@/modules/style-inspector/DesignTab';
import { LayoutTab } from '@/modules/style-inspector/LayoutTab';
import { StylesTab } from '@/modules/style-inspector/StylesTab';
import { ComputedTab } from '@/modules/style-inspector/ComputedTab';
import { BoxModelTab } from '@/modules/style-inspector/BoxModelTab';
import { DomTab } from '@/modules/element-inspector/DomTab';
import { EventsTab } from '@/modules/element-inspector/EventsTab';
import { A11yTab } from '@/modules/accessibility-lab/A11yTab';
import { ResponsiveTab } from '@/modules/responsive-audit/ResponsiveTab';
import { ComponentTab } from '@/modules/component-mapper/ComponentTab';
import { AiPanel } from '@/modules/ai-debugger/AiPanel';
import s from './inspector.module.css';

const TABS: TabItem<RightTab>[] = [
  { id: 'design', label: 'Design' },
  { id: 'layout', label: 'Layout' },
  { id: 'styles', label: 'Styles' },
  { id: 'box', label: 'Box' },
  { id: 'computed', label: 'Computed' },
  { id: 'dom', label: 'DOM' },
  { id: 'a11y', label: 'A11y' },
  { id: 'events', label: 'Events' },
  { id: 'responsive', label: 'Responsive' },
  { id: 'component', label: 'Component' },
];

/** Tabs that do not need a selection to be useful. */
const NO_SELECTION_OK: RightTab[] = ['dom', 'ai'];

export function RightInspector() {
  const tab = useStudio((st) => st.rightTab);
  const info = useStudio((st) => st.selection.info);
  const loading = useStudio((st) => st.selection.loading);
  const project = useStudio((st) => st.project);

  if (tab === 'ai') {
    return (
      <>
        <PanelHeader
          title={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={13} color="var(--violet)" /> AI assistant
            </span>
          }
          actions={
            <IconButton size="sm" label="Back to inspector" onClick={() => studio().setRightTab('design')}>
              <ArrowLeft size={14} />
            </IconButton>
          }
        />
        <div className={s.body}>
          <AiPanel />
        </div>
      </>
    );
  }

  return (
    <>
      <div className={s.header}>
        {info ? (
          <div className={s.selectionHead}>
            <span className={s.tag}>{info.tag}</span>
            <span className={s.selector} title={info.selector}>
              {info.label.replace(/^[a-z0-9]+/, '') || info.selector}
            </span>
            {info.component && <Badge tone="violet">{info.component.name}</Badge>}
            <span style={{ flex: 1 }} />
            <span className={s.dims}>
              {Math.round(info.rect.width)}×{Math.round(info.rect.height)}
            </span>
          </div>
        ) : (
          <div className={s.selectionHead}>
            <span className={s.muted}>{loading ? 'Inspecting…' : 'No selection'}</span>
          </div>
        )}
      </div>
      <Tabs ariaLabel="Inspector" value={tab} items={TABS} onChange={(t) => studio().setRightTab(t)} className={s.tabs} />
      <div className={s.body}>
        {!project ? (
          <EmptyState art={art.select} title="Nothing to inspect">
            Open a project to start inspecting.
          </EmptyState>
        ) : !info && !NO_SELECTION_OK.includes(tab) ? (
          <EmptyState art={art.select} title="Select an element">
            Click anything in the preview (Inspect mode), pick a layer, or press <b>/</b> to search by tag, class, text or accessible name.
          </EmptyState>
        ) : (
          <>
            {tab === 'design' && <DesignTab />}
            {tab === 'layout' && <LayoutTab />}
            {tab === 'styles' && <StylesTab />}
            {tab === 'box' && <BoxModelTab />}
            {tab === 'computed' && <ComputedTab />}
            {tab === 'dom' && <DomTab />}
            {tab === 'a11y' && <A11yTab />}
            {tab === 'events' && <EventsTab />}
            {tab === 'responsive' && <ResponsiveTab />}
            {tab === 'component' && <ComponentTab />}
          </>
        )}
      </div>
    </>
  );
}
