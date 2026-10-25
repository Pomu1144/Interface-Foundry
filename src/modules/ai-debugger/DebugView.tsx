import { useEffect, useMemo, useState } from 'react';
import { Ban, Check, Columns2, FlaskConical, MoveHorizontal, Pencil, Ruler, X } from 'lucide-react';
import type { CssDeclaration, MatchedRule, NodeInfo, StylesPayload } from '@shared/types';
import { Badge, Button, IconButton, Section, Segmented, Spinner } from '@/ui';
import { studio, useStudio } from '@/store';
import { previews } from '@/modules/preview-runtime/registry';
import { discardExperimentAction, experimentBreakpoint, experimentDisable, experimentStyle, experimentValue, promoteExperimentAction } from './engine';
import { otherViewportState } from './probe';
import { useAi, type Experiment } from './state';
import { VerdictRow } from './ResultView';
import s from './ai.module.css';

/**
 * Root-cause debugging mode (spec §10): everything that decides this element's
 * box in one place, with one-click reversible experiments that are measured
 * before/after and listed separately from committed changes.
 */

const LAYOUT_PROPS = /^(display|position|top|right|bottom|left|inset.*|float|clear|z-index|box-sizing|(min-|max-)?(width|height)|(min-|max-)?(inline|block)-size|margin.*|padding.*|flex.*|grid.*|gap|row-gap|column-gap|justify-.*|align-.*|place-.*|order|overflow.*|white-space|text-overflow|overflow-wrap|word-break|transform|translate|scale|aspect-ratio|contain|visibility|columns|column-.*|font-size|line-height|letter-spacing)$/;

function useDebugData(info: NodeInfo | null) {
  const changes = useStudio((st) => st.changes.length);
  const [data, setData] = useState<{ styles: StylesPayload | null; parent: NodeInfo | null; loading: boolean; error?: string }>({ styles: null, parent: null, loading: false });
  useEffect(() => {
    if (!info) return;
    let alive = true;
    const conn = previews.get(studio().selection.instanceId) ?? previews.primary();
    if (!conn?.ready) {
      setData({ styles: null, parent: null, loading: false, error: 'No preview is connected.' });
      return;
    }
    setData((d) => ({ ...d, loading: true }));
    const parentId = info.path.at(-2)?.id;
    Promise.all([conn.call('node.styles', { id: info.id }), parentId !== undefined ? conn.call('node.info', { id: parentId }).catch(() => null) : Promise.resolve(null)])
      .then(([styles, parent]) => alive && setData({ styles, parent, loading: false }))
      .catch((err: Error) => alive && setData({ styles: null, parent: null, loading: false, error: err.message }));
    return () => {
      alive = false;
    };
  }, [info, changes]);
  return data;
}

function KV({ rows }: { rows: [string, string | undefined | null][] }) {
  return (
    <div className={s.kv}>
      {rows.map(([k, v]) => (
        <span key={k} style={{ display: 'contents' }}>
          <span className={s.k} title={k}>
            {k}
          </span>
          <span className={s.v} data-dim={!v || v === 'none' || v === 'auto' || v === 'normal' || v === '0px' ? 'true' : undefined} title={v ?? ''}>
            {v || '—'}
          </span>
        </span>
      ))}
    </div>
  );
}

const px = (n: number) => `${Math.round(n * 10) / 10}px`;
const ins = (i: { top: number; right: number; bottom: number; left: number }) => `${Math.round(i.top)} ${Math.round(i.right)} ${Math.round(i.bottom)} ${Math.round(i.left)}`;

