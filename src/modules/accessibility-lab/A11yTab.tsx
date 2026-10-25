import { CircleAlert, CircleCheck, FlaskConical, Info, Maximize, Tag, Wand } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { NodeInfo } from '@shared/types';
import { Badge, Button, Notice, Section, TextField } from '@/ui';
import { studio, useStudio } from '@/store';
import { makeChange } from '@/modules/change-manager/changes';
import { styleChanges } from '@/modules/change-manager/edit';
import { currentViewportContext } from '@/modules/device-simulator/context';
import { INTERACTIVE_ROLES } from '@/modules/responsive-diff/structural';
import { SevDot } from '@/modules/responsive-audit/bits';
import { adjustForContrast, requiredRatio } from './contrast';
import { isHeuristic } from './heuristics';
import s from './a11y-tab.module.css';

function applyAttribute(info: NodeInfo, name: string, value: string | null, note: string) {
  const before = info.attrs.find(([n]) => n === name)?.[1] ?? null;
  studio().commitChange(
    makeChange({ kind: 'attribute', target: { selector: info.selector, label: info.label }, property: name, before, after: value, viewport: currentViewportContext(), origin: 'experiment', experiment: true, note }),
  );
  toast.success(`Experiment: ${name}${value !== null ? `="${value}"` : ' removed'}`, { description: 'Promote or undo it in Changes.' });
}

function applyStyles(info: NodeInfo, edits: { property: string; value: string }[], note: string) {
  const changes = styleChanges(edits, 'experiment', { info, experiment: true, note });
  if (!changes.length) return;
  studio().commitChange(changes);
  toast.success(`Experiment: ${edits.map((e) => `${e.property}: ${e.value}`).join('; ')}`, { description: 'Promote or undo it in Changes.' });
}

