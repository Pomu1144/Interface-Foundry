import { Boxes, Component, FileCode2, FlaskConical, Image, Layers, Palette, ScrollText, Smartphone, Keyboard, HelpCircle } from 'lucide-react';
import type { LeftTab } from '@/store';
import { studio, useStudio } from '@/store';
import { Tooltip } from '@/ui';
import s from './shell.module.css';

export const LEFT_TABS: { id: LeftTab; label: string; icon: typeof Layers; shortcut?: string }[] = [
  { id: 'layers', label: 'Layers', icon: Layers, shortcut: 'Alt+1' },
  { id: 'pages', label: 'Pages', icon: ScrollText, shortcut: 'Alt+2' },
  { id: 'files', label: 'Files', icon: FileCode2, shortcut: 'Alt+3' },
  { id: 'components', label: 'Components', icon: Component, shortcut: 'Alt+4' },
  { id: 'assets', label: 'Assets', icon: Image, shortcut: 'Alt+5' },
  { id: 'tokens', label: 'Design tokens', icon: Palette, shortcut: 'Alt+6' },
  { id: 'scenarios', label: 'Test scenarios', icon: FlaskConical, shortcut: 'Alt+7' },
  { id: 'devices', label: 'Devices', icon: Smartphone, shortcut: 'Alt+8' },
];

export function ActivityBar() {
  const leftTab = useStudio((st) => st.leftTab);
  const open = useStudio((st) => st.panels.left);
  return (
    <nav className={s.activityBar} aria-label="Navigator">
      {LEFT_TABS.map((t) => {
        const active = open && leftTab === t.id;
        return (
          <Tooltip key={t.id} content={t.label} shortcut={t.shortcut} side="right">
            <button
              className={s.activityItem}
              data-active={active ? 'true' : undefined}
              aria-label={t.label}
              aria-pressed={active}
              onClick={() => (active ? studio().togglePanel('left', false) : studio().setLeftTab(t.id))}
            >
              <t.icon size={18} strokeWidth={1.7} />
            </button>
          </Tooltip>
        );
      })}
      <span className={s.activitySpacer} />
      <Tooltip content="Keyboard shortcuts" shortcut="Mod+/" side="right">
        <button className={s.activityItem} aria-label="Keyboard shortcuts" onClick={() => studio().setDialog('shortcuts', true)}>
          <Keyboard size={17} strokeWidth={1.7} />
        </button>
      </Tooltip>
      <Tooltip content="Device Manager" side="right">
        <button className={s.activityItem} aria-label="Device Manager" onClick={() => studio().setDialog('deviceManager', true)}>
          <Boxes size={17} strokeWidth={1.7} />
        </button>
      </Tooltip>
      <Tooltip content="About IFDY" side="right">
        <button className={s.activityItem} aria-label="About" onClick={() => studio().setDialog('settings', true)}>
          <HelpCircle size={17} strokeWidth={1.7} />
        </button>
      </Tooltip>
    </nav>
  );
}
