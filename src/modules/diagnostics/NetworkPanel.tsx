import { Ban, ShieldCheck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { NetworkEntry } from '@shared/types';
import { Checkbox, EmptyState, IconButton, Notice, SearchInput, Segmented } from '@/ui';
import { studio, useStudio } from '@/store';
import s from './diagnostics.module.css';

type TypeFilter = 'all' | 'fetch' | 'script' | 'css' | 'img' | 'font' | 'doc' | 'other';

function category(e: NetworkEntry): TypeFilter {
  const t = e.type.toLowerCase();
  if (t === 'fetch' || t === 'xmlhttprequest' || t === 'xhr') return 'fetch';
  if (t === 'script') return 'script';
  if (t === 'link' || t === 'css' || t === 'stylesheet' || /\.css(\?|$)/.test(e.url)) return 'css';
  if (t === 'img' || t === 'image' || /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/.test(e.url)) return 'img';
  if (t === 'font' || /\.(woff2?|ttf|otf)(\?|$)/.test(e.url)) return 'font';
  if (t === 'navigation' || t === 'document' || t === 'iframe') return 'doc';
  return 'other';
}

const fmtSize = (n: number | null) => (n === null ? '—' : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} kB` : `${(n / 1024 / 1024).toFixed(2)} MB`);

function name(url: string) {
  try {
    const u = new URL(url);
    return (u.pathname.split('/').filter(Boolean).pop() ?? u.host) + u.search;
  } catch {
    return url;
  }
}

export function NetworkPanel() {
  const entries = useStudio((st) => st.network);
  const settings = useStudio((st) => st.settings);
  const engine = useStudio((st) => st.instances.primary?.engine);
  const [q, setQ] = useState('');
  const [type, setType] = useState<TypeFilter>('all');
  const [failedOnly, setFailedOnly] = useState(false);
  const [sel, setSel] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      entries.filter((e) => (type === 'all' || category(e) === type) && (!failedOnly || e.failed) && (!q || e.url.toLowerCase().includes(q.toLowerCase()))),
    [entries, type, failedOnly, q],
  );
  const range = useMemo(() => {
    if (!filtered.length) return { min: 0, max: 1 };
    const min = Math.min(...filtered.map((e) => e.startTime));
    const max = Math.max(...filtered.map((e) => e.startTime + Math.max(1, e.duration)));
    return { min, max: Math.max(max, min + 1) };
  }, [filtered]);
  const selected = filtered.find((e) => e.id === sel) ?? null;
  const total = filtered.reduce((n, e) => n + (e.transferSize ?? 0), 0);
  const scope =
    engine === 'remote'
      ? 'Chromium (full request log; headers & bodies never captured)'
      : settings.instrumentNetwork
        ? 'Resource Timing + instrumented fetch/XHR'
        : 'Resource Timing (passive) — methods & failures limited';

  return (
    <div className={s.root}>
      <div className={s.toolbar}>
        <SearchInput className={s.grow} value={q} onChange={setQ} placeholder="Filter URLs" />
        <Segmented
          ariaLabel="Type"
          value={type}
          onChange={setType}
          options={[
            { value: 'all', label: 'All' },
            { value: 'fetch', label: 'Fetch/XHR' },
            { value: 'doc', label: 'Doc' },
            { value: 'css', label: 'CSS' },
            { value: 'script', label: 'JS' },
            { value: 'img', label: 'Img' },
            { value: 'font', label: 'Font' },
            { value: 'other', label: 'Other' },
          ]}
        />
        <Checkbox checked={failedOnly} onChange={setFailedOnly} label="Failed only" />
        <span className={s.spacer} />
        <span className={s.scope} title="Scope of network data available for this preview engine">
          <ShieldCheck size={11} style={{ verticalAlign: -2, marginRight: 4 }} />
          {scope}
        </span>
        <IconButton size="sm" label="Clear" onClick={() => studio().clearNetwork()}>
          <Ban size={13} />
        </IconButton>
      </div>
      <div className={s.split}>
        <div className={s.table}>
          <div className={s.thead}>
            <span>Name</span>
            <span className={s.num}>Status</span>
            <span>Method</span>
            <span>Type</span>
            <span className={s.num}>Size</span>
            <span className={s.num}>Time</span>
            <span>Waterfall</span>
          </div>
          {filtered.length === 0 ? (
            <EmptyState title={entries.length ? 'No matching requests' : 'No requests yet'}>Requests made by the previewed page appear here. Reload the preview to capture page-load requests.</EmptyState>
          ) : (
            filtered.map((e) => {
              const left = ((e.startTime - range.min) / (range.max - range.min)) * 100;
              const width = (Math.max(1, e.duration) / (range.max - range.min)) * 100;
              return (
                <div key={e.id} className={s.trow} data-failed={e.failed ? 'true' : undefined} data-selected={sel === e.id ? 'true' : undefined} onClick={() => setSel(sel === e.id ? null : e.id)} title={e.url}>
                  <span className={s.cellName}>{name(e.url)}</span>
                  <span className={s.num}>{e.status ?? (e.failed ? 'ERR' : '—')}</span>
                  <span>{e.method}</span>
                  <span>{e.type}</span>
                  <span className={s.num}>{fmtSize(e.transferSize)}</span>
                  <span className={s.num}>{e.duration} ms</span>
                  <span className={s.waterfall}>
                    <span className={s.bar} data-type={e.type} style={{ left: `${left}%`, width: `${Math.max(0.5, width)}%` }} />
                  </span>
                </div>
              );
            })
          )}
        </div>
        {selected && (
          <aside className={s.details}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <div className={s.detailsTitle} style={{ flex: 1 }}>
                {selected.url}
              </div>
              <IconButton size="sm" label="Close" onClick={() => setSel(null)}>
                <X size={12} />
              </IconButton>
            </div>
            <dl className={s.kv}>
              <dt>Status</dt>
              <dd>{selected.status ?? 'unknown'}</dd>
              <dt>Method</dt>
              <dd>{selected.method === '—' ? 'unknown (passive timing)' : selected.method}</dd>
              <dt>Type</dt>
              <dd>{selected.type}</dd>
              <dt>Initiator</dt>
              <dd>{selected.initiator ?? '—'}</dd>
              <dt>Started</dt>
              <dd>{Math.round(selected.startTime)} ms</dd>
              <dt>Duration</dt>
              <dd>{selected.duration} ms</dd>
              <dt>Transfer</dt>
              <dd>{fmtSize(selected.transferSize)}</dd>
              <dt>Source</dt>
              <dd>{selected.source}</dd>
              {selected.failureReason && (
                <>
                  <dt>Failure</dt>
                  <dd style={{ color: 'var(--danger)' }}>{selected.failureReason}</dd>
                </>
              )}
            </dl>
            <Notice>Request and response headers, cookies and bodies are never captured. Sensitive query parameters are replaced with REDACTED{selected.redacted ? ' (applied to this URL)' : ''}.</Notice>
          </aside>
        )}
      </div>
      <div className={s.summary}>
        <span>{filtered.length} requests</span>
        <span>{fmtSize(total)} transferred</span>
        <span>{filtered.filter((e) => e.failed).length} failed</span>
      </div>
    </div>
  );
}