export function A11yTab() {
  const info = useStudio((st) => st.selection.info);
  const issues = useStudio((st) => st.a11yIssues);
  const related = useMemo(
    () => (info ? issues.flatMap((i) => i.nodes.filter((n) => n.selector === info.selector || n.nodeId === info.id).map((n) => ({ issue: i, node: n }))) : []),
    [issues, info],
  );
  if (!info) return null;
  const a = info.a11y;
  const attrs = new Map(info.attrs);
  const isField = /^(input|select|textarea)$/.test(info.tag) && attrs.get('type') !== 'hidden';
  const interactive = a.focusable || INTERACTIVE_ROLES.has(a.role) || isField;
  const missingName = interactive && !a.name.trim();
  const placeholder = attrs.get('placeholder');
  const placeholderOnly = isField && Boolean(placeholder) && !attrs.get('aria-label') && !attrs.get('aria-labelledby') && !attrs.get('title');
  const small = interactive && (info.rect.width < 24 || info.rect.height < 24) && info.rect.width > 0;
  const isImg = info.tag === 'img';
  const inTabOrder = a.focusable && (a.tabIndex ?? 0) >= 0;

  return (
    <div>
      <Section title="Accessibility tree" id="a11y-tree">
        <div className={s.kv}>
          <span className={s.k}>Role</span>
          <span>
            <code className={s.role}>{a.role || 'generic'}</code>
          </span>
          <span className={s.k}>Name</span>
          <span className={s.v}>
            {a.name ? (
              <span className={s.name}>“{a.name}”</span>
            ) : (
              <span className={interactive ? s.bad : s.muted}>
                {interactive ? (
                  <>
                    <CircleAlert size={12} /> No accessible name
                  </>
                ) : (
                  'none'
                )}
              </span>
            )}
          </span>
          {a.description && (
            <>
              <span className={s.k}>Description</span>
              <span className={s.v}>{a.description}</span>
            </>
          )}
          <span className={s.k}>Exposed</span>
          <span className={s.v}>{a.hidden ? <span className={s.warn}>Hidden from assistive technology</span> : 'Yes'}</span>
          {a.states.length > 0 && (
            <>
              <span className={s.k}>States</span>
              <span className={s.badges}>
                {a.states.map((st) => (
                  <Badge key={st} tone={st === 'invalid' ? 'danger' : st === 'focused' ? 'accent' : 'neutral'}>
                    {st}
                  </Badge>
                ))}
              </span>
            </>
          )}
        </div>
        {placeholderOnly && (
          <div style={{ marginTop: 8 }}>
            <Notice tone="warning">The only label is the placeholder “{placeholder}”, which disappears while typing and is not a reliable accessible name.</Notice>
          </div>
        )}
      </Section>

      <Section title="Keyboard" id="a11y-keyboard">
        <div className={s.kv}>
          <span className={s.k}>Focusable</span>
          <span className={s.v}>{a.focusable ? <span className={s.ok}>Yes</span> : interactive ? <span className={s.bad}>No — keyboard users cannot reach it</span> : 'No'}</span>
          <span className={s.k}>tabindex</span>
          <span className={s.v}>
            <code className={s.mono}>{a.tabIndex === null ? '—' : a.tabIndex}</code>
            {a.tabIndex !== null && a.tabIndex > 0 && <span className={s.warn}> positive tabindex overrides DOM order</span>}
          </span>
          <span className={s.k}>Tab order</span>
          <span className={s.v}>{inTabOrder ? 'Included' : a.focusable ? 'Focusable by script only (tabindex −1)' : 'Not included'}</span>
        </div>
      </Section>

      <Section title={<>ARIA attributes{a.aria.length ? <span className={s.count}>{a.aria.length}</span> : null}</>} id="a11y-aria">
        {a.aria.length ? (
          <div className={s.aria}>
            {a.aria.map(([k, v]) => (
              <div key={k} className={s.ariaRow}>
                <code className={s.ariaKey}>{k}</code>
                <code className={s.ariaVal}>{v || '""'}</code>
              </div>
            ))}
          </div>
        ) : (
          <div className={s.hint}>No ARIA attributes. Native semantics are used{info.tag ? ` (<${info.tag}>)` : ''}.</div>
        )}
      </Section>

      {a.contrast && <ContrastSection info={info} />}

      {(missingName || placeholderOnly || small || isImg) && (
        <Section
          title={
            <>
              <Wand size={12} style={{ color: 'var(--violet)' }} /> Quick fixes
            </>
          }
          id="a11y-fixes"
        >
          <div className={s.fixes}>
            {(missingName || placeholderOnly) && <NameFix info={info} suggestion={placeholder?.trim() || info.text?.trim() || ''} />}
            {small && (
              <div className={s.fix}>
                <div className={s.fixHead}>
                  <Maximize size={12} /> Enlarge the target to 24 × 24 px
                </div>
                <div className={s.hint}>
                  Currently {Math.round(info.rect.width)}×{Math.round(info.rect.height)}px (WCAG 2.5.8). Adds min-width/min-height; a wrapping {'<label>'} is often the better fix.
                </div>
                <Button size="sm" icon={<FlaskConical size={12} />} onClick={() => applyStyles(info, [{ property: 'min-width', value: '24px' }, { property: 'min-height', value: '24px' }], 'A11y quick fix: 24px target')}>
                  Try as experiment
                </Button>
              </div>
            )}
            {isImg && (
              <div className={s.fix}>
                <div className={s.fixHead}>
                  <Tag size={12} /> Image text alternative
                </div>
                <div className={s.hint}>{attrs.has('alt') ? `alt="${attrs.get('alt')}"` : 'This image has no alt attribute.'} Decorative images should use alt="".</div>
                <Button size="sm" icon={<FlaskConical size={12} />} onClick={() => applyAttribute(info, 'alt', '', 'A11y quick fix: decorative image')}>
                  Mark decorative (alt="")
                </Button>
              </div>
            )}
          </div>
        </Section>
      )}

      <Section title={<>Findings on this element{related.length ? <span className={s.count}>{related.length}</span> : null}</>} id="a11y-related">
        {related.length ? (
          <div className={s.related}>
            {related.map(({ issue, node }, i) => (
              <div key={i} className={s.relItem}>
                <SevDot severity={issue.impact} />
                <div style={{ minWidth: 0 }}>
                  <div className={s.relTitle}>{issue.help}</div>
                  <div className={s.hint}>
                    {isHeuristic(issue) ? 'IFDY check' : 'axe-core'} · {issue.ruleId}
                    {node.summary ? ` — ${node.summary.replace(/^Fix (any|all) of the following:\s*/i, '').split('\n')[0]}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={s.hint}>{issues.length ? 'The last accessibility audit reported nothing on this element.' : 'Run the accessibility audit (Accessibility tab in the debug panel) to see findings here.'}</div>
        )}
      </Section>
      <div className={s.footer}>
        <Info size={11} /> Automated checks cannot prove accessibility compliance; manual testing with assistive technology is still required.
      </div>
    </div>
  );
}

function NameFix({ info, suggestion }: { info: NodeInfo; suggestion: string }) {
  const [value, setValue] = useState(suggestion);
  return (
    <div className={s.fix}>
      <div className={s.fixHead}>
        <Tag size={12} /> Give it an accessible name
      </div>
      <div className={s.hint}>Adds aria-label as an experiment. A visible {'<label for>'} is preferable for form fields; export the change and move it into markup.</div>
      <div className={s.fixRow}>
        <TextField value={value} onCommit={setValue} placeholder="aria-label text" />
        <Button size="sm" variant="primary" icon={<FlaskConical size={12} />} disabled={!value.trim()} onClick={() => applyAttribute(info, 'aria-label', value.trim(), 'A11y quick fix: accessible name')}>
          Apply
        </Button>
      </div>
    </div>
  );
}

function ContrastSection({ info }: { info: NodeInfo }) {
  const c = info.a11y.contrast!;
  const need = requiredRatio('AA', c.fontSize, c.bold);
  const needAAA = requiredRatio('AAA', c.fontSize, c.bold);
  const large = need === 3;
  const fix = !c.aa ? adjustForContrast(c.fg, c.bg, need + 0.05) : null;
  return (
    <Section title="Text contrast" id="a11y-contrast">
      <div className={s.contrast}>
        <div className={s.sample} style={{ color: c.fg, background: c.bg }}>
          <span style={{ fontSize: 22, fontWeight: c.bold ? 700 : 500 }}>Aa</span>
          <span className={s.sampleText} style={{ fontWeight: c.bold ? 700 : 400 }}>
            {(info.text ?? 'Sample text').slice(0, 28)}
          </span>
        </div>
        <div className={s.ratioBox}>
          <div className={s.ratio} data-ok={c.aa ? 'true' : 'false'}>
            {c.ratio.toFixed(2)}
            <span>:1</span>
          </div>
          <div className={s.levels}>
            <Level label="AA" ok={c.aa} need={need} />
            <Level label="AAA" ok={c.aaa} need={needAAA} />
          </div>
        </div>
      </div>
      <div className={s.swatches}>
        <span className={s.swatch}>
          <i style={{ background: c.fg }} /> Text <code>{c.fg}</code>
        </span>
        <span className={s.swatch}>
          <i style={{ background: c.bg }} /> Background <code>{c.bg}</code>
        </span>
      </div>
      <div className={s.hint} style={{ marginTop: 6 }}>
        {Math.round(c.fontSize * 10) / 10}px{c.bold ? ' bold' : ''} — {large ? 'large text (3:1 for AA)' : 'normal text (4.5:1 for AA)'}. Background is composited from ancestors; images and gradients behind text are not measured.
      </div>
      {fix && (
        <div className={s.fix} style={{ marginTop: 10 }}>
          <div className={s.fixHead}>
            <Wand size={12} /> Nearest passing text color
          </div>
          <div className={s.fixColors}>
            <span className={s.swatch}>
              <i style={{ background: c.fg }} /> <code>{c.fg}</code>
            </span>
            →
            <span className={s.swatch}>
              <i style={{ background: fix.hex }} /> <code>{fix.hex}</code>
            </span>
            <Badge tone="success">{fix.ratio.toFixed(2)}:1</Badge>
          </div>
          <Button size="sm" variant="primary" icon={<FlaskConical size={12} />} onClick={() => applyStyles(info, [{ property: 'color', value: fix.hex }], `A11y quick fix: contrast ${c.ratio}→${fix.ratio}`)}>
            Try as experiment
          </Button>
        </div>
      )}
    </Section>
  );
}

function Level({ label, ok, need }: { label: string; ok: boolean; need: number }) {
  return (
    <span className={s.level} data-ok={ok ? 'true' : 'false'} title={`Requires ${need}:1`}>
      {ok ? <CircleCheck size={12} /> : <CircleAlert size={12} />}
      {label}
      <span className={s.need}>{need}:1</span>
    </span>
  );
}
