import { Fragment } from 'react';
import { Dialog, Kbd } from '@/ui';
import { allActions } from '../actions';
import s from './dialogs.module.css';

const EXTRA = [
  { group: 'Canvas', label: 'Pan', shortcut: 'Space' },
  { group: 'Canvas', label: 'Zoom', shortcut: 'Mod+Scroll' },
  { group: 'Canvas', label: 'Measure distances', shortcut: 'Alt' },
  { group: 'Canvas', label: 'Select parent / clear', shortcut: 'Escape' },
  { group: 'Canvas', label: 'Search elements & actions', shortcut: 'Mod+K' },
  { group: 'Canvas', label: 'Scrub a number field', shortcut: 'Drag label' },
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const actions = allActions().filter((a) => a.shortcut);
  const groups = [...new Set(actions.map((a) => a.group))];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" width={720}>
      <div className={s.kbdGrid}>
        {groups.map((g) => (
          <Fragment key={g}>
            <div className={s.kbdGroup}>{g}</div>
            {actions
              .filter((a) => a.group === g)
              .map((a) => (
                <div key={a.id} className={s.kbdRow}>
                  <span>{a.label}</span>
                  <Kbd keys={a.shortcut!} />
                </div>
              ))}
          </Fragment>
        ))}
        <div className={s.kbdGroup}>Canvas</div>
        {EXTRA.map((e) => (
          <div key={e.label} className={s.kbdRow}>
            <span>{e.label}</span>
            <Kbd keys={e.shortcut} />
          </div>
        ))}
      </div>
    </Dialog>
  );
}
