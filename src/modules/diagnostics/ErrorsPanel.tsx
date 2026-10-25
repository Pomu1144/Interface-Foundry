import { OctagonX, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { Badge, Button, EmptyState } from '@/ui';
import { studio, useStudio } from '@/store';
import { art } from '@/app/art';
import { fmtTime } from './ConsolePanel';
import s from './diagnostics.module.css';

/** Runtime errors, unhandled rejections and console errors, grouped by message. */
export function ErrorsPanel() {
  const entries = useStudio((st) => st.console);
  const groups = useMemo(() => {
    const map = new Map<string, { message: string; kind: string; count: number; first: number; last: number; source?: string; stack?: string; instances: Set<string> }>();
    for (const e of entries) {
      if (e.level !== 'error') continue;
      const message = e.args.join(' ');
      const key = `${e.kind}|${message}`;
      const g = map.get(key) ?? { message, kind: e.kind, count: 0, first: e.timestamp, last: e.timestamp, source: e.source, stack: e.stack, instances: new Set<string>() };
      g.count += e.count;
      g.last = e.timestamp;
      g.instances.add(e.instanceId);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.last - a.last);
  }, [entries]);
  if (!groups.length) {
    return (
      <EmptyState art={art.test} title="No runtime errors">
        Uncaught exceptions, unhandled promise rejections, failed resources and console errors from the preview show up here — never hidden, never retried silently.
      </EmptyState>
    );
  }
  return (
    <div style={{ overflow: 'auto', flex: 1 }}>
      {groups.map((g) => (
        <div key={g.kind + g.message} className={s.errCard}>
          <div className={s.errHead}>
            <OctagonX size={14} color="var(--danger)" style={{ flex: 'none', marginTop: 2 }} />
            <div className={s.errTitle}>{g.message}</div>
            <Badge tone="danger">{g.count}×</Badge>
          </div>
          <div className={s.errMeta}>
            <span>{g.kind === 'promise' ? 'Unhandled promise rejection' : g.kind === 'runtime' ? 'Uncaught error' : 'console.error'}</span>
            {g.source && <span>{g.source}</span>}
            <span>
              first {fmtTime(g.first)} · last {fmtTime(g.last)}
            </span>
            <span>{[...g.instances].join(', ')}</span>
            <span style={{ flex: 1 }} />
            <Button
              size="sm"
              variant="violet"
              icon={<Sparkles size={11} />}
              onClick={() => {
                studio().setRightTab('ai');
              }}
            >
              Ask AI
            </Button>
          </div>
          {g.stack && <pre className={s.errStack}>{g.stack}</pre>}
        </div>
      ))}
    </div>
  );
}
