import { Accessibility, ChevronDown, CircleAlert, CircleCheck, Download, ExternalLink, Info, Keyboard, Lightbulb, ListChecks, Play, RefreshCw, ScanEye, Sparkles, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { A11yIssue, IssueSeverity } from '@shared/types';
import { Badge, Button, EmptyState, IconButton, Menu, Notice, SearchInput, Segmented, Spinner, Switch, TextField, Tooltip } from '@/ui';
import { bus } from '@/lib/events';
import { studio, useStudio } from '@/store';
import { describeViewport } from '@/modules/device-simulator/viewport';
import { downloadText } from '@/modules/screenshots/capture';
import { CodeLine, QaEmpty, SevDot, SEV_LABEL, timeAgo, useTick, useWidth } from '@/modules/responsive-audit/bits';
import { revealSelector } from '@/modules/responsive-audit/reveal';
import { CHECKLIST, checklistProgress, loadChecklist, saveChecklist, type ChecklistState, type ChecklistStatus } from './checklist';
import { isHeuristic, remediationFor, wcagRefs } from './heuristics';
import { IMPACT_ORDER, runA11yAudit, runKeyboardAudit, useA11yLab } from './runner';
import { toggleTabOrderOverlay } from './index';
import q from '@/modules/responsive-audit/qa.module.css';
import s from './a11y.module.css';

type View = 'violations' | 'keyboard' | 'checklist';
const VIEW_KEY = 'ifdy.a11y.view';

export function A11yFindingsPanel() {
  useTick();
  const project = useStudio((st) => st.project);
  const issues = useStudio((st) => st.a11yIssues);
  const status = useStudio((st) => st.auditStatus.a11y);
  const statusAt = useStudio((st) => st.auditStatus.at);
  const statusError = useStudio((st) => st.auditStatus.error);
  const ready = useStudio((st) => st.instances.primary?.status === 'ready');
  const route = useStudio((st) => st.currentRoute);
  const lab = useA11yLab();
  const [view, setViewState] = useState<View>(() => {
    try {
      return (localStorage.getItem(VIEW_KEY) as View) || 'violations';
    } catch {
      return 'violations';
    }
  });
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };
  const [checklist, setChecklist] = useState<ChecklistState>(() => loadChecklist(project?.id));
  useEffect(() => setChecklist(loadChecklist(project?.id)), [project?.id]);
  const progress = checklistProgress(checklist);
  const [ref, width] = useWidth<HTMLDivElement>();

  if (!project) {
    return (
      <div className={q.center}>
        <QaEmpty icon={<Accessibility size={18} />} title="Accessibility lab">
          Open a project to run axe-core, keyboard tests and the manual checklist.
        </QaEmpty>
      </div>
    );
  }

  const running = status === 'running';
  const nodeCount = issues.reduce((n, i) => n + i.nodes.length, 0);
  const kb = lab.keyboard;
  const stale = lab.route !== null && lab.route !== route && status === 'done';

  const exportAs = (kind: 'json' | 'md') => {
    if (kind === 'json') {
      downloadText(
        JSON.stringify({ tool: 'IFDY accessibility lab', engine: 'axe-core + IFDY heuristics', note: NOTE, project: project.name, route: lab.route, viewport: lab.viewport, generatedAt: new Date().toISOString(), issues, keyboard: kb, checklist }, null, 2),
        'ifdy-accessibility.json',
        'application/json',
      );
    } else downloadText(toMarkdown(issues, project.name, lab.route ?? route, checklist), 'ifdy-accessibility.md', 'text/markdown');
  };

  return (
    <div className={`${q.panel} ${width && width < 760 ? q.narrow : ''}`} ref={ref}>
      <div className={q.toolbar}>
        <Button
          size="sm"
          variant="primary"
          icon={running ? <Spinner size={11} /> : status === 'idle' ? <Play size={12} fill="currentColor" /> : <RefreshCw size={12} />}
          disabled={!ready || running}
          onClick={() => void runA11yAudit().catch(() => {})}
        >
          {running ? 'Auditing…' : status === 'idle' ? 'Run audit' : 'Re-run'}
        </Button>
        <Segmented
          ariaLabel="Accessibility view"
          value={view}
          onChange={setView}
          options={[
            { value: 'violations', icon: <ScanEye size={12} />, label: <>Automated <span className={q.segCount}>{issues.length}</span></> },
            { value: 'keyboard', icon: <Keyboard size={12} />, label: <>Keyboard <span className={q.segCount}>{kb ? kb.order.length : '–'}</span></> },
            { value: 'checklist', icon: <ListChecks size={12} />, label: <>Manual <span className={q.segCount}>{progress.done}/{progress.total}</span></> },
          ]}
        />
        <span className={q.spacer} />
        <span className={q.status}>
          {running ? (
            <>
              <Spinner size={10} /> Running axe-core and IFDY checks…
            </>
          ) : status === 'done' && lab.viewport ? (
            <>
              <b>{issues.length}</b> rule{issues.length === 1 ? '' : 's'} · <b>{nodeCount}</b> element{nodeCount === 1 ? '' : 's'} · {describeViewport(lab.viewport)} · {timeAgo(statusAt)}
            </>
          ) : null}
        </span>
        <Menu
          align="end"
          trigger={
            <span>
              <IconButton size="sm" label="Export accessibility report" disabled={!issues.length && !kb}>
                <Download size={13} />
              </IconButton>
            </span>
          }
          items={[
            { label: 'Markdown report (.md)', onSelect: () => exportAs('md') },
            { label: 'JSON (.json)', onSelect: () => exportAs('json') },
          ]}
        />
        {running && <span className={q.progressIndeterminate} />}
      </div>

      {(lab.axeError || (status === 'error' && statusError) || stale) && (
        <div style={{ padding: '8px 10px 0', display: 'grid', gap: 6 }}>
          {status === 'error' && statusError && <Notice tone="danger">{statusError}</Notice>}
          {lab.axeError && (
            <Notice tone="warning">
              axe-core could not run in the preview ({lab.axeError}). IFDY’s own checks still ran.
            </Notice>
          )}
          {stale && (
            <Notice tone="info">
              Results are for <b className={q.mono}>{lab.route || 'the start page'}</b>; the canvas now shows <b className={q.mono}>{route || 'the start page'}</b>.
            </Notice>
          )}
        </div>
      )}

      {view === 'violations' && <Violations issues={issues} status={status} ready={ready} />}
      {view === 'keyboard' && <KeyboardView />}
      {view === 'checklist' && (
        <Checklist
          state={checklist}
          onChange={(next) => {
            setChecklist(next);
            saveChecklist(project.id, next);
          }}
        />
      )}

      <div className={s.note} role="note">
        <Info size={12} />
        {NOTE}
      </div>
    </div>
  );
}

