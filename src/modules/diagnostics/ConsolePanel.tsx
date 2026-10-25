import { useVirtualizer } from '@tanstack/react-virtual';
import { AlertTriangle, Ban, Bug, Info, MessageSquare, OctagonX, Regex } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConsoleEntry, LogLevel } from '@shared/types';
import { EmptyState, IconButton, SearchInput, Segmented, Tooltip } from '@/ui';
import { studio, useStudio } from '@/store';
import s from './diagnostics.module.css';

type LevelFilter = 'all' | 'error' | 'warn' | 'info' | 'log' | 'debug';

export const fmtTime = (ts: number) => {
  const d = new Date(ts);
  return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};

const ICON: Record<LogLevel, typeof Info> = { error: OctagonX, warn: AlertTriangle, info: Info, log: MessageSquare, debug: Bug };

export function ConsolePanel() {
  const entries = useStudio((st) => st.console);
  const [level, setLevel] = useState<LevelFilter>('all');
  const [q, setQ] = useState('');
  const [regex, setRegex] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const filtered = useMemo(() => {
    let re: RegExp | null = null;
    if (q && regex) {
      try {
        re = new RegExp(q, 'i');
      } catch {
        re = null;
      }
    }
    return entries.filter((e) => {
      if (level !== 'all' && e.level !== level) return false;
      if (!q) return true;
      const text = e.args.join(' ') + ' ' + (e.source ?? '');
      return re ? re.test(text) : text.toLowerCase().includes(q.toLowerCase());
    });
  }, [entries, level, q, regex]);

  const virtual = useVirtualizer({ count: filtered.length, getScrollElement: () => ref.current, estimateSize: () => 26, overscan: 10 });

  useEffect(() => {
    if (stick.current && filtered.length) virtual.scrollToIndex(filtered.length - 1, { align: 'end' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered.length]);

  const counts = useMemo(() => {
    const c = { error: 0, warn: 0 };
    for (const e of entries) {
      if (e.level === 'error') c.error += e.count;
      if (e.level === 'warn') c.warn += e.count;
    }
    return c;
  }, [entries]);

  return (
    <div className={s.root}>
      <div className={s.toolbar}>
        <Segmented
          ariaLabel="Level"
          value={level}
          onChange={setLevel}
          options={[
            { value: 'all', label: 'All' },
            { value: 'error', label: `Errors${counts.error ? ` ${counts.error}` : ''}` },
            { value: 'warn', label: `Warnings${counts.warn ? ` ${counts.warn}` : ''}` },
            { value: 'info', label: 'Info' },
            { value: 'log', label: 'Logs' },
            { value: 'debug', label: 'Debug' },
          ]}
        />
        <SearchInput
          className={s.grow}
          value={q}
          onChange={setQ}
          placeholder={regex ? 'Filter (regex)' : 'Filter messages'}
          trailing={
            <Tooltip content="Use regular expression">
              <button
                onClick={() => setRegex(!regex)}
                aria-pressed={regex}
                style={{ border: 0, background: regex ? 'var(--accent-soft)' : 'transparent', color: regex ? 'var(--accent-strong)' : 'var(--text-3)', borderRadius: 4, display: 'grid', placeItems: 'center', width: 18, height: 18 }}
              >
                <Regex size={12} />
              </button>
            </Tooltip>
          }
        />
        <span className={s.spacer} />
        <span className={s.scope}>Captured by the preview agent · values redacted</span>
        <IconButton size="sm" label="Clear console" onClick={() => studio().clearConsole()}>
          <Ban size={13} />
        </IconButton>
      </div>
      <div
        ref={ref}
        className={s.list}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {filtered.length === 0 ? (
          <EmptyState title={entries.length ? 'No matching messages' : 'Console is empty'}>Messages, warnings and errors from the previewed page appear here.</EmptyState>
        ) : (
          <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
            {virtual.getVirtualItems().map((vi) => (
              <LogRow key={filtered[vi.index].id} entry={filtered[vi.index]} start={vi.start} measure={virtual.measureElement} index={vi.index} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LogRow({ entry: e, start, measure, index }: { entry: ConsoleEntry; start: number; measure: (el: Element | null) => void; index: number }) {
  const [open, setOpen] = useState(false);
  const Icon = ICON[e.level];
  return (
    <div ref={measure} data-index={index} className={s.logRow} data-level={e.level} style={{ transform: `translateY(${start}px)` }} onClick={() => e.stack && setOpen(!open)}>
      <span className={s.time}>{fmtTime(e.timestamp)}</span>
      <Icon size={12} className={s.levelIcon} />
      <span className={s.message}>
        {e.kind !== 'console' && <b>{e.kind === 'promise' ? 'Unhandled rejection · ' : 'Uncaught · '}</b>}
        {e.args.join(' ')}
        {open && e.stack && <div className={s.stack}>{e.stack}</div>}
      </span>
      {e.count > 1 && <span className={s.count}>{e.count}</span>}
      {e.instanceId !== 'primary' && <span className={s.instance}>{e.instanceId}</span>}
      {e.source && <span className={s.source}>{e.source}</span>}
    </div>
  );
}
