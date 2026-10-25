import { useMemo, useState } from 'react';
import type { StylesPayload } from '@shared/types';
import { Checkbox, SearchInput, Spinner } from '@/ui';
import { copyText } from '@/modules/canvas/clipboard';
import { useComputed, useNodeStyles } from './hooks';
import s from './computed.module.css';

const GROUPS: { title: string; test: (p: string) => boolean }[] = [
  { title: 'Layout', test: (p) => /^(display|position|top|right|bottom|left|z-index|float|clear|box-sizing|width|height|min-|max-|margin|padding|overflow|inset|aspect-ratio|contain|visibility)/.test(p) },
  { title: 'Flex & grid', test: (p) => /^(flex|grid|gap|row-gap|column-gap|justify|align|order|place-)/.test(p) },
  { title: 'Typography', test: (p) => /^(font|line-height|letter-spacing|word|text|white-space|color|direction|writing-mode|hyphens|tab-size|vertical-align)/.test(p) },
  { title: 'Appearance', test: (p) => /^(background|border|outline|box-shadow|opacity|filter|backdrop|mix-blend|clip|mask|object|image|cursor|appearance|accent|caret)/.test(p) },
  { title: 'Motion & transforms', test: (p) => /^(transform|transition|animation|perspective|translate|rotate|scale|will-change|offset)/.test(p) },
];

/** Values that are the CSS initial value for common properties (hidden in compact mode). */
function isDefault(prop: string, value: string): boolean {
  if (!value) return true;
  if (/^(0px|none|normal|auto|0s|visible|static|ease|1|running|0px 0px|0% 0%|0px none|rgba\(0, 0, 0, 0\)|currentcolor|start|stretch|baseline|ltr|repeat|scroll|border-box|padding-box|separate|show|both|medium|horizontal-tb|manual|content-box)$/.test(value)) return true;
  if (prop.startsWith('-webkit-') || prop.startsWith('--')) return true;
  return false;
}

function winningSource(styles: StylesPayload | null, prop: string): string | null {
  if (!styles) return null;
  const rules = [...(styles.inline ? [styles.inline] : []), ...styles.matched];
  for (const r of rules) {
    const d = r.declarations.find((x) => !x.overridden && !x.disabled && (x.property === prop || prop.startsWith(x.property + '-')));
    if (d) return r.origin === 'inline' ? 'element.style' : r.origin === 'override' ? 'IFDY override' : `${r.selector} · ${r.source.label}${r.source.line ? `:${r.source.line}` : ''}`;
  }
  for (const g of styles.inherited) {
    for (const r of g.rules) {
      if (r.declarations.some((x) => !x.overridden && x.property === prop)) return `inherited from ${g.from.label}`;
    }
  }
  return null;
}

export function ComputedTab() {
  const computed = useComputed();
  const { styles } = useNodeStyles();
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const groups = useMemo(() => {
    if (!computed) return [];
    const entries = Object.entries(computed).filter(([p, v]) => (all || !isDefault(p, v)) && (!q || p.includes(q.toLowerCase()) || v.toLowerCase().includes(q.toLowerCase())));
    const used = new Set<string>();
    const out = GROUPS.map((g) => {
      const items = entries.filter(([p]) => !used.has(p) && g.test(p));
      items.forEach(([p]) => used.add(p));
      return { title: g.title, items };
    });
    out.push({ title: 'Other', items: entries.filter(([p]) => !used.has(p)) });
    return out.filter((g) => g.items.length);
  }, [computed, q, all]);
  if (!computed) return <div style={{ padding: 16, display: 'grid', placeItems: 'center' }}><Spinner /></div>;
  return (
    <div className={s.root}>
      <div className={s.toolbar}>
        <SearchInput value={q} onChange={setQ} placeholder="Filter computed styles" />
        <Checkbox checked={all} onChange={setAll} label="Show all" />
      </div>
      {groups.map((g) => (
        <div key={g.title} className={s.group}>
          <div className={s.groupTitle}>
            {g.title} <span>{g.items.length}</span>
          </div>
          {g.items.map(([p, v]) => {
            const src = winningSource(styles, p);
            return (
              <div key={p} className={s.row} onDoubleClick={() => copyText(`${p}: ${v};`, 'Declaration copied')} title={src ? `From ${src}` : 'Default / inherited value'}>
                <span className={s.prop}>{p}</span>
                <span className={s.value}>
                  {/rgba?\(|#[0-9a-f]{3}/i.test(v) && /color|background|border|fill|stroke|outline|shadow/.test(p) && <span className={s.swatch} style={{ background: v.match(/rgba?\([^)]*\)/)?.[0] ?? v }} />}
                  {v}
                </span>
                {src && <span className={s.src}>{src}</span>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
