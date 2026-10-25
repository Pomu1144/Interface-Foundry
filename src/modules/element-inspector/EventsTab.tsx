import { Settings2, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ListenerInfo } from '@shared/protocol';
import { Badge, Button, EmptyState, Notice, Spinner } from '@/ui';
import { studio, useStudio } from '@/store';
import { previews } from '@/modules/preview-runtime/registry';
import s from './events.module.css';

/** Event listeners on the selection and its ancestors, with the exact scope of what can be seen. */
export function EventsTab() {
  const nodeId = useStudio((st) => st.selection.nodeId);
  const instanceId = useStudio((st) => st.selection.instanceId);
  const instrumented = useStudio((st) => st.settings.instrumentEvents);
  const engine = useStudio((st) => st.instances[st.selection.instanceId ?? 'primary']?.engine);
  const [list, setList] = useState<ListenerInfo[] | null>(null);
  useEffect(() => {
    if (nodeId === null) return;
    const conn = previews.get(instanceId);
    if (!conn?.ready) return;
    setList(null);
    conn
      .call('node.listeners', { id: nodeId })
      .then(setList)
      .catch(() => setList([]));
  }, [nodeId, instanceId, instrumented]);

  const groups = new Map<string, ListenerInfo[]>();
  for (const l of list ?? []) {
    const k = l.on.label;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  return (
    <div className={s.root}>
      <div className={s.scope}>
        {instrumented ? (
          <Notice>
            <b>Instrumented listeners.</b> addEventListener was wrapped inside the preview before page scripts ran, so listeners registered by the app are listed with their options and handler source.
          </Notice>
        ) : (
          <Notice tone="warning">
            <b>Inline handlers only.</b> Browsers do not expose listeners added with addEventListener to page scripts. Enable instrumentation to list them — it wraps addEventListener inside the preview only and reloads it.
            <div style={{ marginTop: 8 }}>
              <Button size="sm" icon={<Settings2 size={12} />} onClick={() => studio().updateSettings({ instrumentEvents: true })}>
                Enable listener instrumentation
              </Button>
            </div>
          </Notice>
        )}
        {engine === 'remote' && <div className={s.hint}>Controlled Chromium could enumerate every listener via DevTools protocol; this view shows what the agent can see.</div>}
      </div>
      {list === null ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: 20 }}>
          <Spinner />
        </div>
      ) : list.length === 0 ? (
        <EmptyState title="No listeners found">{instrumented ? 'Nothing is listening on this element or its ancestors.' : 'No inline on* handlers on this element or its ancestors.'}</EmptyState>
      ) : (
        [...groups].map(([label, items]) => (
          <div key={label} className={s.group}>
            <div className={s.groupHead}>{label}</div>
            {items.map((l, i) => (
              <details key={i} className={s.item}>
                <summary>
                  <Zap size={11} className={s.bolt} />
                  <span className={s.type}>{l.type}</span>
                  <Badge tone="outline">{l.source}</Badge>
                  {l.capture && <Badge tone="accent">capture</Badge>}
                  {l.passive && <Badge>passive</Badge>}
                  {l.once && <Badge>once</Badge>}
                </summary>
                <pre className={s.handler}>{l.handler}</pre>
              </details>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
