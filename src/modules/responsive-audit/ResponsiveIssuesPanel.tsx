import { ChevronDown, Crosshair, Download, Lightbulb, Monitor, MonitorSmartphone, Play, RefreshCw, Smartphone, Sparkles, TabletSmartphone } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { IssueSeverity, ResponsiveIssue } from '@shared/types';
import { Badge, Button, Checkbox, EmptyState, IconButton, Menu, Notice, Popover, SearchInput, Segmented, Spinner, Tooltip } from '@/ui';
import { art } from '@/app/art';
import { bus } from '@/lib/events';
import { studio, useStudio } from '@/store';
import { describeViewport } from '@/modules/device-simulator/viewport';
import { downloadText } from '@/modules/screenshots/capture';
import { CLASS_LABEL, filterIssues, groupIssues, issuesToJson, issuesToMarkdown, ruleLabel, SEVERITY_ORDER, viewportKey, type Classification, type ViewportGroup } from './classify';
import { ClassBadge, CodeLine, EvidenceChips, SevBadge, SevDot, timeAgo, useTick, useWidth, SEV_LABEL } from './bits';
import { defaultProfiles, findDevice, loadExtraProfiles, parseStateKey, REFERENCE_PROFILES, resolveProfile, saveExtraProfiles } from './profiles';
import { isCurrentViewport, revealIn, revealSelector } from './reveal';
import { runResponsiveAudit, useResponsiveAudit } from './runner';
import { useAuditWorker, workerSupport } from './worker';
import s from './qa.module.css';

const SEVS: IssueSeverity[] = SEVERITY_ORDER.filter((x) => x !== 'info');

function groupIcon(g: ViewportGroup) {
  const d = findDevice(g.viewport.deviceId);
  if (d?.category === 'desktop') return <Monitor size={11} />;
  if (d?.expanded) return <TabletSmartphone size={11} />;
  if (d?.category === 'tablet') return <MonitorSmartphone size={11} />;
  return <Smartphone size={11} />;
}