function Decl({ rule, d }: { rule: MatchedRule; d: CssDeclaration }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(d.value);
  const isWidth = /^(min-|max-)?width$/.test(d.property);
  return (
    <div className={s.decl} data-overridden={d.overridden ? 'true' : undefined} data-disabled={d.disabled ? 'true' : undefined}>
      {editing ? (
        <input
          className={s.declEdit}
          autoFocus
          value={draft}
          aria-label={`New value for ${d.property}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim() && draft !== d.value) {
              setEditing(false);
              void experimentValue(rule, d.property, d.value, draft.trim());
            } else if (e.key === 'Escape') {
              setEditing(false);
              setDraft(d.value);
            }
          }}
          onBlur={() => setEditing(false)}
        />
      ) : (
        <span className={s.declText} title={`${d.property}: ${d.value}${d.important ? ' !important' : ''}${d.overridden ? ' (overridden)' : ''}${d.disabled ? ' (disabled by an experiment)' : ''}`}>
          <span className={s.declProp}>{d.property}</span>: <span className={s.declVal}>{d.value}</span>
          {d.important ? ' !important' : ''}
        </span>
      )}
      {d.overridden && !editing && <Badge tone="outline">overridden</Badge>}
      {d.disabled && !editing && <Badge tone="violet">disabled</Badge>}
      {!editing && !d.disabled && (
        <span className={s.declActions}>
          {isWidth && (
            <IconButton size="sm" label={d.property === 'min-width' ? 'Try min-width: 0' : `Try ${d.property}: auto`} onClick={() => void experimentValue(rule, d.property, d.value, d.property === 'min-width' ? '0' : d.property === 'max-width' ? '100%' : 'auto')}>
              <MoveHorizontal size={11} />
            </IconButton>
          )}
          <IconButton size="sm" label="Change value (experiment)" onClick={() => setEditing(true)}>
            <Pencil size={11} />
          </IconButton>
          <IconButton size="sm" label="Disable declaration (experiment)" onClick={() => void experimentDisable(rule, d.property, d.value)}>
            <Ban size={11} />
          </IconButton>
        </span>
      )}
    </div>
  );
}

function MediaRow({ rule }: { rule: MatchedRule }) {
  const media = (rule.media ?? []).join(' and ');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(media);
  return (
    <div className={s.mediaRow}>
      {editing ? (
        <input
          className={s.declEdit}
          autoFocus
          value={draft}
          aria-label="New media query"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim() && draft.trim() !== media) {
              setEditing(false);
              void experimentBreakpoint(rule, draft.trim().replace(/^@media\s+/i, ''));
            } else if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={() => setEditing(false)}
        />
      ) : (
        <>
          <span className={s.ruleMedia} title={media}>
            @media {media}
          </span>
          <span className={s.ruleSel} title={rule.selector}>
            {rule.selector}
          </span>
          <span style={{ marginLeft: 'auto' }}>
            <IconButton size="sm" label="Adjust breakpoint (re-apply under another media query)" onClick={() => setEditing(true)}>
              <Ruler size={11} />
            </IconButton>
          </span>
        </>
      )}
    </div>
  );
}

function ExperimentRow({ e }: { e: Experiment }) {
  const live = e.status === 'active' || e.status === 'measuring';
  return (
    <div className={s.exp} data-status={e.status}>
      <div className={s.expHead}>
        <FlaskConical size={12} />
        <span className={s.expLabel} title={e.label}>
          {e.label}
        </span>
        {e.status === 'measuring' && <Spinner size={10} />}
        {e.status === 'promoted' && <Badge tone="success">kept</Badge>}
        {e.status === 'discarded' && <Badge tone="outline">discarded</Badge>}
        {e.status === 'gone' && <Badge tone="outline">undone</Badge>}
      </div>
      <div className={s.expDetail} title={e.detail}>
        {e.detail}
      </div>
      {e.result && live && <VerdictRow result={e.result} />}
      {e.error && <div className={s.muted}>{e.error}</div>}
      {live && (
        <div className={s.actions}>
          <Button size="sm" variant="violet" icon={<Check size={12} />} disabled={e.status === 'measuring'} onClick={() => promoteExperimentAction(e.id)}>
            Keep
          </Button>
          <Button size="sm" variant="ghost" icon={<X size={12} />} onClick={() => discardExperimentAction(e.id)}>
            Discard
          </Button>
        </div>
      )}
    </div>
  );
}

export function DebugView({ info }: { info: NodeInfo }) {
  const { styles, parent, loading, error } = useDebugData(info);
  const experiments = useAi((x) => x.experiments);
  const consoleAll = useStudio((st) => st.console);
  const consoleErrors = useMemo(() => consoleAll.filter((e) => e.level === 'error').slice(-5), [consoleAll]);
  const [all, setAll] = useState<'layout' | 'all'>('layout');
  const c = info.computed;
  const other = otherViewportState();
  const rules = useMemo(() => {
    if (!styles) return [];
    const list = [...(styles.inline ? [styles.inline] : []), ...styles.matched.filter((r) => r.origin !== 'user-agent')];
    return list
      .map((r) => ({ rule: r, decls: r.declarations.filter((d) => all === 'all' || LAYOUT_PROPS.test(d.property)) }))
      .filter((x) => x.decls.length);
  }, [styles, all]);
  const mediaRules = styles?.matched.filter((r) => r.media?.length && r.origin === 'author') ?? [];
  const mine = experiments.filter((e) => e.selector === info.selector);

  return (
    <div className={s.debug}>
      <div className={s.quick} aria-label="Quick experiments">
        <Button size="sm" icon={<MoveHorizontal size={12} />} onClick={() => void experimentStyle('width', 'width: auto', [{ property: 'width', value: 'auto', before: c.width ?? null }])}>
          width: auto
        </Button>
        <Button size="sm" icon={<MoveHorizontal size={12} />} onClick={() => void experimentStyle('width', 'max-width: 100%', [{ property: 'max-width', value: '100%', before: c['max-width'] ?? null }])}>
          max-width: 100%
        </Button>
        <Button size="sm" icon={<MoveHorizontal size={12} />} onClick={() => void experimentStyle('min-width', 'min-width: 0', [{ property: 'min-width', value: '0', before: c['min-width'] ?? null }])}>
          min-width: 0
        </Button>
        <Button size="sm" variant="ghost" icon={<Columns2 size={12} />} onClick={() => studio().setCompare({ enabled: true, partner: other.state })} title="Show the other posture side by side">
          Compare {other.label}
        </Button>
      </div>

      <Section id="ai-debug-experiments" title={<>Experiments{mine.length ? ` · ${mine.length}` : ''}</>}>
        {mine.length ? (
          mine.map((e) => <ExperimentRow key={e.id} e={e} />)
        ) : (
          <div className={s.muted}>One-click trials are recorded as experiments, measured before and after (overflow, hinge, issues), and kept apart from committed changes until you keep them.</div>
        )}
      </Section>

      <Section id="ai-debug-dimensions" title="Computed dimensions">
        <KV
          rows={[
            ['border box', `${px(info.rect.width)} × ${px(info.rect.height)}`],
            ['content box', `${px(info.box.content.width)} × ${px(info.box.content.height)}`],
            ['position (x, y)', `${Math.round(info.rect.x)}, ${Math.round(info.rect.y)}`],
            ['padding', ins(info.box.padding)],
            ['border', ins(info.box.border)],
            ['margin', ins(info.box.margin)],
            ['box-sizing', info.box.boxSizing],
            ['width', c.width],
            ['min-width', c['min-width']],
            ['max-width', c['max-width']],
            ['height', c.height],
            ['display', c.display],
          ]}
        />
      </Section>

      <Section id="ai-debug-parent" title="Parent layout & constraints">
        <KV
          rows={[
            ['parent', parent?.label ?? info.path.at(-2)?.label ?? '—'],
            ['parent display', info.layout.parentDisplay],
            ['parent width', parent ? px(parent.box.content.width) + ' content' : undefined],
            ...(parent?.computed['grid-template-columns'] && parent.computed['grid-template-columns'] !== 'none' ? ([['grid columns', parent.computed['grid-template-columns']]] as [string, string][]) : []),
            ...(info.layout.isFlexItem || info.layout.isGridItem ? ([['gap', parent?.computed.gap]] as [string, string | undefined][]) : []),
            ...(info.layout.isFlexItem
              ? ([
                  ['flex-direction', info.layout.flexDirection],
                  ['flex', `${c['flex-grow']} ${c['flex-shrink']} ${c['flex-basis']}`],
                  ['align-self', c['align-self']],
                ] as [string, string | undefined][])
              : []),
            ...(info.layout.isGridItem
              ? ([
                  ['grid-column', c['grid-column']],
                  ['grid-row', c['grid-row']],
                ] as [string, string | undefined][])
              : []),
          ]}
        />
      </Section>

      <Section id="ai-debug-position" title="Positioning & overflow">
        <KV
          rows={[
            ['position', c.position],
            ['offsets', `${c.top} ${c.right} ${c.bottom} ${c.left}`],
            ['transform', c.transform],
            ['z-index', c['z-index']],
            ['overflow', `${c['overflow-x']} / ${c['overflow-y']}`],
            ['white-space', c['white-space']],
          ]}
        />
        <div className={s.subhead}>Overflow ancestors</div>
        {info.layout.overflowAncestors.length ? (
          <KV rows={info.layout.overflowAncestors.map((a) => [a.label, a.overflow] as [string, string])} />
        ) : (
          <div className={s.muted}>No ancestor clips overflow.</div>
        )}
      </Section>

      <Section
        id="ai-debug-decls"
        title="Relevant declarations"
        actions={<Segmented ariaLabel="Declaration filter" value={all} onChange={setAll} options={[{ value: 'layout', label: 'Layout' }, { value: 'all', label: 'All' }]} />}
      >
        {loading && !styles ? (
          <div className={s.muted} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Spinner size={10} /> Reading the cascade…
          </div>
        ) : error ? (
          <div className={s.muted}>{error}</div>
        ) : rules.length ? (
          rules.map(({ rule, decls }) => (
            <div key={rule.key + rule.selector} className={s.rule}>
              <div className={s.ruleHead}>
                <span className={s.ruleSel} title={rule.selector}>
                  {rule.selector}
                </span>
                <span className={s.ruleSrc}>{rule.origin === 'inline' ? 'inline' : `${rule.source.label}${rule.source.line ? `:${rule.source.line}` : ''}`}</span>
              </div>
              {rule.media?.length ? <span className={s.ruleMedia}>@media {rule.media.join(' and ')}</span> : null}
              {decls.map((d) => (
                <Decl key={d.property + d.value} rule={rule} d={d} />
              ))}
            </div>
          ))
        ) : (
          <div className={s.muted}>No author declarations{all === 'layout' ? ' for layout properties' : ''}.</div>
        )}
        {styles?.inaccessibleSheets.length ? <div className={s.muted}>{styles.inaccessibleSheets.length} cross-origin stylesheet(s) could not be read.</div> : null}
      </Section>

      <Section id="ai-debug-media" title={<>Active media queries{styles ? ` · ${styles.activeMedia.length}` : ''}</>}>
        {mediaRules.length ? (
          <>
            <div className={s.subhead} style={{ marginTop: 0 }}>
              Applying to this element
            </div>
            {mediaRules.map((r) => (
              <MediaRow key={r.key} rule={r} />
            ))}
          </>
        ) : (
          <div className={s.muted}>No media-query rule styles this element at this viewport.</div>
        )}
        {styles && styles.activeMedia.length > 0 && (
          <>
            <div className={s.subhead}>Active on the page</div>
            <div className={s.evidence}>
              {styles.activeMedia.slice(0, 16).map((m) => (
                <span key={m} className={s.ev} title={m}>
                  {m}
                </span>
              ))}
            </div>
          </>
        )}
      </Section>

      <Section id="ai-debug-inherited" title="Inherited styles" defaultOpen={false}>
        {styles?.inherited.length ? (
          styles.inherited.slice(0, 4).map((h) => (
            <div key={h.from.id} className={s.rule}>
              <div className={s.subhead} style={{ marginTop: 0 }}>
                from {h.from.label}
              </div>
              <KV rows={h.rules.flatMap((r) => r.declarations.filter((d) => !d.overridden).map((d) => [d.property, d.value] as [string, string])).slice(0, 8)} />
            </div>
          ))
        ) : (
          <div className={s.muted}>No inherited declarations from ancestors.</div>
        )}
      </Section>

      <Section id="ai-debug-console" title={<>Related console errors{consoleErrors.length ? ` · ${consoleErrors.length}` : ''}</>} defaultOpen={false}>
        {consoleErrors.length ? (
          consoleErrors.map((e) => (
            <div key={e.id} className={s.item}>
              <span className={s.bullet} style={{ background: 'var(--danger)' }} />
              <p className={s.mono} style={{ color: 'var(--text-1)' }}>
                {e.args.join(' ').slice(0, 240)}
                {e.source ? <span style={{ color: 'var(--text-3)' }}> — {e.source}</span> : null}
              </p>
            </div>
          ))
        ) : (
          <div className={s.muted}>No console errors from this preview.</div>
        )}
      </Section>
    </div>
  );
}
