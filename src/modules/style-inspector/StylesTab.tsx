import clsx from 'clsx';
import { FlaskConical, Info, Plus } from 'lucide-react';
import { useState } from 'react';
import type { CssDeclaration, MatchedRule } from '@shared/types';
import { Badge, IconButton, Notice, SearchInput, Spinner, Switch, Tooltip } from '@/ui';
import { bus } from '@/lib/events';
import { studio } from '@/store';
import { setRuleDeclaration, setStyle } from '@/modules/change-manager/edit';
import { useNodeStyles } from './hooks';
import s from './styles.module.css';

export function StylesTab() {
  const { styles, loading, error } = useNodeStyles();
  const [filter, setFilter] = useState('');
  const [experiment, setExperiment] = useState(false);
  if (error) return <div style={{ padding: 12 }}><Notice tone="danger">{error}</Notice></div>;
  if (!styles) return <div style={{ padding: 16, display: 'grid', placeItems: 'center' }}><Spinner /></div>;
  const f = filter.trim().toLowerCase();
  const visible = (d: CssDeclaration) => !f || d.property.includes(f) || d.value.toLowerCase().includes(f);
  return (
    <div className={s.root}>
      <div className={s.toolbar}>
        <SearchInput value={filter} onChange={setFilter} placeholder="Filter properties" />
        <Tooltip content="Record rule edits as reversible experiments (kept separate from committed changes)">
          <label className={s.experiment} data-on={experiment ? 'true' : undefined}>
            <FlaskConical size={12} />
            <Switch ariaLabel="Experiment mode" checked={experiment} onChange={setExperiment} />
          </label>
        </Tooltip>
        {loading && <Spinner size={10} />}
      </div>
      <div className={s.note}>
        <Info size={11} /> Rule edits change the stylesheet rule and affect every element it matches. Use the Design tab for element-only overrides.
      </div>

      <RuleCard
        rule={
          styles.inline ?? {
            key: 'inline',
            selector: 'element.style',
            origin: 'inline',
            specificity: [1, 0, 0],
            source: { label: 'inline', sheetIndex: -1 },
            declarations: [],
            order: 0,
          }
        }
        visible={visible}
        experiment={experiment}
        inline
      />
      {styles.matched.map((r) => (
        <RuleCard key={r.key + r.selector} rule={r} visible={visible} experiment={experiment} />
      ))}
      {styles.inherited.map((group) => (
        <div key={group.from.id}>
          <div className={s.inheritedHead}>
            Inherited from <span className={s.inheritedFrom}>{group.from.label}</span>
          </div>
          {group.rules.map((r) => (
            <RuleCard key={r.key + r.selector} rule={r} visible={visible} experiment={experiment} dim />
          ))}
        </div>
      ))}
      {styles.variables.length > 0 && (
        <div className={s.block}>
          <div className={s.blockTitle}>CSS variables in use</div>
          {styles.variables.map((v) => (
            <div key={v.name} className={s.varRow}>
              <span className={s.prop}>{v.name}</span>
              <span className={s.colon}>:</span>
              <ValueWithSwatch value={v.value} />
              <span className={s.varFrom}>{v.definedOn}</span>
            </div>
          ))}
        </div>
      )}
      {styles.activeMedia.length > 0 && (
        <div className={s.block}>
          <div className={s.blockTitle}>Active media queries</div>
          {styles.activeMedia.map((m) => (
            <div key={m} className={s.media}>
              @media {m}
            </div>
          ))}
        </div>
      )}
      {styles.inaccessibleSheets.length > 0 && (
        <div style={{ padding: '0 12px 12px' }}>
          <Notice tone="warning">
            {styles.inaccessibleSheets.length} cross-origin stylesheet{styles.inaccessibleSheets.length > 1 ? 's' : ''} cannot be read from the page (browser security). Their rules are not listed: {styles.inaccessibleSheets.slice(0, 3).join(', ')}
          </Notice>
        </div>
      )}
    </div>
  );
}