export function ResponsiveIssuesPanel() {
  useTick();
  const project = useStudio((st) => st.project);
  const issues = useStudio((st) => st.responsiveIssues);
  const status = useStudio((st) => st.auditStatus.responsive);
  const statusError = useStudio((st) => st.auditStatus.error);
  const route = useStudio((st) => st.currentRoute);
  const ready = useStudio((st) => st.instances.primary?.status === 'ready');
  const viewportState = useStudio((st) => st.viewport);
  const { progress, runs, durationMs, startedAt, route: auditedRoute } = useResponsiveAudit();
  const workerBusy = useAuditWorker((w) => w.busy);

  const [sevs, setSevs] = useState<IssueSeverity[]>([]);
  const [klass, setKlass] = useState<Classification | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [ref, width] = useWidth<HTMLDivElement>();

  const filtered = useMemo(() => filterIssues(issues, { severities: sevs, classification: klass, query }), [issues, sevs, klass, query]);
  const groups = useMemo(() => groupIssues(filtered), [filtered]);
  const flat = useMemo(() => groups.flatMap((g) => (collapsed[g.key] ? [] : g.rules.flatMap((r) => (collapsed[`${g.key}|${r.rule}`] ? [] : r.issues)))), [groups, collapsed]);
  const selected = issues.find((i) => i.id === selectedId) ?? null;
  const running = status === 'running';
  const sevCounts = useMemo(() => {
    const c: Partial<Record<IssueSeverity, number>> = {};
    for (const i of filterIssues(issues, { classification: klass, query })) c[i.severity] = (c[i.severity] ?? 0) + 1;
    return c;
  }, [issues, klass, query]);
  const classCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of issues) c[i.classification] = (c[i.classification] ?? 0) + 1;
    return c;
  }, [issues]);
  const plannedCount = useMemo(() => {
    void viewportState;
    return defaultProfiles().length;
  }, [viewportState, runs]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = () => {
    void runResponsiveAudit().catch(() => {});
  };

  const pick = (i: ResponsiveIssue) => {
    setSelectedId(i.id);
    if (isCurrentViewport(i.viewport)) void revealSelector(i.selector, { nodeId: i.nodeId, quiet: true });
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const idx = flat.findIndex((i) => i.id === selectedId);
    const next = flat[Math.min(flat.length - 1, Math.max(0, idx + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      pick(next);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-issue-id="${CSS.escape(next.id)}"]`)?.focus());
    }
  };

  const exportAs = (kind: 'json' | 'md') => {
    const meta = { project: project?.name, route: auditedRoute ?? route, viewports: runs.map((r) => ({ ...r.viewport, source: r.source, error: r.error })) };
    if (kind === 'json') downloadText(issuesToJson(filtered, meta), 'ifdy-responsive-audit.json', 'application/json');
    else downloadText(issuesToMarkdown(filtered, `Responsive audit — ${project?.name ?? ''} ${auditedRoute ?? route}`), 'ifdy-responsive-audit.md', 'text/markdown');
  };

  if (!project) {
    return (
      <div className={s.center}>
        <EmptyState art={art.test} title="Responsive audit">
          Open a project to audit it across devices and postures.
        </EmptyState>
      </div>
    );
  }

  const hasRun = status !== 'idle' || issues.length > 0;
  const failedRuns = runs.filter((r) => r.error);
  const stale = hasRun && !running && auditedRoute !== null && auditedRoute !== route;

  return (
    <div className={`${s.panel} ${width && width < 760 ? s.narrow : ''}`} ref={ref}>
      <div className={s.toolbar}>
        <div className={s.toolbarGroup}>
          <Button size="sm" variant="primary" icon={running ? <Spinner size={11} /> : hasRun ? <RefreshCw size={12} /> : <Play size={12} fill="currentColor" />} disabled={!ready || running} onClick={run} title={!ready ? 'Waiting for the preview' : undefined}>
            {running ? 'Auditing…' : hasRun ? 'Re-run' : 'Run audit'}
          </Button>
          <ViewportPicker count={plannedCount} />
        </div>
        <span className={s.chips} role="group" aria-label="Severity filter">
          {SEVS.map((sev) => {
            const on = sevs.includes(sev);
            const n = sevCounts[sev] ?? 0;
            return (
              <button key={sev} className={s.chip} data-on={on ? 'true' : undefined} data-empty={!n ? 'true' : undefined} aria-pressed={on} onClick={() => setSevs(on ? sevs.filter((x) => x !== sev) : [...sevs, sev])}>
                <SevDot severity={sev} />
                {SEV_LABEL[sev]}
                <span className={s.chipCount}>{n}</span>
              </button>
            );
          })}
        </span>
        <Segmented
          ariaLabel="Classification"
          value={klass}
          onChange={setKlass}
          options={[
            { value: 'all', label: 'All' },
            { value: 'regression', label: <SegLabel text="Regressions" n={classCounts.regression} />, title: CLASS_LABEL.regression },
            { value: 'suspicious', label: <SegLabel text="Review" n={classCounts.suspicious} />, title: CLASS_LABEL.suspicious },
            { value: 'expected', label: <SegLabel text="Expected" n={classCounts.expected} />, title: CLASS_LABEL.expected },
          ]}
        />
        <span className={s.spacer} />
        <span className={s.status} aria-live="polite">
          {running && progress ? (
            <>
              <Spinner size={10} /> <b>{progress.label}</b> {progress.done + 1}/{progress.total}
            </>
          ) : workerBusy && !running ? (
            <>
              <Spinner size={10} /> {workerBusy}
            </>
          ) : runs.length ? (
            <>
              <b>{runs.length}</b> viewport{runs.length === 1 ? '' : 's'} · {durationMs ? `${(durationMs / 1000).toFixed(1)}s` : ''} · {timeAgo(startedAt)}
            </>
          ) : null}
        </span>
        <SearchInput className={s.search} value={query} onChange={setQuery} placeholder="Filter findings" />
        <Menu
          align="end"
          trigger={
            <span>
              <IconButton size="sm" label="Export findings" disabled={!issues.length}>
                <Download size={13} />
              </IconButton>
            </span>
          }
          items={[
            { type: 'label', label: `Export ${filtered.length} finding${filtered.length === 1 ? '' : 's'}` },
            { label: 'Markdown report (.md)', onSelect: () => exportAs('md') },
            { label: 'JSON (.json)', onSelect: () => exportAs('json') },
          ]}
        />
        {running && progress && <span className={s.progress} style={{ width: `${((progress.done + 0.5) / progress.total) * 100}%` }} />}
      </div>

      {statusError && status === 'error' && (
        <div style={{ padding: '8px 10px 0' }}>
          <Notice tone="danger">
            <b>Audit failed.</b> {statusError}
          </Notice>
        </div>
      )}
      {(failedRuns.length > 0 || stale) && !running && (
        <div style={{ padding: '8px 10px 0', display: 'grid', gap: 6 }}>
          {stale && (
            <Notice tone="info">
              These results are for <b className={s.mono}>{auditedRoute || 'the start page'}</b>; the canvas now shows <b className={s.mono}>{route || 'the start page'}</b>.{' '}
              <Button size="sm" variant="ghost" onClick={run}>
                Re-run here
              </Button>
            </Notice>
          )}
          {failedRuns.length > 0 && (
            <Notice tone="warning">
              Not audited: {failedRuns.map((r) => `${describeViewport(r.viewport)} (${r.error})`).join('; ')}
            </Notice>
          )}
        </div>
      )}

      {!hasRun ? (
        <NeverRun onRun={run} ready={ready} />
      ) : running && !issues.length ? (
        <div className={s.list} style={{ borderRight: 0 }}>
          {[62, 48, 70, 40, 56].map((w, i) => (
            <div key={i} className={s.skeleton} style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : !issues.length ? (
        <div className={s.center}>
          <EmptyState art={art.simulate} title={`No responsive issues at ${runs.length || 'the audited'} viewport${runs.length === 1 ? '' : 's'}`}>
            <span style={{ display: 'block', marginBottom: 8 }}>Automated checks found nothing to flag. Confirm on real devices before shipping.</span>
            <span className={s.vpPills}>
              {runs.map((r) => (
                <Badge key={viewportKey(r.viewport)} tone={r.error ? 'warning' : 'success'}>
                  {describeViewport(r.viewport)}
                </Badge>
              ))}
            </span>
          </EmptyState>
        </div>
      ) : (
        <div className={s.body}>
          <div className={s.list} role="tree" aria-label="Responsive findings" onKeyDown={onListKey}>
            {!groups.length && (
              <EmptyState title="No findings match the filters">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSevs([]);
                    setKlass('all');
                    setQuery('');
                  }}
                >
                  Clear filters
                </Button>
              </EmptyState>
            )}
            {groups.map((g) => {
              const open = !collapsed[g.key];
              const current = isCurrentViewport(g.viewport);
              const src = runs.find((r) => viewportKey(r.viewport) === g.key)?.source;
              return (
                <div key={g.key} className={s.group} role="group">
                  <button className={s.groupHead} aria-expanded={open} onClick={() => setCollapsed({ ...collapsed, [g.key]: open })}>
                    <ChevronDown size={12} className={s.groupChevron} />
                    <span className={s.groupIcon}>{groupIcon(g)}</span>
                    {g.label}
                    <span className={s.groupMeta}>
                      {g.viewport.width}×{g.viewport.height}
                    </span>
                    {current ? <Badge tone="accent">Canvas</Badge> : src === 'worker' ? <Badge tone="outline">Background</Badge> : null}
                    <span className={s.spacer} />
                    <SevDot severity={g.worst} />
                    <span className={s.ruleCount}>{g.count}</span>
                  </button>
                  {open &&
                    g.rules.map((r) => {
                      const rk = `${g.key}|${r.rule}`;
                      const ropen = !collapsed[rk];
                      return (
                        <div key={rk}>
                          <button className={s.ruleHead} aria-expanded={ropen} onClick={() => setCollapsed({ ...collapsed, [rk]: ropen })}>
                            <ChevronDown size={11} className={s.groupChevron} style={{ transform: ropen ? undefined : 'rotate(-90deg)' }} />
                            {r.label}
                            <span className={s.ruleCount}>{r.issues.length}</span>
                          </button>
                          {ropen &&
                            r.issues.map((i) => (
                              <button key={i.id} className={s.row} data-issue-id={i.id} data-active={i.id === selectedId ? 'true' : undefined} onClick={() => pick(i)} role="treeitem" aria-selected={i.id === selectedId}>
                                <SevDot severity={i.severity} />
                                <span className={s.rowMain}>
                                  <span className={s.rowTitle}>{i.title}</span>
                                  <span className={s.rowSel}>{i.selector}</span>
                                </span>
                                <span className={s.rowTags}>
                                  {i.evidence.onlyIn && <Badge tone="outline">{String(i.evidence.onlyIn)} only</Badge>}
                                  <ClassBadge c={i.classification} />
                                </span>
                              </button>
                            ))}
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </div>
          <div className={s.detail}>{selected ? <IssueDetail issue={selected} /> : <DetailHint count={filtered.length} />}</div>
        </div>
      )}
    </div>
  );
}

function SegLabel({ text, n }: { text: string; n?: number }) {
  return (
    <>
      {text}
      <span className={s.segCount}>{n ?? 0}</span>
    </>
  );
}

function NeverRun({ onRun, ready }: { onRun: () => void; ready: boolean }) {
  const profiles = defaultProfiles().map(resolveProfile).filter(Boolean);
  const sup = workerSupport();
  return (
    <div className={s.center}>
      <div className={s.runCard}>
        <EmptyState art={art.simulate} title="Audit every posture and breakpoint">
          Finds horizontal overflow, controls under a hinge or fold, hidden primary actions, small tap targets, tiny text, long lines and overlapping controls — then compares postures to separate likely regressions from intentional layout changes.
        </EmptyState>
        <span className={s.vpPills}>
          {profiles.map((p) => (
            <Badge key={viewportKey(p!.ctx)} tone={isCurrentViewport(p!.ctx) ? 'accent' : 'outline'}>
              {describeViewport(p!.ctx)}
            </Badge>
          ))}
        </span>
        {!sup.ok && <Notice tone="info">{sup.reason}</Notice>}
        <Button variant="primary" icon={<Play size={12} fill="currentColor" />} onClick={onRun} disabled={!ready}>
          Run responsive audit
        </Button>
      </div>
    </div>
  );
}

function DetailHint({ count }: { count: number }) {
  return (
    <div className={s.center} style={{ height: '100%' }}>
      <EmptyState title={`${count} finding${count === 1 ? '' : 's'}`}>Select a finding to see its evidence and locate the element. Use ↑ ↓ to move through the list.</EmptyState>
    </div>
  );
}

function IssueDetail({ issue }: { issue: ResponsiveIssue }) {
  const current = isCurrentViewport(issue.viewport);
  const [busy, setBusy] = useState(false);
  const locate = async () => {
    setBusy(true);
    try {
      await revealIn(issue.viewport, issue.selector, issue.nodeId);
    } finally {
      setBusy(false);
    }
  };
  const askAi = async () => {
    // Make sure the AI module sees the element: select it on the canvas first when possible.
    let nodeId: number | undefined;
    if (current && (await revealSelector(issue.selector, { nodeId: issue.nodeId, quiet: true }))) nodeId = studio().selection.nodeId ?? undefined;
    bus.emit('ai-diagnose', { nodeId });
    studio().setRightTab('ai');
  };
  const { onlyIn, seenIn, ...evidence } = issue.evidence;
  return (
    <div>
      <div className={s.dHead}>
        <SevBadge severity={issue.severity} />
        <ClassBadge c={issue.classification} long />
        <Badge tone="outline">{ruleLabel(issue.rule)}</Badge>
      </div>
      <div className={s.dTitle}>{issue.title}</div>
      <div className={s.dText}>{issue.message}</div>

      <div className={s.dLabel}>Element</div>
      <CodeLine copy={issue.selector}>{issue.selector}</CodeLine>

      <div className={s.dLabel}>Viewport</div>
      <div className={s.vpLine}>
        <span>{describeViewport(issue.viewport)}</span>
        {current ? <Badge tone="accent">On canvas</Badge> : <Badge tone="outline">Measured in background preview</Badge>}
        {seenIn !== undefined && <Badge tone="neutral">Seen in {String(seenIn)}</Badge>}
        {onlyIn !== undefined && <Badge tone="warning">{String(onlyIn)} posture only</Badge>}
      </div>

      <div className={s.dLabel}>Evidence</div>
      <EvidenceChips evidence={evidence} />

      {issue.suggestion && (
        <>
          <div className={s.dLabel}>Suggestion</div>
          <div className={s.suggest}>
            <Lightbulb size={13} />
            <span>{issue.suggestion}</span>
          </div>
        </>
      )}

      <div className={s.actions}>
        {current ? (
          <Button size="sm" icon={<Crosshair size={12} />} onClick={locate} disabled={busy || issue.selector === 'document'}>
            Select element
          </Button>
        ) : (
          <Tooltip content={`Puts the canvas device in ${describeViewport(issue.viewport)} and selects the element`}>
            <Button size="sm" variant="primary" icon={busy ? <Spinner size={11} /> : <TabletSmartphone size={12} />} onClick={locate} disabled={busy}>
              Switch to this viewport
            </Button>
          </Tooltip>
        )}
        <Button size="sm" variant="violet" icon={<Sparkles size={12} />} onClick={askAi}>
          Ask AI
        </Button>
      </div>
    </div>
  );
}

function ViewportPicker({ count }: { count: number }) {
  const [extras, setExtras] = useState<string[]>(() => loadExtraProfiles());
  const device = useStudio((st) => st.device());
  const toggle = (k: string, on: boolean) => {
    const next = on ? [...extras, k] : extras.filter((x) => x !== k);
    setExtras(next);
    saveExtraProfiles(next);
  };
  return (
    <Popover
      align="start"
      width={300}
      trigger={
        <Button size="sm" variant="ghost" trailing={<ChevronDown size={11} />} icon={<MonitorSmartphone size={12} />}>
          {count} viewport{count === 1 ? '' : 's'}
        </Button>
      }
    >
      <div className={s.menuTitle}>Audited viewports</div>
      <div className={s.menuHint}>
        The canvas viewport is audited live; the others run in a hidden background preview so your page state is untouched. {device.expanded ? `${device.name} is always audited folded and expanded.` : ''}
      </div>
      <div className={s.menuRow} title="Always audited">
        <Checkbox checked onChange={() => {}} label={`${device.name} ${device.expanded ? '(folded + expanded)' : '(canvas device)'}`} />
        <span className={s.menuSize}>canvas</span>
      </div>
      {REFERENCE_PROFILES.map((k) => {
        const st = parseStateKey(k)!;
        const p = resolveProfile(st);
        if (!p || (st.deviceId === device.id && st.orientation === 'portrait')) return null;
        return (
          <div key={k} className={s.menuRow}>
            <Checkbox checked={extras.includes(k)} onChange={(v) => toggle(k, v)} label={`${p.device.name}${p.device.expanded ? ` · ${st.posture}` : ''}`} />
            <span className={s.menuSize}>
              {p.ctx.width}×{p.ctx.height}
            </span>
          </div>
        );
      })}
    </Popover>
  );
}
