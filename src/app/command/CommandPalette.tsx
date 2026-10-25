import { Command } from 'cmdk';
import { Dialog as RDialog } from 'radix-ui';
import { Code2, FileText, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Kbd } from '@/ui';
import { studio, useStudio } from '@/store';
import { allActions, onActionsChanged, type StudioAction } from '../actions';
import { previews } from '@/modules/preview-runtime/registry';
import { refreshSelection, watchOverlayIds } from '@/modules/preview-runtime/sync';
import s from './command.module.css';

const GROUP_ORDER: StudioAction['group'][] = ['Navigate', 'Inspect', 'Device', 'View', 'Edit', 'Test', 'AI', 'Export', 'Project', 'Help'];

export function CommandPalette() {
  const open = useStudio((st) => st.commandOpen);
  const routes = useStudio((st) => st.routes);
  const [q, setQ] = useState('');
  const [, bump] = useState(0);
  const [elements, setElements] = useState<{ id: number; label: string; match: string }[]>([]);
  useEffect(() => onActionsChanged(() => bump((n) => n + 1)), []);
  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  // Element search against the live page.
  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) {
      setElements([]);
      return;
    }
    const conn = previews.primary();
    if (!conn?.ready) return;
    const t = setTimeout(() => {
      conn
        .call('dom.find', { text: term, limit: 12 })
        .then(setElements)
        .catch(() => setElements([]));
    }, 120);
    return () => clearTimeout(t);
  }, [q, open]);

  const groups = useMemo(() => {
    const acts = allActions().filter((a) => !a.enabled || a.enabled());
    return GROUP_ORDER.map((g) => ({ g, items: acts.filter((a) => a.group === g) })).filter((x) => x.items.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => studio().setCommandOpen(false);

  return (
    <RDialog.Root open={open} onOpenChange={(o) => studio().setCommandOpen(o)}>
      <RDialog.Portal>
        <RDialog.Overlay className={s.overlay} />
        <RDialog.Content className={s.content} aria-describedby={undefined}>
          <RDialog.Title className="sr-only">Command palette</RDialog.Title>
          <Command label="Command palette" loop shouldFilter>
            <div className={s.inputRow}>
              <Search size={16} className={s.searchIcon} />
              <Command.Input className={s.input} value={q} onValueChange={setQ} placeholder="Search actions, devices, pages, or elements in the page…" autoFocus />
              <Kbd keys="Escape" />
            </div>
            <Command.List className={s.list}>
              <Command.Empty className={s.empty}>No results for “{q}”.</Command.Empty>
              {elements.length > 0 && (
                <Command.Group heading="Elements in page" className={s.group}>
                  {elements.map((el) => (
                    <Command.Item
                      key={`el-${el.id}`}
                      value={`element ${el.label} ${el.match} ${q}`}
                      className={s.item}
                      onSelect={() => {
                        const conn = previews.primary();
                        if (!conn) return;
                        studio().select(conn.id, el.id, null);
                        void refreshSelection();
                        watchOverlayIds();
                        conn.tell('node.scrollIntoView', { id: el.id });
                        studio().setRightTab('design');
                        close();
                      }}
                    >
                      <Code2 size={14} className={s.icon} />
                      <span className={s.label}>
                        <span className={s.mono}>{el.label}</span>
                      </span>
                      <span className={s.hint}>{el.match}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {routes.length > 0 && (
                <Command.Group heading="Pages" className={s.group}>
                  {routes.map((r) => (
                    <Command.Item
                      key={`route-${r.id}`}
                      value={`page ${r.label} ${r.path}`}
                      className={s.item}
                      onSelect={() => {
                        studio().setCurrentRoute(r.path);
                        close();
                      }}
                    >
                      <FileText size={14} className={s.icon} />
                      <span className={s.label}>{r.label}</span>
                      <span className={s.hint}>{r.path}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {groups.map(({ g, items }) => (
                <Command.Group key={g} heading={g} className={s.group}>
                  {items.map((a) => {
                    const Icon = a.icon;
                    return (
                      <Command.Item
                        key={a.id}
                        value={`${a.label} ${a.keywords ?? ''} ${a.group}`}
                        className={s.item}
                        onSelect={() => {
                          close();
                          setTimeout(() => void a.run(), 0);
                        }}
                      >
                        <span className={s.icon}>{Icon ? <Icon size={14} /> : null}</span>
                        <span className={s.label}>{a.label}</span>
                        {a.shortcut && <Kbd keys={a.shortcut} />}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
