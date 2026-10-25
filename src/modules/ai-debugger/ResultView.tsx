import { useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronDown, Eye, FlaskConical, Lightbulb, Minus, RefreshCw, ScanSearch, TrendingDown, TrendingUp, Wrench, X } from 'lucide-react';
import { Badge, Button, Notice, Spinner, Tooltip } from '@/ui';
import type { CssEdit, Diagnosis, InferredCause, ProposedFix } from './schema';
import type { FixState, Turn } from './state';
import { useAi } from './state';
import { beforeValue, fixEdits, invalidSelectors } from './fixes';
import { applyFixAction, discardFixAction, fixKey, previewFixAction, rerunFixChecks } from './engine';
import type { MeasurementComparison } from './metrics';
import type { RerunResult } from './measure';
import s from './ai.module.css';

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

function Block({ icon, title, count, tone, hint, defaultOpen = true, children }: { icon: ReactNode; title: string; count: number; tone?: 'causes' | 'fixes' | 'warning'; hint?: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={s.block} data-tone={tone}>
      <button type="button" className={s.blockHead} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {icon}
        <span>{title}</span>
        <span className={s.blockCount}>{count}</span>
        {hint && <span className={s.blockHint}>{hint}</span>}
        <ChevronDown size={12} className={s.chev} style={hint ? undefined : { marginLeft: 'auto' }} />
      </button>
      {open && <div className={s.blockBody}>{children}</div>}
    </section>
  );
}

function Evidence({ items }: { items: string[] }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, 2);
  return (
    <div className={s.evidence}>
      {shown.map((e, i) => (
        <span key={i} className={s.ev} title={e}>
          {e}
        </span>
      ))}
      {items.length > 2 && (
        <button type="button" className={s.evMore} onClick={() => setAll((a) => !a)}>
          {all ? 'less' : `+${items.length - 2}`}
        </button>
      )}
    </div>
  );
}