function RuleCard({ rule, visible, experiment, inline, dim }: { rule: MatchedRule; visible: (d: CssDeclaration) => boolean; experiment: boolean; inline?: boolean; dim?: boolean }) {
  const [adding, setAdding] = useState(false);
  const decls = rule.declarations.filter(visible);
  if (!inline && !decls.length) return null;
  const commit = (d: CssDeclaration | null, prop: string, value: string | null) => {
    if (inline || rule.origin === 'override') {
      if (value !== null) setStyle(prop, value, 'styles');
      return;
    }
    const st = studio();
    const existing = [...st.changes].reverse().find((c) => c.kind === 'rule' && c.target.ruleKey === rule.key && c.target.ruleSelector === rule.selector && c.property === prop);
    // Re-enabling or restoring the original value simply removes IFDY's edit.
    if (existing && value !== null && value === existing.before) {
      st.removeChange(existing.id);
      return;
    }
    setRuleDeclaration(rule, prop, value, existing?.before ?? d?.value ?? null, experiment ? 'experiment' : 'styles', experiment);
  };
  return (
    <div className={clsx(s.rule, dim && s.dim, rule.origin === 'override' && s.override)}>
      <div className={s.ruleHead}>
        <span className={s.selector}>{rule.selector}</span>
        <span className={s.brace}>{' {'}</span>
        <span className={s.spacer} />
        {rule.origin === 'override' ? (
          <Badge tone="molten">IFDY override</Badge>
        ) : (
          <button
            className={s.source}
            title={rule.source.href ?? rule.source.label}
            onClick={() => rule.source.href && bus.emit('reveal-in-editor', { file: new URL(rule.source.href).pathname, line: rule.source.line })}
          >
            {rule.source.label}
            {rule.source.line ? `:${rule.source.line}` : ''}
          </button>
        )}
      </div>
      {(rule.media || rule.layer) && (
        <div className={s.ruleMeta}>
          {rule.media?.map((m) => (
            <span key={m} className={s.mediaChip}>
              @media {m}
            </span>
          ))}
          {rule.layer && <span className={s.mediaChip}>@layer {rule.layer}</span>}
        </div>
      )}
      {decls.map((d, i) => (
        <DeclRow key={`${d.property}-${i}`} d={d} onToggle={(on) => commit(d, d.property, on ? d.value : null)} onEdit={(v) => commit(d, d.property, v)} canToggle={!inline && rule.origin === 'author'} />
      ))}
      {adding && (
        <NewDecl
          onDone={(p, v) => {
            setAdding(false);
            if (p && v) commit(null, p, v);
          }}
        />
      )}
      <div className={s.ruleFoot}>
        <span className={s.brace}>{'}'}</span>
        {!dim && (
          <IconButton size="sm" label="Add declaration" onClick={() => setAdding(true)}>
            <Plus size={12} />
          </IconButton>
        )}
      </div>
    </div>
  );
}

function DeclRow({ d, onToggle, onEdit, canToggle }: { d: CssDeclaration; onToggle: (on: boolean) => void; onEdit: (v: string) => void; canToggle: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(d.value);
  return (
    <div className={clsx(s.decl, d.overridden && s.overridden, d.disabled && s.disabled)} title={d.overridden ? 'Overridden by a higher-priority declaration' : undefined}>
      {canToggle ? (
        <input type="checkbox" className={s.check} checked={!d.disabled} onChange={(e) => onToggle(e.target.checked)} aria-label={`Toggle ${d.property}`} />
      ) : (
        <span className={s.checkSpacer} />
      )}
      <span className={s.prop}>{d.property}</span>
      <span className={s.colon}>:</span>
      {editing ? (
        <input
          className={s.valueInput}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft !== d.value) onEdit(draft);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setDraft(d.value);
              setEditing(false);
            }
          }}
          spellCheck={false}
        />
      ) : (
        <span
          className={s.valueWrap}
          onClick={() => {
            if (d.disabled) return;
            setDraft(d.value);
            setEditing(true);
          }}
        >
          <ValueWithSwatch value={d.value} />
          {d.important && <span className={s.important}> !important</span>}
        </span>
      )}
      <span className={s.semi}>;</span>
      {d.modified && <span className={s.modDot} title="Edited in IFDY" />}
    </div>
  );
}

function NewDecl({ onDone }: { onDone: (prop: string | null, value: string | null) => void }) {
  const [prop, setProp] = useState('');
  const [value, setValue] = useState('');
  return (
    <div className={s.decl}>
      <span className={s.checkSpacer} />
      <input className={s.propInput} autoFocus placeholder="property" value={prop} onChange={(e) => setProp(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onDone(null, null)} spellCheck={false} />
      <span className={s.colon}>:</span>
      <input
        className={s.valueInput}
        placeholder="value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onDone(prop.trim(), value.trim());
          if (e.key === 'Escape') onDone(null, null);
        }}
        onBlur={() => onDone(prop.trim() || null, value.trim() || null)}
        spellCheck={false}
      />
    </div>
  );
}

const COLOR_RE = /((?<![\w-])#[0-9a-f]{3,8}\b|(?<![\w-])(?:rgba?|hsla?|oklch|oklab)\([^)]*\)|(?<![\w-])(?:red|blue|white|black|green|orange|purple|gray|grey|navy|teal|gold)(?![\w-]))/gi;

function ValueWithSwatch({ value }: { value: string }) {
  const parts = value.split(COLOR_RE);
  return (
    <span className={s.value}>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i}>
            <span className={s.swatch} style={{ background: p }} />
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}

