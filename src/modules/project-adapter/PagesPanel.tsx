import { ExternalLink, FileText, Hash, Plus } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, IconButton, TextField } from '@/ui';
import { studio, useStudio } from '@/store';
import { art } from '@/app/art';
import { copyText } from '@/modules/canvas/clipboard';
import { sourceUrl } from './source';
import s from './pages.module.css';

export function PagesPanel() {
  const routes = useStudio((st) => st.routes);
  const current = useStudio((st) => st.currentRoute);
  const source = useStudio((st) => st.source);
  const [adding, setAdding] = useState(false);
  if (!routes.length) return <EmptyState art={art.code} title="No pages">Pages and routes of the project appear here.</EmptyState>;
  const groups = [...new Set(routes.map((r) => r.group ?? 'Pages'))];
  return (
    <div className={s.root}>
      {groups.map((g) => (
        <div key={g}>
          <div className={s.group}>{g}</div>
          {routes
            .filter((r) => (r.group ?? 'Pages') === g)
            .map((r) => (
              <button key={r.id} className={s.item} data-active={r.path === current ? 'true' : undefined} onClick={() => studio().setCurrentRoute(r.path)}>
                {r.path.startsWith('#') ? <Hash size={13} /> : <FileText size={13} />}
                <span className={s.label}>{r.label}</span>
                <span className={s.path}>{r.path.length > 22 ? '…' + r.path.slice(-21) : r.path}</span>
              </button>
            ))}
        </div>
      ))}
      <div className={s.footer}>
        {adding ? (
          <TextField
            value=""
            placeholder="#/route or page.html"
            autoFocus
            onCommit={(v) => {
              setAdding(false);
              const path = v.trim();
              if (!path) return;
              studio().setRoutes([...routes, { id: `custom-${Date.now()}`, label: path, path, group: 'Custom' }]);
              studio().setCurrentRoute(path);
            }}
          />
        ) : (
          <>
            <IconButton size="sm" label="Add route" onClick={() => setAdding(true)}>
              <Plus size={13} />
            </IconButton>
            {source && (
              <IconButton size="sm" label="Copy preview URL" onClick={() => copyText(sourceUrl(source, current), 'Preview URL copied')}>
                <ExternalLink size={13} />
              </IconButton>
            )}
          </>
        )}
      </div>
    </div>
  );
}
