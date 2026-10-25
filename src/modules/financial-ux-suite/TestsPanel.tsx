import { Copy, Download, FileCode2, FileJson, FileText, FlaskConical, Grid3x3, Info, Monitor, Play, RotateCcw, Square, Trash2, Workflow } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Scenario, ScenarioRun, ViewportContext, ViewportState } from '@shared/types';
import { Badge, Button, IconButton, Menu, Segmented, Select, Switch, Tooltip, type Tone } from '@/ui';
import { studio, useStudio } from '@/store';
import { runAction } from '@/app/actions';
import { DeviceGlyph } from '@/app/toolbar/DevicePicker';
import { viewportContext } from '@/modules/device-simulator/viewport';
import {
  buildReproSteps,
  contextFor,
  formatMs,
  isA11yIssue,
  issueSeverity,
  issueTarget,
  issueTitle,
  latestRuns,
  runBatch,
  runCellKey,
  runDuration,
  setMatrix,
  showInTimeline,
  stopRuns,
  summarizeRuns,
  useRunner,
  viewportKey,
  viewportLabel,
} from '@/modules/interaction-replayer';
import { MatrixDialog } from '@/modules/interaction-replayer/MatrixDialog';
import { PanelEmpty, StatusGlyph, StepIcon } from '@/modules/interaction-recorder/bits';
import { buildTestReport, downloadText, SCOPE_NOTE } from './report';
import { FINANCIAL_SUITES, isFinancialScenario } from './scenarios';
import { runSuite, scenariosForScope } from './index';
import s from './tests.module.css';

type Column = { key: string; ctx: ViewportContext; state: ViewportState; extra: boolean };

const SEVERITY_TONE: Record<string, Tone> = { critical: 'danger', serious: 'danger', moderate: 'warning', minor: 'neutral', info: 'info' };

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