/** Render `code` spans from backtick-quoted text. */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('`') && p.endsWith('`') && p.length > 2 ? (
          <code key={i} className={s.code}>
            {p.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function Meter({ value }: { value: number }) {
  const level = value >= 0.75 ? 'high' : value >= 0.5 ? 'mid' : 'low';
  const words = level === 'high' ? 'strong evidence' : level === 'mid' ? 'moderate evidence' : 'weak evidence';
  return (
    <Tooltip content={`Confidence ${Math.round(value * 100)}% — ${words}`}>
      <span className={s.meter} data-level={level} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label="Confidence">
        <span className={s.meterTrack}>
          <span className={s.meterFill} style={{ width: `${Math.round(value * 100)}%` }} />
        </span>
        <span className={s.meterValue}>{Math.round(value * 100)}%</span>
      </span>
    </Tooltip>
  );
}

function CauseItem({ c }: { c: InferredCause }) {
  return (
    <div className={s.cause}>
      <div className={s.causeTop}>
        <div className={s.item} style={{ gridTemplateColumns: '10px 1fr' }}>
          <span className={s.bullet} style={{ background: 'var(--violet)' }} />
          <p>
            <Rich text={c.text} />
          </p>
        </div>
        <Meter value={c.confidence} />
      </div>
      <div style={{ paddingLeft: 16 }}>
        <Evidence items={c.evidence} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* CSS diff                                                            */
/* ------------------------------------------------------------------ */

export function CssDiff({ edits, turn }: { edits: CssEdit[]; turn: Turn }) {
  const groups = new Map<string, { media?: string; selector: string; edits: CssEdit[] }>();
  for (const e of edits) {
    const k = `${e.media ?? ''}\u0000${e.selector}`;
    const g = groups.get(k) ?? { media: e.media, selector: e.selector, edits: [] };
    g.edits.push(e);
    groups.set(k, g);
  }
  const lines: { kind: 'media' | 'selector' | 'del' | 'add' | 'close' | 'ctx'; text: string }[] = [];
  for (const g of groups.values()) {
    const pad = g.media ? '  ' : '';
    if (g.media) lines.push({ kind: 'media', text: `@media ${g.media} {` });
    lines.push({ kind: 'selector', text: `${pad}${g.selector} {` });
    for (const e of g.edits) {
      const before = beforeValue(turn.context, e);
      if (before !== null && before !== e.value) lines.push({ kind: 'del', text: `${pad}-   ${e.property}: ${before};` });
      lines.push({ kind: 'add', text: `${pad}+   ${e.property}: ${e.value};` });
    }
    lines.push({ kind: 'close', text: `${pad}}` });
    if (g.media) lines.push({ kind: 'close', text: '}' });
  }
  return (
    <pre className={s.diff} aria-label="CSS changes">
      {lines.map((l, i) => (
        <span key={i} className={s.diffLine} data-kind={l.kind}>
          {l.text}
        </span>
      ))}
    </pre>
  );
}

/* ------------------------------------------------------------------ */
/* Measurements                                                        */
/* ------------------------------------------------------------------ */

export function VerdictRow({ result, prefix }: { result: MeasurementComparison; prefix?: string }) {
  const Icon = result.verdict === 'improved' ? TrendingDown : result.verdict === 'worse' ? TrendingUp : Minus;
  const word = result.verdict === 'improved' ? 'Improved' : result.verdict === 'worse' ? 'Worse' : result.verdict === 'mixed' ? 'Mixed' : 'Unchanged';
  return (
    <div className={s.result} data-verdict={result.verdict} role="status">
      <Icon size={13} />
      <span className={s.resultText}>
        <b>
          {prefix ? `${prefix}: ` : ''}
          {word}
        </b>{' '}
        — <span className={s.mono}>{result.text}</span>
      </span>
    </div>
  );
}

function RerunTable({ rerun }: { rerun: RerunResult }) {
  if (!rerun.rows.length) return <div className={s.muted}>No measurements were available.</div>;
  const cell = (b: number | null, a: number | null, unit = '') => {
    if (b === null || a === null) return <td>—</td>;
    const cls = a < b ? s.better : a > b ? s.worse : undefined;
    return (
      <td>
        {b}
        {unit} → <span className={cls}>{a}{unit}</span>
      </td>
    );
  };
  return (
    <div>
      <table className={s.rerun}>
        <thead>
          <tr>
            <th>Viewport</th>
            <th>Issues</th>
            <th>Overflow</th>
            <th>Hinge</th>
          </tr>
        </thead>
        <tbody>
          {rerun.rows.map((r) => (
            <tr key={r.label}>
              <td>
                {r.label}
                <span className={s.rerunVp}>
                  {r.viewport.deviceName} {r.viewport.width}×{r.viewport.height}
                </span>
              </td>
              {cell(r.before.total, r.after.total)}
              {cell(r.before.pageOverflowPx, r.after.pageOverflowPx, 'px')}
              {cell(r.before.hingeOverlapPx, r.after.hingeOverlapPx, 'px')}
            </tr>
          ))}
        </tbody>
      </table>
      <div className={s.muted} style={{ marginTop: 4 }}>
        Agent responsive audit; the other posture is measured in a hidden preview with and without this fix.
        {rerun.shared.status === 'ran' ? ` Shared audit re-run: ${rerun.shared.responsive} issue${rerun.shared.responsive === 1 ? '' : 's'} across ${rerun.shared.viewports} viewport${rerun.shared.viewports === 1 ? '' : 's'}.` : rerun.shared.status === 'failed' ? ' The shared responsive audit could not run; numbers come from the agent directly.' : ''}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fix card                                                            */
/* ------------------------------------------------------------------ */

const STATUS_BADGE: Record<FixState['status'], { label: string; tone: 'violet' | 'success' | 'outline' } | null> = {
  idle: null,
  previewing: { label: 'Previewing', tone: 'violet' },
  applied: { label: 'Applied', tone: 'success' },
  discarded: { label: 'Discarded', tone: 'outline' },
};

export function FixCard({ turn, fix, index }: { turn: Turn; fix: ProposedFix; index: number }) {
  const key = fixKey(turn.id, fix.id);
  const st = useAi((x) => x.fixes[key]) ?? ({ status: 'idle' } as FixState);
  const edits = fixEdits(fix, turn.selectorMap);
  const invalid = invalidSelectors(fix, turn.selectorMap);
  const markupOnly = edits.length === 0;
  const badge = STATUS_BADGE[st.status];
  const busy = st.busy;
  const canAct = !markupOnly && invalid.length === 0 && !busy;
  return (
    <article className={s.fix} data-status={st.status} aria-label={`Fix ${index + 1}: ${fix.title}`}>
      <div className={s.fixHead}>
        <span className={s.fixIndex}>{index + 1}</span>
        <span className={s.fixTitle}>
          <Rich text={fix.title} />
        </span>
        {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
      </div>
      <div className={s.fixBody}>
        {fix.rationale && (
          <p className={s.rationale}>
            <Rich text={fix.rationale} />
          </p>
        )}
        {markupOnly ? <Notice tone="info">Markup change — there is no CSS to preview. Apply it in the source.</Notice> : <CssDiff edits={edits} turn={turn} />}
        {invalid.length > 0 && <Notice tone="warning">This browser rejects the selector {invalid.map((x) => `“${x}”`).join(', ')}, so the fix cannot be previewed.</Notice>}
        <div className={s.meta}>
          {fix.expectedEffect && (
            <>
              <span className={s.metaLabel}>Effect</span>
              <span className={s.metaValue}>
                <Rich text={fix.expectedEffect} />
              </span>
            </>
          )}
          {fix.affectedElements.length > 0 && (
            <>
              <span className={s.metaLabel}>Affects</span>
              <span className={`${s.metaValue} ${s.selChips}`}>
                {fix.affectedElements.map((a) => (
                  <span key={a} className={s.ev} title={a}>
                    {a}
                  </span>
                ))}
              </span>
            </>
          )}
          {fix.risks.length > 0 && (
            <>
              <span className={s.metaLabel}>Risks</span>
              <span className={s.metaValue}>
                <ul>
                  {fix.risks.map((r, i) => (
                    <li key={i}>
                      <Rich text={r} />
                    </li>
                  ))}
                </ul>
              </span>
            </>
          )}
          {fix.tests.length > 0 && (
            <>
              <span className={s.metaLabel}>Tests</span>
              <span className={s.metaValue}>
                <ul>
                  {fix.tests.map((r, i) => (
                    <li key={i}>
                      <Rich text={r} />
                    </li>
                  ))}
                </ul>
              </span>
            </>
          )}
        </div>
        {!markupOnly && (
          <div className={s.actions}>
            {st.status !== 'previewing' && st.status !== 'applied' && (
              <Button size="sm" icon={busy === 'preview' ? <Spinner size={11} /> : <Eye size={12} />} disabled={!canAct} onClick={() => void previewFixAction(turn.id, fix)} title="Apply as a reversible experiment and measure the result">
                Preview
              </Button>
            )}
            {st.status !== 'applied' && (
              <Button size="sm" variant="violet" icon={busy === 'apply' ? <Spinner size={11} /> : <Check size={12} />} disabled={!canAct} onClick={() => void applyFixAction(turn.id, fix)} title={st.status === 'previewing' ? 'Keep the previewed change as a normal edit' : 'Commit the change (undoable)'}>
                Apply
              </Button>
            )}
            {(st.status === 'previewing' || st.status === 'applied') && (
              <Button size="sm" variant="ghost" icon={<X size={12} />} disabled={Boolean(busy)} onClick={() => discardFixAction(turn.id, fix)} title="Remove this fix's changes">
                Discard
              </Button>
            )}
            {(st.status === 'previewing' || st.status === 'applied') && (
              <Button size="sm" variant="ghost" icon={busy === 'rerun' ? <Spinner size={11} /> : <RefreshCw size={12} />} disabled={Boolean(busy)} onClick={() => void rerunFixChecks(turn.id, fix)} title="Re-run responsive checks here and at the other posture">
                Re-run checks
              </Button>
            )}
            {busy === 'measure' && (
              <span className={s.muted} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Spinner size={10} /> Measuring…
              </span>
            )}
          </div>
        )}
        {st.error && <Notice tone="danger">{st.error}</Notice>}
        {st.result && (st.status === 'previewing' || st.status === 'applied') && <VerdictRow result={st.result} prefix="This viewport" />}
        {st.rerun && (st.status === 'previewing' || st.status === 'applied') && <RerunTable rerun={st.rerun} />}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Result                                                              */
/* ------------------------------------------------------------------ */

export function ResultView({ turn, diagnosis }: { turn: Turn; diagnosis: Diagnosis }) {
  const d = diagnosis;
  return (
    <>
      <div className={s.summary}>
        <Rich text={d.summary} />
      </div>
      {d.observedFacts.length > 0 && (
        <Block icon={<ScanSearch size={13} />} title="Observed facts" count={d.observedFacts.length} hint="measured">
          {d.observedFacts.map((f, i) => (
            <div key={i} className={s.item}>
              <span className={s.bullet} />
              <div style={{ minWidth: 0 }}>
                <p>
                  <Rich text={f.text} />
                </p>
                <Evidence items={f.evidence} />
              </div>
            </div>
          ))}
        </Block>
      )}
      {d.inferredCauses.length > 0 && (
        <Block icon={<Lightbulb size={13} />} title="Inferred causes" count={d.inferredCauses.length} tone="causes" hint="confidence">
          {d.inferredCauses.map((c, i) => (
            <CauseItem key={i} c={c} />
          ))}
        </Block>
      )}
      {d.proposedFixes.length > 0 && (
        <Block icon={<Wrench size={13} />} title="Proposed fixes" count={d.proposedFixes.length} tone="fixes" hint="preview first">
          {d.proposedFixes.map((f, i) => (
            <FixCard key={f.id} turn={turn} fix={f} index={i} />
          ))}
        </Block>
      )}
      {d.assumptions.length > 0 && (
        <Block icon={<AlertTriangle size={13} />} title="Unverified assumptions" count={d.assumptions.length} tone="warning" hint="not measured">
          {d.assumptions.map((a, i) => (
            <div key={i} className={s.item}>
              <span className={s.bullet} />
              <p>
                <Rich text={a} />
              </p>
            </div>
          ))}
        </Block>
      )}
      {d.followUpTests.length > 0 && (
        <Block icon={<FlaskConical size={13} />} title="Follow-up tests" count={d.followUpTests.length} defaultOpen={false}>
          {d.followUpTests.map((t, i) => (
            <div key={i} className={s.item}>
              <span className={s.bullet} />
              <p>
                <Rich text={t} />
              </p>
            </div>
          ))}
        </Block>
      )}
    </>
  );
}

/** Markdown export of a diagnosis (copy to clipboard / paste into a ticket). */
export function diagnosisMarkdown(d: Diagnosis, title: string): string {
  const out = [`## ${title}`, '', d.summary, ''];
  if (d.observedFacts.length) out.push('### Observed facts', ...d.observedFacts.map((f) => `- ${f.text}${f.evidence.length ? ` _(${f.evidence.join('; ')})_` : ''}`), '');
  if (d.inferredCauses.length) out.push('### Inferred causes', ...d.inferredCauses.map((c) => `- (${Math.round(c.confidence * 100)}%) ${c.text}`), '');
  if (d.proposedFixes.length) {
    out.push('### Proposed fixes');
    d.proposedFixes.forEach((f, i) => {
      out.push(`${i + 1}. **${f.title}** — ${f.rationale}`);
      if (f.css.length) out.push('', '```css', ...f.css.map((e) => `${e.media ? `@media ${e.media} { ` : ''}${e.selector} { ${e.property}: ${e.value}; }${e.media ? ' }' : ''}`), '```');
    });
    out.push('');
  }
  if (d.assumptions.length) out.push('### Unverified assumptions', ...d.assumptions.map((a) => `- ${a}`), '');
  if (d.followUpTests.length) out.push('### Follow-up tests', ...d.followUpTests.map((t) => `- [ ] ${t}`));
  return out.join('\n');
}