const NOTE = 'Automated checks cannot prove accessibility compliance; manual testing with assistive technology is still required.';

/* ------------------------------------------------------------------ */
/* Automated findings                                                  */
/* ------------------------------------------------------------------ */

function Violations({ issues, status, ready }: { issues: A11yIssue[]; status: string; ready: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const filtered = useMemo(() => {
    const t = query.trim().toLowerCase();
    if (!t) return issues;
    return issues.filter((i) => `${i.help} ${i.ruleId} ${i.description} ${i.nodes.map((n) => n.selector).join(' ')}`.toLowerCase().includes(t));
  }, [issues, query]);
  const groups = useMemo(() => IMPACT_ORDER.map((impact) => ({ impact, list: filtered.filter((i) => i.impact === impact) })).filter((g) => g.list.length), [filtered]);
  const current = issues.find((i) => i.id === selected) ?? null;

  if (status === 'idle')
    return (
      <div className={q.center}>
        <div className={q.runCard}>
          <QaEmpty icon={<Accessibility size={18} />} title="Run the accessibility audit">
            axe-core checks WCAG 2.0–2.2 A/AA and best practices on the canvas page. IFDY adds checks axe accepts by design: placeholder-only labels, size-only tap targets and pointer-only controls.
          </QaEmpty>
          <Button variant="primary" icon={<Play size={12} fill="currentColor" />} disabled={!ready} onClick={() => void runA11yAudit().catch(() => {})}>
            Run accessibility audit
          </Button>
        </div>
      </div>
    );
  if (status === 'running' && !issues.length)
    return (
      <div className={q.list} style={{ borderRight: 0 }}>
        {[58, 72, 44, 64].map((w, i) => (
          <div key={i} className={q.skeleton} style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  if (!issues.length)
    return (
      <div className={q.center}>
        <QaEmpty tone="success" icon={<CircleCheck size={18} />} title="No automated violations on this page">
          axe-core and IFDY’s checks found nothing at this viewport. That is not a pass: use the keyboard test and the manual checklist.
        </QaEmpty>
      </div>
    );

  return (
    <div className={q.body}>
      <div className={q.list}>
        <div className={s.listSearch}>
          <SearchInput value={query} onChange={setQuery} placeholder="Filter rules or selectors" />
        </div>
        {groups.map((g) => {
          const open = !collapsed[g.impact];
          return (
            <div key={g.impact} className={q.group}>
              <button className={q.groupHead} aria-expanded={open} onClick={() => setCollapsed({ ...collapsed, [g.impact]: open })}>
                <ChevronDown size={12} className={q.groupChevron} />
                <SevDot severity={g.impact} />
                {SEV_LABEL[g.impact]}
                <span className={q.ruleCount}>{g.list.length}</span>
              </button>
              {open &&
                g.list.map((i) => (
                  <button key={i.id} className={q.row} data-active={i.id === selected ? 'true' : undefined} onClick={() => setSelected(i.id)} style={{ paddingLeft: 26 }}>
                    <SevDot severity={i.impact} />
                    <span className={q.rowMain}>
                      <span className={q.rowTitle} style={{ maxWidth: '70%' }}>
                        {i.help}
                      </span>
                      <span className={q.rowSel}>{i.ruleId}</span>
                    </span>
                    <span className={q.rowTags}>
                      {isHeuristic(i) ? <Badge tone="violet">IFDY check</Badge> : <Badge tone="outline">axe</Badge>}
                      <Badge tone="neutral">{i.nodes.length}</Badge>
                    </span>
                  </button>
                ))}
            </div>
          );
        })}
        {!groups.length && <EmptyState title="No rules match the filter" />}
      </div>
      <div className={q.detail}>{current ? <ViolationDetail issue={current} /> : <Summary issues={issues} onPick={setSelected} />}</div>
    </div>
  );
}

function Summary({ issues, onPick }: { issues: A11yIssue[]; onPick: (id: string) => void }) {
  const counts = IMPACT_ORDER.map((impact) => ({ impact, n: issues.filter((i) => i.impact === impact).reduce((a, i) => a + i.nodes.length, 0) })).filter((c) => c.impact !== 'info');
  return (
    <div>
      <div className={q.dLabel} style={{ marginTop: 0 }}>
        Affected elements by impact
      </div>
      <div className={s.bar}>
        {counts.map((c) => c.n > 0 && <span key={c.impact} className={s.barSeg} data-sev={c.impact} style={{ flexGrow: c.n }} title={`${SEV_LABEL[c.impact]}: ${c.n}`} />)}
      </div>
      <div className={s.barLegend}>
        {counts.map((c) => (
          <span key={c.impact}>
            <SevDot severity={c.impact} /> {SEV_LABEL[c.impact]} <b>{c.n}</b>
          </span>
        ))}
      </div>
      <div className={q.dLabel}>Start with</div>
      <div className={s.startList}>
        {issues.slice(0, 4).map((i) => (
          <button key={i.id} className={s.startItem} onClick={() => onPick(i.id)}>
            <SevDot severity={i.impact} />
            <span>{i.help}</span>
            <span className={q.muted}>{i.nodes.length}</span>
          </button>
        ))}
      </div>
      <div className={q.dText} style={{ marginTop: 12 }}>
        Each finding links to the rule’s documentation. Select a rule to see affected elements and remediation guidance.
      </div>
    </div>
  );
}

function ViolationDetail({ issue }: { issue: A11yIssue }) {
  const refs = wcagRefs(issue.tags);
  const remedy = remediationFor(issue.ruleId);
  return (
    <div>
      <div className={q.dHead}>
        <Badge tone={issue.impact === 'critical' || issue.impact === 'serious' ? 'danger' : issue.impact === 'moderate' ? 'warning' : 'info'}>{SEV_LABEL[issue.impact]}</Badge>
        {isHeuristic(issue) ? <Badge tone="violet">IFDY heuristic</Badge> : <Badge tone="outline">axe-core</Badge>}
        {refs.map((r) => (
          <Badge key={r} tone="neutral">
            WCAG {r}
          </Badge>
        ))}
      </div>
      <div className={q.dTitle}>{issue.help}</div>
      <div className={q.dText}>{issue.description}</div>
      <a className={s.link} href={issue.helpUrl} target="_blank" rel="noreferrer noopener">
        <ExternalLink size={11} /> {new URL(issue.helpUrl).hostname.replace(/^www\./, '')} · {issue.ruleId}
      </a>
      {remedy && (
        <>
          <div className={q.dLabel}>How to fix</div>
          <div className={q.suggest}>
            <Lightbulb size={13} />
            <span>{remedy}</span>
          </div>
        </>
      )}
      <div className={q.dLabel}>
        Affected elements · {issue.nodes.length}
        {issue.viewport ? ` · ${describeViewport(issue.viewport)}` : ''}
      </div>
      <div className={s.nodes}>
        {issue.nodes.map((n, idx) => (
          <div key={idx} className={s.node}>
            <div className={s.nodeHead}>
              <button className={s.nodeSel} onClick={() => void revealSelector(n.selector, { nodeId: n.nodeId })} title="Select on canvas">
                {n.selector}
              </button>
              <Tooltip content="Diagnose with AI">
                <IconButton
                  size="sm"
                  label="Ask AI"
                  tone="violet"
                  onClick={async () => {
                    await revealSelector(n.selector, { nodeId: n.nodeId, quiet: true });
                    bus.emit('ai-diagnose', { nodeId: studio().selection.nodeId ?? n.nodeId });
                    studio().setRightTab('ai');
                  }}
                >
                  <Sparkles size={12} />
                </IconButton>
              </Tooltip>
            </div>
            {n.html && n.html !== n.selector && <code className={s.html}>{n.html}</code>}
            {n.summary && <div className={s.summary}>{n.summary.replace(/^Fix (any|all) of the following:\s*/i, '')}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Keyboard                                                            */
/* ------------------------------------------------------------------ */

function KeyboardView() {
  const lab = useA11yLab();
  const ready = useStudio((st) => st.instances.primary?.status === 'ready');
  const kb = lab.keyboard;
  const running = lab.keyboardStatus === 'running';
  const noFocus = kb?.order.filter((o) => !o.visibleFocus).length ?? 0;
  const run = () => void runKeyboardAudit().catch(() => {});
  if (!kb)
    return (
      <div className={q.center}>
        <div className={q.runCard}>
          <QaEmpty icon={<Keyboard size={18} />} title="Keyboard test">
            Walks the Tab order of the canvas page, checks that each stop shows a visible focus indicator, and lists controls the keyboard cannot reach. Focus is moved briefly and restored.
          </QaEmpty>
          {lab.keyboardError && <Notice tone="danger">{lab.keyboardError}</Notice>}
          <Button variant="primary" icon={running ? <Spinner size={11} /> : <Keyboard size={13} />} disabled={!ready || running} onClick={run}>
            Run keyboard test
          </Button>
        </div>
      </div>
    );
  return (
    <div className={q.body}>
      <div className={q.list}>
        <div className={s.kbHead}>
          <span>
            <b>{kb.order.length}</b> tab stops
          </span>
          <span className={q.muted}>in DOM / tabindex order</span>
        </div>
        {kb.order.map((o, i) => {
          const [label, name] = o.label.split(' — ');
          return (
            <button key={o.id} className={s.stopRow} onClick={() => void revealSelector('', { nodeId: o.id })}>
              <span className={s.stopNum} data-warn={o.visibleFocus ? undefined : 'true'}>
                {i + 1}
              </span>
              <span className={s.stopName}>{name || 'unnamed'}</span>
              <span className={q.rowSel}>{label}</span>
              {o.visibleFocus ? (
                <Tooltip content="Focus changes the outline, shadow, border or background">
                  <CircleCheck size={13} className={s.ok} />
                </Tooltip>
              ) : (
                <Tooltip content="No visible focus indicator detected (outline, box-shadow, border and background unchanged on focus)">
                  <TriangleAlert size={13} className={s.warn} />
                </Tooltip>
              )}
            </button>
          );
        })}
      </div>
      <div className={q.detail}>
        <div className={s.kbStats}>
          <div className={s.stat}>
            <b>{kb.order.length}</b>
            <span>Tab stops</span>
          </div>
          <div className={s.stat} data-tone={noFocus ? 'warning' : 'success'}>
            <b>{noFocus}</b>
            <span>No visible focus</span>
          </div>
          <div className={s.stat} data-tone={kb.traps.length ? 'danger' : 'success'}>
            <b>{kb.traps.length}</b>
            <span>Unreachable</span>
          </div>
        </div>
        <label className={s.switchRow}>
          <Switch checked={lab.overlay} onChange={(v) => void toggleTabOrderOverlay(v)} ariaLabel="Show tab order on canvas" />
          <span>
            Show numbered tab order on the canvas
            <span className={q.muted}> · stops without visible focus are amber</span>
          </span>
        </label>
        <div className={q.dLabel}>Pointer-only controls</div>
        {kb.traps.length ? (
          <div className={s.nodes}>
            {kb.traps.map((t, i) => (
              <div key={i} className={s.node}>
                <div className={s.nodeHead}>
                  <button className={s.nodeSel} onClick={() => void revealSelector(t.selector, { nodeId: t.nodeId })}>
                    {t.selector}
                  </button>
                  <Badge tone="danger">not focusable</Badge>
                </div>
                <div className={s.summary}>Looks interactive ({t.reason}) but Tab never reaches it and it has no interactive role.</div>
              </div>
            ))}
          </div>
        ) : (
          <div className={q.dText}>
            <CircleCheck size={12} className={s.ok} style={{ verticalAlign: -2 }} /> No element with a pointer cursor or inline click handler is missing from the Tab order.
          </div>
        )}
        <Notice tone="info">
          Click handlers added with <code>addEventListener</code> are only visible when <b>Instrument event listeners</b> is on in Settings; this test otherwise relies on pointer cursors and inline handlers.
        </Notice>
        <div className={q.actions}>
          <Button size="sm" icon={running ? <Spinner size={11} /> : <RefreshCw size={12} />} disabled={!ready || running} onClick={run}>
            Re-run keyboard test
          </Button>
          <span className={q.status}>
            {describeViewport(kb.viewport)} · {timeAgo(kb.at)}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Manual checklist                                                    */
/* ------------------------------------------------------------------ */

function Checklist({ state, onChange }: { state: ChecklistState; onChange: (s: ChecklistState) => void }) {
  const p = checklistProgress(state);
  const set = (id: string, patch: Partial<{ status: ChecklistStatus; note: string }>) => onChange({ ...state, [id]: { ...state[id], status: patch.status ?? state[id]?.status ?? 'untested', ...(patch.note !== undefined ? { note: patch.note } : {}), at: Date.now() } });
  return (
    <div className={s.checklist}>
      <div className={s.checkHead}>
        <div>
          <div className={s.checkTitle}>Manual testing</div>
          <div className={q.muted} style={{ fontSize: 11 }}>
            Saved in this browser for this project. {p.failed ? `${p.failed} failing.` : ''}
          </div>
        </div>
        <div className={s.meter} aria-label={`${p.done} of ${p.total} checks recorded`}>
          <span style={{ width: `${(p.done / p.total) * 100}%` }} data-bad={p.failed ? 'true' : undefined} />
        </div>
        <span className={s.meterText}>
          {p.done}/{p.total}
        </span>
      </div>
      {CHECKLIST.map((item) => {
        const st = state[item.id]?.status ?? 'untested';
        return (
          <div key={item.id} className={s.checkItem} data-status={st}>
            <span className={s.checkIcon}>{st === 'pass' ? <CircleCheck size={14} /> : st === 'fail' ? <CircleAlert size={14} /> : <span className={s.checkDot} />}</span>
            <div className={s.checkBody}>
              <div className={s.checkName}>
                {item.title} <span className={q.muted}>WCAG {item.wcag}</span>
              </div>
              <div className={s.checkHow}>{item.how}</div>
              {(st === 'fail' || state[item.id]?.note) && <TextField value={state[item.id]?.note ?? ''} onCommit={(note) => set(item.id, { note })} placeholder="What failed? (where, which assistive technology)" className={s.checkNote} />}
            </div>
            <Segmented
              ariaLabel={`Result for ${item.title}`}
              value={st}
              onChange={(v) => set(item.id, { status: v })}
              options={[
                { value: 'untested', label: '—', title: 'Not tested' },
                { value: 'pass', label: 'Pass' },
                { value: 'fail', label: 'Fail' },
                { value: 'na', label: 'N/A' },
              ]}
            />
          </div>
        );
      })}
    </div>
  );
}

function toMarkdown(issues: A11yIssue[], project: string, route: string, checklist: ChecklistState): string {
  const lines = [`# Accessibility findings — ${project} ${route}`, '', `> ${NOTE}`, ''];
  for (const impact of IMPACT_ORDER) {
    const list = issues.filter((i) => i.impact === impact);
    if (!list.length) continue;
    lines.push(`## ${SEV_LABEL[impact as IssueSeverity]} (${list.length})`, '');
    for (const i of list) {
      lines.push(`### ${i.help} \`${i.ruleId}\`${isHeuristic(i) ? ' _(IFDY heuristic)_' : ''}`, '', i.description, '', `Docs: ${i.helpUrl}`, '');
      const r = remediationFor(i.ruleId);
      if (r) lines.push(`**Fix:** ${r}`, '');
      for (const n of i.nodes) lines.push(`- \`${n.selector}\`${n.summary ? ` — ${n.summary.replace(/\n/g, ' ')}` : ''}`);
      lines.push('');
    }
  }
  lines.push('## Manual checklist', '');
  for (const c of CHECKLIST) lines.push(`- [${checklist[c.id]?.status === 'pass' ? 'x' : ' '}] ${c.title} — ${checklist[c.id]?.status ?? 'untested'}${checklist[c.id]?.note ? ` (${checklist[c.id]?.note})` : ''}`);
  return lines.join('\n');
}