export function TestsPanel() {
  const project = useStudio((st) => st.project);
  const scenarios = useStudio((st) => st.scenarios);
  const runs = useStudio((st) => st.runs);
  const routes = useStudio((st) => st.routes);
  const viewport = useStudio((st) => st.viewport);
  const device = useStudio((st) => st.device());
  const active = useRunner((r) => r.active);
  const matrix = useRunner((r) => r.matrix);
  const audits = useRunner((r) => r.audits);
  const pauseOnFailure = useRunner((r) => r.pauseOnFailure);
  const scope = useRunner((r) => r.scope);
  const target = useRunner((r) => r.target);
  const selection = useRunner((r) => r.testsSelection);
  const lastBatch = useRunner((r) => r.lastBatch);
  const [matrixOpen, setMatrixOpen] = useState(false);

  const scoped = useMemo(() => scenariosForScope(scenarios, scope), [scenarios, scope]);
  const scopedIds = useMemo(() => new Set(scoped.map((x) => x.id)), [scoped]);
  const scopedRuns = useMemo(() => runs.filter((r) => scopedIds.has(r.scenarioId)), [runs, scopedIds]);
  const cells = useMemo(() => latestRuns(scopedRuns), [scopedRuns]);

  const columns = useMemo<Column[]>(() => {
    const devices = studio().allDevices();
    const cur = viewportContext(device, viewport.posture, viewport.orientation);
    const base: Column[] =
      target === 'matrix'
        ? matrix.map((v) => ({ v, ctx: contextFor(v, devices) })).filter((x): x is { v: ViewportState; ctx: ViewportContext } => Boolean(x.ctx)).map(({ v, ctx }) => ({ key: viewportKey(ctx), ctx, state: v, extra: false }))
        : [{ key: viewportKey(cur), ctx: cur, state: { ...viewport, posture: cur.posture }, extra: false }];
    const seen = new Set(base.map((c) => c.key));
    for (const r of scopedRuns) {
      const k = viewportKey(r.viewport);
      if (seen.has(k)) continue;
      seen.add(k);
      base.push({ key: k, ctx: r.viewport, state: { deviceId: r.viewport.deviceId, posture: r.viewport.posture, orientation: r.viewport.orientation }, extra: true });
    }
    return base;
  }, [target, matrix, viewport, device, scopedRuns]);

  const gridRuns = useMemo(() => {
    const out: ScenarioRun[] = [];
    for (const sc of scoped) for (const c of columns) {
      const r = cells.get(runCellKey(sc.id, c.ctx));
      if (r) out.push(r);
    }
    return out;
  }, [scoped, columns, cells]);
  const summary = useMemo(() => summarizeRuns(gridRuns.filter((r) => r.status !== 'running')), [gridRuns]);
  const selectedRun = runs.find((r) => r.id === selection) ?? null;

  const groups = useMemo(() => {
    const map = new Map<string, Scenario[]>();
    for (const sc of scoped) map.set(sc.suite ?? 'Scenarios', [...(map.get(sc.suite ?? 'Scenarios') ?? []), sc]);
    const order = (k: string) => (FINANCIAL_SUITES.includes(k) ? FINANCIAL_SUITES.indexOf(k) : 50);
    return [...map.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
  }, [scoped]);

  if (!project) {
    return (
      <div className={s.center}>
        <PanelEmpty
          icon={FlaskConical}
          title="Financial UX tests"
          action={
            <Button variant="primary" onClick={() => runAction('project.openDemo')}>
              Open the Harborline demo
            </Button>
          }
        >
          Run scenario suites across a device matrix and export reports. {SCOPE_NOTE}
        </PanelEmpty>
      </div>
    );
  }

  const busy = Boolean(active);
  const finCount = scenarios.filter(isFinancialScenario).length;
  const suites = [...new Set(scenarios.map((x) => x.suite ?? 'Scenarios'))];
  const scopeOptions = [
    ...(finCount ? [{ value: 'financial', label: `Financial UX suite · ${finCount}` }] : []),
    { value: 'all', label: `All scenarios · ${scenarios.length}` },
    ...suites.map((x) => ({ value: x, label: `${x} · ${scenarios.filter((y) => (y.suite ?? 'Scenarios') === x).length}` })),
  ];
  const runCount = scoped.length * (target === 'matrix' ? matrix.length : 1);
  const devices = studio().allDevices();
  const routeLabel = (r: string) => routes.find((x) => x.path === r)?.label ?? r;
  const deviceName = (id: string) => devices.find((d) => d.id === id)?.name ?? id;

  const start = () => runSuite().catch((e) => toast.error((e as Error).message));
  const runCell = (sc: Scenario, col: Column) =>
    runBatch([sc], { matrix: [col.state], audits, pauseOnFailure, label: `${sc.name} · ${viewportLabel(col.ctx, devices)}` })
      .then((r) => r[0] && useRunner.setState({ testsSelection: r[0].id }))
      .catch((e) => toast.error((e as Error).message));

  const exportReport = (kind: 'md' | 'json' | 'html' | 'open') => {
    const report = buildTestReport(scopedRuns, { scenarios: scoped, projectName: project.name, routeLabel, deviceName });
    if (!report.runs.length) return toast('No finished runs to export yet');
    if (kind === 'md') downloadText(`ifdy-test-report-${stamp()}.md`, report.markdown, 'text/markdown');
    if (kind === 'json') downloadText(`ifdy-test-report-${stamp()}.json`, report.json, 'application/json');
    if (kind === 'html') downloadText(`ifdy-test-report-${stamp()}.html`, report.html, 'text/html');
    if (kind === 'open') {
      const url = URL.createObjectURL(new Blob([report.html], { type: 'text/html' }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  };

  return (
    <div className={s.root}>
      <div className={s.toolbar}>
        {busy ? (
          <Button size="sm" variant="secondary" icon={<Square size={10} fill="currentColor" />} onClick={() => stopRuns()}>
            Stop
          </Button>
        ) : (
          <Tooltip content={`Run ${runCount} run${runCount === 1 ? '' : 's'} sequentially on the canvas`} shortcut="Mod+Enter">
            <Button size="sm" variant="primary" icon={<Play size={11} fill="currentColor" />} disabled={!scoped.length} onClick={start}>
              Run suite
            </Button>
          </Tooltip>
        )}
        <Select ariaLabel="Scenarios to run" value={scopeOptions.some((o) => o.value === scope) ? scope : 'all'} onChange={(v) => useRunner.setState({ scope: v, testsSelection: null })} options={scopeOptions} style={{ width: 196 }} />
        <span className={s.divider} />
        <Segmented
          ariaLabel="Run on"
          value={target}
          onChange={(v) => useRunner.setState({ target: v })}
          options={[
            { value: 'current', label: 'Canvas device', icon: <Monitor size={12} />, title: `Run on ${device.name} as it is` },
            { value: 'matrix', label: `Matrix · ${matrix.length}`, icon: <Grid3x3 size={12} />, title: 'Run on every viewport in the matrix' },
          ]}
        />
        <IconButton size="sm" label="Edit device matrix" disabled={busy} onClick={() => setMatrixOpen(true)}>
          <Grid3x3 size={13} />
        </IconButton>
        <span className={s.divider} />
        <label className={s.toggle} title="Run the responsive and accessibility audits on each run's end state">
          <Switch checked={audits} onChange={(v) => useRunner.setState({ audits: v })} ariaLabel="Audit end state" />
          Audit end state
        </label>
        <label className={s.toggle} title="Stop at a failed step and offer Retry / Continue / Stop">
          <Switch checked={pauseOnFailure} onChange={(v) => useRunner.setState({ pauseOnFailure: v })} ariaLabel="Pause at failures" />
          Pause at failures
        </label>
        <span style={{ flex: 1 }} />
        {active && (
          <div className={s.progress} role="status">
            <span className={s.progressText}>
              <b>
                {active.done + 1 > active.total ? active.total : active.done + 1}/{active.total}
              </b>{' '}
              {active.current ? `${active.current.scenarioName} · ${active.current.viewportLabel}` : active.label}
            </span>
            <span className={s.progressBar}>
              <span style={{ width: `${(active.done / Math.max(1, active.total)) * 100}%` }} />
            </span>
          </div>
        )}
        <Menu
          align="end"
          width={230}
          trigger={
            <span>
              <Button size="sm" variant="secondary" icon={<Download size={12} />} disabled={!scopedRuns.some((r) => r.status !== 'running')}>
                Export
              </Button>
            </span>
          }
          items={[
            { type: 'label', label: 'Test report' },
            { label: 'Markdown (.md)', icon: <FileText size={13} />, onSelect: () => exportReport('md') },
            { label: 'JSON (.json)', icon: <FileJson size={13} />, onSelect: () => exportReport('json') },
            { label: 'Self-contained HTML (.html)', icon: <FileCode2 size={13} />, onSelect: () => exportReport('html') },
            { type: 'separator' },
            { label: 'Open HTML report in a new tab', onSelect: () => exportReport('open') },
          ]}
        />
        <IconButton
          size="sm"
          label="Clear results"
          disabled={busy || !runs.length}
          onClick={() => {
            studio().clearRuns();
            useRunner.setState({ testsSelection: null });
          }}
        >
          <Trash2 size={13} />
        </IconButton>
      </div>

      <div className={s.scope} role="note">
        <Info size={12} />
        <span>{SCOPE_NOTE}</span>
      </div>

      {!scoped.length ? (
        <div className={s.center}>
          <PanelEmpty icon={Workflow} title="No scenarios to run" action={<Button onClick={() => runAction('record.toggle')}>Record an interaction</Button>}>
            Record a scenario, import one, or open the Harborline demo for the built-in financial UX suite.
          </PanelEmpty>
        </div>
      ) : (
        <div className={s.body}>
          <div className={s.main}>
            <div className={s.summary}>
              <Stat label="Passed" value={summary.passed} tone="ok" />
              <Stat label="Failed" value={summary.failed} tone={summary.failed ? 'bad' : undefined} />
              <Stat label="Pass rate" value={summary.passRate === null ? '—' : `${Math.round(summary.passRate * 100)}%`} />
              <Stat label="Duration" value={summary.durationMs ? formatMs(summary.durationMs) : '—'} />
              <Stat label="Issues" value={summary.issues} tone={summary.issues ? 'warn' : undefined} />
              <Stat label="Console errors" value={summary.consoleErrors} tone={summary.consoleErrors ? 'warn' : undefined} />
              <span className={s.summaryNote}>
                {gridRuns.length ? `Latest of ${scopedRuns.length} run${scopedRuns.length === 1 ? '' : 's'}` : `${runCount} run${runCount === 1 ? '' : 's'} ready`}
                {lastBatch && !active ? ` · last batch ${formatMs(lastBatch.finishedAt - lastBatch.startedAt)}${lastBatch.aborted ? ' (stopped)' : ''}` : ''}
              </span>
            </div>
            <div className={s.gridWrap}>
              <div className={s.grid} style={{ gridTemplateColumns: `minmax(190px, 1.2fr) repeat(${columns.length}, minmax(108px, 1fr))` }} role="grid" aria-label="Results by scenario and viewport">
                <div className={s.corner}>Scenario</div>
                {columns.map((c) => {
                  const d = devices.find((x) => x.id === c.ctx.deviceId);
                  return (
                    <div key={c.key} className={s.colHead} data-extra={c.extra ? 'true' : undefined} title={c.extra ? 'Viewport from an earlier run (not in the current target)' : undefined}>
                      {d && (
                        <span className={s.colGlyph}>
                          <DeviceGlyph d={d} size={16} />
                        </span>
                      )}
                      <span className={s.colText}>
                        <span className={s.colName}>{c.ctx.deviceName}</span>
                        <span className={s.colMeta}>
                          {d?.expanded ? `${c.ctx.posture} · ` : ''}
                          {c.ctx.width}×{c.ctx.height}
                        </span>
                      </span>
                    </div>
                  );
                })}
                {groups.map(([suite, list]) => (
                  <GroupRows key={suite} suite={suite} list={list} columns={columns} cells={cells} selection={selection} active={active} busy={busy} onRun={runCell} />
                ))}
              </div>
            </div>
          </div>
          <aside className={s.side}>
            {selectedRun ? (
              <RunDrilldown run={selectedRun} scenario={scenarios.find((x) => x.id === selectedRun.scenarioId)} routeLabel={routeLabel} deviceName={deviceName} busy={busy} />
            ) : (
              <div className={s.sideEmpty}>
                <PanelEmpty icon={FlaskConical} title={gridRuns.length ? 'Select a result' : 'Run the suite'} action={!gridRuns.length && !busy ? <Button variant="primary" icon={<Play size={11} fill="currentColor" />} onClick={start}>Run {runCount} run{runCount === 1 ? '' : 's'}</Button> : undefined}>
                  {gridRuns.length
                    ? 'Pick a cell to see steps, screenshots, detected issues, console errors and numbered reproduction steps.'
                    : `${scoped.length} scenario${scoped.length === 1 ? '' : 's'} on ${target === 'matrix' ? `${matrix.length} viewports` : device.name}. Runs replay one after another on the canvas from a fresh page load.`}
                </PanelEmpty>
              </div>
            )}
          </aside>
        </div>
      )}

      <MatrixDialog
        open={matrixOpen}
        onOpenChange={setMatrixOpen}
        initial={matrix}
        runsPerViewport={scoped.length}
        confirmLabel={(n) => `Use ${n} viewport${n === 1 ? '' : 's'}`}
        onConfirm={(m) => {
          setMatrix(m);
          useRunner.setState({ target: 'matrix' });
        }}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'ok' | 'bad' | 'warn' }) {
  return (
    <div className={s.stat} data-tone={tone}>
      <span className={s.statValue}>{value}</span>
      <span className={s.statLabel}>{label}</span>
    </div>
  );
}

function GroupRows({
  suite,
  list,
  columns,
  cells,
  selection,
  active,
  busy,
  onRun,
}: {
  suite: string;
  list: Scenario[];
  columns: Column[];
  cells: Map<string, ScenarioRun>;
  selection: string | null;
  active: ReturnType<typeof useRunner.getState>['active'];
  busy: boolean;
  onRun: (sc: Scenario, col: Column) => void;
}) {
  return (
    <>
      <div className={s.suiteRow} style={{ gridColumn: `1 / span ${columns.length + 1}` }}>
        {suite}
        <span className={s.suiteCount}>{list.length}</span>
      </div>
      {list.map((sc) => (
        <div key={sc.id} className={s.row} role="row">
          <div className={s.rowHead} title={sc.description}>
            <span className={s.rowName}>{sc.name}</span>
            <span className={s.rowSteps}>{sc.steps.length}</span>
          </div>
          {columns.map((c) => {
            const r = cells.get(runCellKey(sc.id, c.ctx));
            const live = active?.current?.runId && r?.id === active.current.runId;
            const failed = r?.steps.filter((x) => x.status === 'failed').length ?? 0;
            if (!r)
              return (
                <button key={c.key} className={s.cell} data-status="none" disabled={busy} onClick={() => onRun(sc, c)} title={`Run on ${c.ctx.deviceName}`}>
                  <span className={s.cellDash}>—</span>
                  <span className={s.cellRun}>
                    <Play size={10} /> Run
                  </span>
                </button>
              );
            return (
              <button key={c.key} className={s.cell} data-status={live ? 'running' : r.status} data-selected={selection === r.id ? 'true' : undefined} onClick={() => useRunner.setState({ testsSelection: r.id })}>
                <span className={s.cellTop}>
                  <StatusGlyph status={live ? 'running' : r.status} size={12} />
                  <span className={s.cellMs}>{live && active?.current ? `${active.current.stepIndex + 1}/${active.current.stepCount}` : formatMs(runDuration(r))}</span>
                </span>
                {!live && (failed > 0 || r.issues.length > 0) && (
                  <span className={s.cellMeta}>
                    {failed > 0 && <span data-tone="bad">{failed} failed</span>}
                    {r.issues.length > 0 && <span>{r.issues.length} issues</span>}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}

type DrillTab = 'steps' | 'repro' | 'issues' | 'console' | 'shots';

function RunDrilldown({ run, scenario, routeLabel, deviceName, busy }: { run: ScenarioRun; scenario?: Scenario; routeLabel: (r: string) => string; deviceName: (id: string) => string; busy: boolean }) {
  const [tab, setTab] = useState<DrillTab>('steps');
  const devices = studio().allDevices();
  const repro = scenario ? buildReproSteps(scenario, run, { routeLabel, deviceName }) : [];
  const shots = [
    ...run.steps.map((r, i) => ({ src: r.screenshot, label: `Step ${i + 1} · ${scenario?.steps.find((x) => x.id === r.stepId)?.description ?? ''}`, failed: r.status === 'failed' })),
    { src: run.finalScreenshot, label: 'End state', failed: false },
  ].filter((x): x is { src: string; label: string; failed: boolean } => Boolean(x.src));
  const tabs: { id: DrillTab; label: string; count?: number }[] = [
    { id: 'steps', label: 'Steps', count: run.steps.length },
    { id: 'repro', label: 'Reproduce' },
    { id: 'issues', label: 'Issues', count: run.issues.length },
    { id: 'console', label: 'Console', count: run.consoleErrors.length },
    { id: 'shots', label: 'Shots', count: shots.length },
  ];
  const stepById = new Map(scenario?.steps.map((x) => [x.id, x]) ?? []);
  return (
    <div className={s.drill}>
      <div className={s.drillHead}>
        <StatusGlyph status={run.status} size={15} />
        <div className={s.drillTitle}>
          <span className={s.drillName}>{run.scenarioName}</span>
          <span className={s.drillMeta}>
            {viewportLabel(run.viewport, devices)} · {run.viewport.width}×{run.viewport.height} · {formatMs(runDuration(run))}
          </span>
        </div>
        <IconButton
          size="sm"
          label="Open in timeline"
          onClick={() => {
            useRunner.setState({ follow: false });
            showInTimeline({ kind: 'scenario', scenarioId: run.scenarioId, runId: run.id }, run.steps.find((x) => x.status === 'failed')?.stepId ?? null);
            studio().setBottomTab('timeline');
          }}
        >
          <Workflow size={13} />
        </IconButton>
        <IconButton
          size="sm"
          label="Run again on this viewport"
          disabled={busy || !scenario}
          onClick={() =>
            scenario &&
            runBatch([scenario], { matrix: [{ deviceId: run.viewport.deviceId, posture: run.viewport.posture, orientation: run.viewport.orientation }], audits: useRunner.getState().audits, label: scenario.name })
              .then((r) => r[0] && useRunner.setState({ testsSelection: r[0].id }))
              .catch((e) => toast.error((e as Error).message))
          }
        >
          <RotateCcw size={13} />
        </IconButton>
      </div>
      <div className={s.drillTabs} role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={s.drillTab} onClick={() => setTab(t.id)}>
            {t.label}
            {t.count !== undefined && t.count > 0 && <span className={s.drillCount}>{t.count}</span>}
          </button>
        ))}
      </div>
      <div className={s.drillBody}>
        {tab === 'steps' &&
          run.steps.map((r, i) => {
            const st = stepById.get(r.stepId);
            return (
              <div key={r.stepId} className={s.stepRow} data-status={r.status}>
                <span className={s.stepIndex}>{i + 1}</span>
                {st && <StepIcon type={st.action.type} size={10} />}
                <div className={s.stepText}>
                  <span className={s.stepDesc}>{st?.description ?? r.stepId}</span>
                  {r.error && <span className={s.stepErr} data-tone={r.status === 'failed' ? 'bad' : 'muted'}>{r.error}</span>}
                </div>
                <span className={s.stepMs}>{r.status === 'skipped' ? '' : formatMs(r.durationMs)}</span>
                <StatusGlyph status={r.status} size={12} />
              </div>
            );
          })}
        {tab === 'repro' && (
          <div className={s.repro}>
            <ol>
              {repro.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ol>
            <Button
              size="sm"
              variant="secondary"
              icon={<Copy size={12} />}
              onClick={() =>
                navigator.clipboard
                  .writeText(`**${run.scenarioName}** — ${viewportLabel(run.viewport, devices)} (${run.viewport.width}×${run.viewport.height})\n\n${repro.map((l, i) => `${i + 1}. ${l}`).join('\n')}`)
                  .then(() => toast.success('Reproduction steps copied'))
                  .catch(() => toast.error('Clipboard unavailable'))
              }
            >
              Copy as Markdown
            </Button>
            <p className={s.hint}>Generated from the recorded steps. Secrets are named by fixture, never shown.</p>
          </div>
        )}
        {tab === 'issues' &&
          (run.issues.length ? (
            run.issues.map((i) => (
              <div key={i.id} className={s.issue}>
                <Badge tone={SEVERITY_TONE[String(issueSeverity(i))] ?? 'neutral'}>{String(issueSeverity(i))}</Badge>
                <div className={s.issueText}>
                  <span className={s.issueTitle}>{issueTitle(i)}</span>
                  {!isA11yIssue(i) && <span className={s.issueMsg}>{i.message}</span>}
                  {issueTarget(i) && <code className={s.issueSel}>{issueTarget(i)}</code>}
                </div>
                <span className={s.issueKind}>{isA11yIssue(i) ? 'a11y' : 'layout'}</span>
              </div>
            ))
          ) : (
            <p className={s.none}>{useRunner.getState().audits ? 'No issues detected in the end state.' : 'End-state audits were off for this run.'}</p>
          ))}
        {tab === 'console' &&
          (run.consoleErrors.length ? (
            run.consoleErrors.map((c, i) => (
              <pre key={i} className={s.console}>
                {c}
              </pre>
            ))
          ) : (
            <p className={s.none}>No console errors from the preview during this run.</p>
          ))}
        {tab === 'shots' &&
          (shots.length ? (
            <div className={s.shots}>
              {shots.map((x, i) => (
                <a key={i} className={s.shot} data-failed={x.failed ? 'true' : undefined} href={x.src} target="_blank" rel="noreferrer">
                  <img src={x.src} alt="" />
                  <span>{x.label}</span>
                </a>
              ))}
            </div>
          ) : (
            <p className={s.none}>No screenshots for this run.</p>
          ))}
      </div>
    </div>
  );
}
