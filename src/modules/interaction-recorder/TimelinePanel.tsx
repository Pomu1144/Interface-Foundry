import { ChevronDown, Circle, Copy, GitCompareArrows, Lock, MoreHorizontal, Play, Plus, RotateCcw, SkipForward, Square, StepForward, Workflow } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import type { Scenario, ScenarioRun, StepResult, TestStep, ViewportContext } from '@shared/types';
import { Badge, Button, IconButton, Menu, Select, Tooltip, type MenuEntry } from '@/ui';
import { studio, useStudio } from '@/store';
import { runAction } from '@/app/actions';
import { canFold } from '@/modules/device-simulator/viewport';
import { currentViewportContext } from '@/modules/device-simulator/context';
import {
  compareRuns,
  contextFor,
  formatMs,
  resolvePause,
  runBatch,
  runDuration,
  showInTimeline,
  stepOffsets,
  stopRuns,
  useRunner,
  viewportLabel,
} from '@/modules/interaction-replayer';
import { AddStepPopover } from './AddStep';
import { PanelEmpty, RecordingIndicator, StatusGlyph, StepIcon } from './bits';
import { SaveRecordingDialog } from './dialogs';
import { StepDetails } from './StepDetails';
import { deleteStep, editTarget, reorderStep, toggleRecording, tryEdit, useRecorderUi } from './recording';
import { ACTION_LABELS, duplicateScenario, serializeScenario, stepValue } from './steps';
import s from './timeline.module.css';

const CARD_W = 158;
const GAP = 8;
const PITCH = CARD_W + GAP;

export const DRAFT_ID = 'recording-draft';

type Band = { start: number; end: number; label: string; dims: string; tone: 'folded' | 'expanded' | 'other' };

function ctxLabel(ctx: ViewportContext | null): { label: string; dims: string; tone: Band['tone'] } {
  if (!ctx) return { label: 'Canvas device', dims: '', tone: 'other' };
  const devices = studio().allDevices();
  const foldable = devices.find((d) => d.id === ctx.deviceId)?.expanded;
  return { label: viewportLabel(ctx, devices), dims: `${ctx.width}×${ctx.height}`, tone: foldable ? ctx.posture : 'other' };
}

/** Split the step list into viewport segments (start viewport + viewport / posture steps). */
function viewportBands(steps: TestStep[], start: ViewportContext | null, results: Map<string, StepResult> | null): Band[] {
  const devices = studio().allDevices();
  const bands: Band[] = [];
  let cur = start;
  let from = 0;
  const push = (end: number) => {
    if (end > from) bands.push({ start: from, end, ...ctxLabel(cur) });
  };
  steps.forEach((st, i) => {
    const a = st.action;
    const r = results?.get(st.id);
    if (r && r.status === 'skipped') return;
    let next: ViewportContext | null = null;
    if (a.type === 'viewport') next = contextFor(a.state, devices);
    else if (a.type === 'fold' && cur) {
      const d = devices.find((x) => x.id === cur!.deviceId);
      if (d && canFold(d) && cur.posture !== a.posture) next = contextFor({ deviceId: cur.deviceId, posture: a.posture, orientation: cur.orientation }, devices);
    }
    if (next) {
      push(i);
      cur = next;
      from = i;
    }
  });
  push(steps.length);
  return bands;
}

function relTime(ms: number) {
  return ms < 60_000 ? `+${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s` : `+${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

const ago = (t: number) => {
  const d = Math.round((Date.now() - t) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export function TimelinePanel() {
  const project = useStudio((st) => st.project);
  const recording = useStudio((st) => st.recording);
  const scenarios = useStudio((st) => st.scenarios);
  const runs = useStudio((st) => st.runs);
  const routes = useStudio((st) => st.routes);
  const subject = useRunner((r) => r.subject);
  const active = useRunner((r) => r.active);
  const follow = useRunner((r) => r.follow);
  const paused = useRunner((r) => r.paused);
  const selectedStepId = useRunner((r) => r.selectedStepId);
  const compare = useRunner((r) => r.compare);
  const pauseOnFailure = useRunner((r) => r.pauseOnFailure);
  const meta = useRecorderUi((u) => u.meta);
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; to: number | null } | null>(null);

  /* ---------------- what are we showing ---------------- */
  const live = follow && active?.current ? active.current : null;
  const view = useMemo(() => {
    if (recording.active || (!live && (subject?.kind === 'recording' || !subject))) {
      const startCtx = meta ? contextFor(meta.viewport, studio().allDevices()) : null;
      return { kind: 'recording' as const, scenario: null, run: null as ScenarioRun | null, steps: recording.steps, startCtx };
    }
    const scenarioId = live ? live.scenarioId : subject!.kind === 'scenario' ? subject!.scenarioId : '';
    const sc = scenarios.find((x) => x.id === scenarioId) ?? (scenarioId === DRAFT_ID ? draftScenario() : undefined);
    if (!sc) return { kind: 'missing' as const, scenario: null, run: null, steps: [] as TestStep[], startCtx: null };
    const wantRun = live ? live.runId : subject?.kind === 'scenario' ? subject.runId : null;
    const scRuns = runs.filter((r) => r.scenarioId === sc.id);
    const run = (wantRun ? runs.find((r) => r.id === wantRun) : null) ?? (subject?.kind === 'scenario' && subject.runId === null && !live ? null : scRuns[0] ?? null);
    return { kind: 'scenario' as const, scenario: sc, run, steps: sc.steps, startCtx: run?.viewport ?? null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording.active, recording.steps, live?.scenarioId, live?.runId, subject, scenarios, runs, meta]);

  const results = useMemo(() => (view.run ? new Map(view.run.steps.map((r) => [r.stepId, r])) : null), [view.run]);
  const offsets = useMemo(() => {
    if (view.kind === 'recording') return view.steps.map((st) => Math.max(0, st.timestamp - (recording.startedAt ?? st.timestamp)));
    if (view.run) return stepOffsets(view.run.steps);
    return null;
  }, [view, recording.startedAt]);
  const durations = useMemo(() => {
    if (view.run) return view.run.steps.map((r) => r.durationMs);
    if (view.kind === 'recording' && offsets) return offsets.map((o, i) => (i + 1 < offsets.length ? offsets[i + 1] - o : 0));
    return null;
  }, [view, offsets]);
  const bands = useMemo(() => viewportBands(view.steps, view.startCtx ?? (view.kind === 'recording' && !meta ? null : view.startCtx), results), [view, results, meta]);

  const target = editTarget();
  const editable = Boolean(target && !('readonly' in target) && (view.kind === 'recording' || (view.scenario && !view.scenario.builtIn && view.scenario.id !== DRAFT_ID)) && !active);
  const readonlyReason = view.scenario?.builtIn ? 'Built-in scenarios are read-only. Duplicate it to edit the steps.' : active ? 'Steps are locked while a run is in progress.' : undefined;
  const selIndex = view.steps.findIndex((x) => x.id === selectedStepId);
  const selected = selIndex >= 0 ? view.steps[selIndex] : null;
  const runningIndex = live && view.run && live.runId === view.run.id ? live.stepIndex : live && !view.run ? live.stepIndex : -1;
  const scRuns = view.scenario ? runs.filter((r) => r.scenarioId === view.scenario!.id) : [];

  // Keep the running / selected card in view.
  useEffect(() => {
    const idx = runningIndex >= 0 ? runningIndex : selIndex;
    const el = trackRef.current;
    if (idx < 0 || !el) return;
    const left = idx * PITCH;
    if (left < el.scrollLeft + 12 || left + CARD_W > el.scrollLeft + el.clientWidth - 12) el.scrollTo({ left: Math.max(0, left - el.clientWidth / 3), behavior: 'smooth' });
  }, [runningIndex, selIndex]);
  // Follow new recorded steps.
  useEffect(() => {
    if (!recording.active) return;
    trackRef.current?.scrollTo({ left: trackRef.current.scrollWidth, behavior: 'smooth' });
  }, [recording.active, recording.steps.length]);

  if (!project) {
    return (
      <div className={s.emptyWrap}>
        <PanelEmpty
          icon={Workflow}
          title="Interaction timeline"
          action={
            <Button variant="primary" onClick={() => runAction('project.openDemo')}>
              Open the Harborline demo
            </Button>
          }
        >
          Open a project, then record clicks, typing and fold changes to build a replayable scenario.
        </PanelEmpty>
      </div>
    );
  }

  const busy = Boolean(active);
  const scenarioForRun = (): Scenario | null => (view.kind === 'recording' ? (view.steps.length ? draftScenario() : null) : view.scenario);
  const replay = (startAt?: number) => {
    const sc = scenarioForRun();
    if (!sc) return;
    useRunner.setState({ follow: true, subject: { kind: 'scenario', scenarioId: sc.id, runId: null } });
    runBatch([sc], { label: sc.name, startAt, reset: startAt ? false : undefined, pauseOnFailure: useRunner.getState().pauseOnFailure }).catch((e) => toast.error((e as Error).message));
  };
  const select = (id: string | null) => useRunner.setState({ selectedStepId: id });

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!view.steps.length) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const i = Math.max(0, Math.min(view.steps.length - 1, (selIndex < 0 ? -1 : selIndex) + (e.key === 'ArrowRight' ? 1 : -1)));
      select(view.steps[i].id);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected && editable) {
      e.preventDefault();
      tryEdit(() => deleteStep(selected.id));
    } else if (e.key === 'Escape') select(null);
  };

  /* ---------------- drag reorder ---------------- */
  const onDragOver = (e: DragEvent, i: number) => {
    if (!drag) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const slot = e.clientX < r.left + r.width / 2 ? i : i + 1;
    if (slot !== drag.to) setDrag({ ...drag, to: slot });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (drag && drag.to !== null) {
      const to = drag.to > drag.from ? drag.to - 1 : drag.to;
      if (to !== drag.from) tryEdit(() => reorderStep(drag.from, to));
    }
    setDrag(null);
  };

  const subjectMenu: MenuEntry[] = [
    { type: 'label', label: 'Show' },
    { label: `Recording draft${recording.steps.length ? ` · ${recording.steps.length} steps` : ''}`, checked: view.kind === 'recording', onSelect: () => showInTimeline({ kind: 'recording' }) },
  ];
  const bySuite = new Map<string, Scenario[]>();
  for (const sc of scenarios) bySuite.set(sc.suite ?? 'Scenarios', [...(bySuite.get(sc.suite ?? 'Scenarios') ?? []), sc]);
  for (const [suite, list] of bySuite) {
    subjectMenu.push({ type: 'label', label: suite });
    for (const sc of list) subjectMenu.push({ label: sc.name, hint: sc.builtIn ? 'built-in' : `${sc.steps.length} steps`, checked: view.scenario?.id === sc.id, onSelect: () => showInTimeline({ kind: 'scenario', scenarioId: sc.id, runId: runs.find((r) => r.scenarioId === sc.id)?.id ?? null }) });
  }
  const runMenu: MenuEntry[] = view.scenario
    ? [
        { label: 'Steps only (no run)', checked: !view.run, onSelect: () => showInTimeline({ kind: 'scenario', scenarioId: view.scenario!.id, runId: null }) },
        ...(scRuns.length ? [{ type: 'separator' } as MenuEntry] : []),
        ...scRuns.slice(0, 14).map(
          (r): MenuEntry => ({
            label: `${viewportLabel(r.viewport, studio().allDevices())} · ${r.status}`,
            hint: `${formatMs(runDuration(r))} · ${ago(r.startedAt)}`,
            checked: view.run?.id === r.id,
            onSelect: () => {
              useRunner.setState({ follow: false });
              showInTimeline({ kind: 'scenario', scenarioId: view.scenario!.id, runId: r.id }, selectedStepId);
            },
          }),
        ),
      ]
    : [];

  const routeLabel = (route?: string) => routes.find((r) => r.path === route)?.label ?? route ?? '';
  const failedCount = view.run?.steps.filter((x) => x.status === 'failed').length ?? 0;
  const totalMs = durations?.reduce((a, b) => a + b, 0) ?? 0;

  return (
    <div className={s.root}>
      {/* ------------------------------ toolbar ------------------------------ */}
      <div className={s.toolbar}>
        {recording.active ? (
          <>
            <RecordingIndicator />
            <Button size="sm" variant="danger" icon={<Square size={10} fill="currentColor" />} onClick={() => void toggleRecording()}>
              Stop recording
            </Button>
          </>
        ) : (
          <>
            <Menu
              width={320}
              trigger={
                <button className={s.subject} aria-label="Timeline subject">
                  {view.kind === 'recording' ? <Circle size={10} className={s.subjectRec} fill="currentColor" /> : view.scenario?.builtIn ? <Lock size={11} className={s.subjectLock} /> : <Workflow size={12} className={s.subjectIcon} />}
                  <span className={s.subjectName}>{view.kind === 'recording' ? 'Recording draft' : (view.scenario?.name ?? 'Scenario')}</span>
                  {view.scenario?.route && <span className={s.subjectRoute}>{routeLabel(view.scenario.route)}</span>}
                  <ChevronDown size={11} className={s.subjectChev} />
                </button>
              }
              items={subjectMenu}
            />
            {view.scenario && (
              <Menu
                width={330}
                trigger={
                  <button className={s.runPick} aria-label="Run">
                    {view.run ? (
                      <>
                        <StatusGlyph status={live && view.run.id === live.runId ? 'running' : view.run.status} size={12} />
                        <span>{viewportLabel(view.run.viewport, studio().allDevices())}</span>
                        <span className={s.runPickMeta}>
                          {formatMs(runDuration(view.run))}
                          {failedCount ? ` · ${failedCount} failed` : ''}
                        </span>
                      </>
                    ) : (
                      <span className={s.runPickMeta}>{scRuns.length ? 'Steps only' : 'Not run yet'}</span>
                    )}
                    <ChevronDown size={11} />
                  </button>
                }
                items={runMenu}
              />
            )}
            {live && view.scenario?.id === live.scenarioId && (
              <Badge tone="accent">
                Live · step {live.stepIndex + 1}/{live.stepCount}
              </Badge>
            )}
            {!recording.active && (
              <Button size="sm" variant="ghost" className={s.recordBtn} icon={<Circle size={9} fill="currentColor" className={s.recIcon} />} disabled={busy} onClick={() => void toggleRecording()}>
                Record
              </Button>
            )}
          </>
        )}
        <span style={{ flex: 1 }} />
        {totalMs > 0 && <span className={s.total}>{view.steps.length} steps · {formatMs(totalMs)}</span>}
        <AddStepPopover
          where={recording.active ? 'Appends to the recording' : selected ? `Inserts after step ${selIndex + 1}` : 'Appends to the end'}
          trigger={
            <span>
              <Tooltip content={editable || recording.active ? 'Add assertion, wait or screenshot' : readonlyReason ?? 'Nothing to edit'}>
                <Button size="sm" variant="secondary" icon={<Plus size={12} />} disabled={!(editable || recording.active)}>
                  Add step
                </Button>
              </Tooltip>
            </span>
          }
        />
        {busy ? (
          <Button size="sm" variant="secondary" icon={<Square size={10} fill="currentColor" />} onClick={() => stopRuns()}>
            Stop
          </Button>
        ) : (
          <>
            <Tooltip content="Replay from a fresh page load on the canvas device">
              <Button size="sm" variant="primary" icon={<Play size={11} fill="currentColor" />} disabled={recording.active || !view.steps.length} onClick={() => replay()}>
                Replay
              </Button>
            </Tooltip>
            <Tooltip content={selected ? `Replay from step ${selIndex + 1} without reloading` : 'Select a step first'}>
              <Button size="sm" variant="secondary" icon={<StepForward size={12} />} disabled={recording.active || !selected} onClick={() => replay(selIndex)}>
                From here
              </Button>
            </Tooltip>
          </>
        )}
        <IconButton size="sm" label="Compare two runs" active={Boolean(compare)} disabled={scRuns.length < 2} onClick={() => useRunner.setState({ compare: compare ? null : { a: scRuns[1]?.id ?? null, b: scRuns[0]?.id ?? null } })}>
          <GitCompareArrows size={14} />
        </IconButton>
        <Menu
          align="end"
          width={250}
          trigger={
            <span>
              <IconButton size="sm" label="Timeline options">
                <MoreHorizontal size={14} />
              </IconButton>
            </span>
          }
          items={[
            { label: 'Pause at failures', checked: pauseOnFailure, onSelect: () => useRunner.setState({ pauseOnFailure: !pauseOnFailure }) },
            { label: 'Follow live runs', checked: follow, onSelect: () => useRunner.setState({ follow: !follow }) },
            { type: 'separator' },
            ...(view.scenario
              ? [
                  {
                    label: view.scenario.builtIn ? 'Duplicate to edit' : 'Duplicate',
                    icon: <Copy size={13} />,
                    onSelect: () => {
                      const copy = duplicateScenario(view.scenario!);
                      studio().upsertScenario(copy);
                      showInTimeline({ kind: 'scenario', scenarioId: copy.id, runId: null });
                    },
                  },
                  { label: 'Copy as JSON', icon: <Copy size={13} />, onSelect: () => void navigator.clipboard.writeText(serializeScenario(view.scenario!)).then(() => toast.success('Scenario copied')) },
                ]
              : []),
            ...(view.kind === 'recording' && recording.steps.length && !recording.active
              ? [
                  { label: 'Save recording as scenario…', onSelect: () => useRecorderUi.setState({ saveOpen: true }) },
                  { label: 'Clear recording draft', icon: <RotateCcw size={13} />, onSelect: () => studio().setRecordedSteps([]) },
                ]
              : []),
          ]}
        />
      </div>

      {paused && (view.scenario?.id === paused.scenarioId || view.kind === 'recording') && (
        <div className={s.pause} role="alert">
          <StatusGlyph status="failed" size={13} />
          <span className={s.pauseText}>
            <b>Paused at step {paused.stepIndex + 1}</b> · {paused.error}
          </span>
          <Button size="sm" variant="secondary" icon={<RotateCcw size={11} />} onClick={() => resolvePause('retry')}>
            Retry step
          </Button>
          <Button size="sm" variant="secondary" icon={<SkipForward size={11} />} onClick={() => resolvePause('continue')}>
            Continue
          </Button>
          <Button size="sm" variant="ghost" onClick={() => resolvePause('stop')}>
            Stop
          </Button>
        </div>
      )}

      {/* ------------------------------ body ------------------------------ */}
      <div className={s.body}>
        {compare && view.scenario ? (
          <CompareView scenario={view.scenario} runs={scRuns} a={compare.a} b={compare.b} />
        ) : !view.steps.length ? (
          <div className={s.emptyWrap}>
            {recording.active ? (
              <PanelEmpty icon={Circle} tone="danger" title="Recording…">
                Use the page in Interact mode. Clicks, typing (masked), keys, navigation and device or fold changes appear here as they happen.
              </PanelEmpty>
            ) : view.kind === 'missing' ? (
              <PanelEmpty icon={Workflow} title="Scenario not found">
                It may have been deleted. Pick another one from the menu above.
              </PanelEmpty>
            ) : (
              <PanelEmpty
                icon={Workflow}
                title="Record an interaction"
                action={
                  <>
                    <Button variant="primary" icon={<Circle size={10} fill="currentColor" />} onClick={() => void toggleRecording()}>
                      Start recording
                    </Button>
                    <Button variant="secondary" onClick={() => studio().setLeftTab('scenarios')}>
                      Browse scenarios
                    </Button>
                  </>
                }
              >
                Steps appear here as a timeline you can edit, replay from any step and compare across runs.
              </PanelEmpty>
            )}
          </div>
        ) : (
          <div className={s.trackCol}>
            {durations && totalMs > 0 && (
              <div className={s.minimap} aria-hidden>
                {view.steps.map((st, i) => {
                  const r = results?.get(st.id);
                  return (
                    <span
                      key={st.id}
                      className={s.miniSeg}
                      data-status={i === runningIndex ? 'running' : r?.status ?? (view.kind === 'recording' ? 'recorded' : 'idle')}
                      data-selected={st.id === selectedStepId ? 'true' : undefined}
                      style={{ flexGrow: Math.max(durations[i] ?? 0, totalMs / 300) }}
                      onClick={() => select(st.id)}
                      title={`${i + 1}. ${st.description} · ${formatMs(durations[i] ?? 0)}`}
                    />
                  );
                })}
              </div>
            )}
            <div ref={trackRef} className={s.track} tabIndex={0} onKeyDown={onKey} aria-label="Steps" onDragOver={(e) => drag && e.preventDefault()} onDrop={onDrop}>
              <div className={s.lane} style={{ width: view.steps.length * PITCH + 24 }}>
                <div className={s.bands}>
                  {bands.map((b, i) => (
                    <div key={i} className={s.band} data-tone={b.tone} style={{ left: b.start * PITCH, width: (b.end - b.start) * PITCH - GAP }} title={`${b.label} ${b.dims}`}>
                      <span className={s.bandLabel}>{b.label}</span>
                      {b.dims && <span className={s.bandDims}>{b.dims}</span>}
                    </div>
                  ))}
                </div>
                <div className={s.rail} />
                <div className={s.cards} role="listbox" aria-label="Timeline steps">
                  {view.steps.map((st, i) => {
                    const r = results?.get(st.id);
                    const status = i === runningIndex ? 'running' : (r?.status ?? 'idle');
                    const value = stepValue(st.action);
                    const shot = r?.screenshot;
                    return (
                      <div
                        key={st.id}
                        role="option"
                        aria-selected={st.id === selectedStepId}
                        className={s.card}
                        data-status={status}
                        data-na={r?.status === 'skipped' && r.error ? 'true' : undefined}
                        data-selected={st.id === selectedStepId ? 'true' : undefined}
                        data-dragging={drag?.from === i ? 'true' : undefined}
                        data-drop={drag && drag.to === i ? 'before' : drag && drag.to === i + 1 && i === view.steps.length - 1 ? 'after' : undefined}
                        style={{ left: i * PITCH }}
                        draggable={Boolean(editable)}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', st.id);
                          setDrag({ from: i, to: null });
                        }}
                        onDragEnd={() => setDrag(null)}
                        onDragOver={(e) => onDragOver(e, i)}
                        onClick={() => select(st.id === selectedStepId ? null : st.id)}
                        title={r?.error ?? st.description}
                      >
                        <span className={s.node} data-status={status} />
                        <div className={s.cardHead}>
                          <StepIcon type={st.action.type} size={11} />
                          <span className={s.cardType}>{ACTION_LABELS[st.action.type]}</span>
                          <span className={s.cardTime}>{offsets ? relTime(offsets[i] ?? 0) : `#${i + 1}`}</span>
                        </div>
                        {shot ? (
                          <img className={s.thumb} src={shot} alt="" draggable={false} />
                        ) : (
                          <div className={s.cardDesc}>{st.description}</div>
                        )}
                        <div className={s.cardFoot}>
                          {(r || status === 'running') && <StatusGlyph status={status} size={11} />}
                          {r?.status === 'failed' ? (
                            <span className={s.cardErr}>{r.error}</span>
                          ) : r && r.status !== 'skipped' ? (
                            <span className={s.cardMeta}>
                              {formatMs(r.durationMs)}
                              {r.usedLocator && r.usedLocator !== 'testId' ? ` · ${r.usedLocator}` : ''}
                            </span>
                          ) : r?.error ? (
                            <span className={s.cardMeta}>n/a</span>
                          ) : value ? (
                            <span className={s.cardValue}>{value}</span>
                          ) : (
                            <span className={s.cardMeta}>{st.expect ? 'expectation' : ''}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
        {view.steps.length > 0 && !compare && <aside className={s.side}>
          {selected ? (
            <StepDetails step={selected} index={selIndex} count={view.steps.length} result={results?.get(selected.id)} editable={Boolean(editable)} readonlyReason={readonlyReason} scenario={view.scenario ?? undefined} />
          ) : (
            <RunOverview run={view.run} scenario={view.scenario} steps={view.steps} recording={view.kind === 'recording'} />
          )}
        </aside>}
      </div>
      <SaveRecordingDialog />
    </div>
  );
}

function draftScenario(): Scenario {
  const st = studio();
  const meta = useRecorderUi.getState().meta;
  return { id: DRAFT_ID, name: 'Recording draft', description: 'Unsaved recording', route: meta?.route ?? st.currentRoute, steps: st.recording.steps, createdAt: Date.now(), builtIn: false, tags: ['draft'] };
}

function RunOverview({ run, scenario, steps, recording }: { run: ScenarioRun | null; scenario: Scenario | null; steps: TestStep[]; recording: boolean }) {
  const counts = run ? { passed: run.steps.filter((x) => x.status === 'passed').length, failed: run.steps.filter((x) => x.status === 'failed').length, skipped: run.steps.filter((x) => x.status === 'skipped').length } : null;
  const vp = run?.viewport ?? currentViewportContext();
  return (
    <div className={s.overview}>
      <div className={s.ovTitle}>{recording ? 'Recording draft' : (scenario?.name ?? 'Scenario')}</div>
      {scenario?.description && <p className={s.ovText}>{scenario.description}</p>}
      {recording && <p className={s.ovText}>Select a step to edit its description, value, expected outcome and timeout. Drag cards to reorder.</p>}
      {run ? (
        <>
          <div className={s.ovStatus} data-status={run.status}>
            <StatusGlyph status={run.status} size={14} />
            <span>{run.status === 'passed' ? 'Passed' : run.status === 'failed' ? 'Failed' : run.status === 'aborted' ? 'Stopped' : 'Running'}</span>
            <span className={s.ovMeta}>{formatMs(runDuration(run))}</span>
          </div>
          <div className={s.ovGrid}>
            <span>Viewport</span>
            <b>
              {viewportLabel(vp, studio().allDevices())} · {vp.width}×{vp.height}
            </b>
            <span>Steps</span>
            <b>
              {counts!.passed} passed · {counts!.failed} failed · {counts!.skipped} skipped
            </b>
            <span>Console errors</span>
            <b>{run.consoleErrors.length}</b>
            <span>Detected issues</span>
            <b>{run.issues.length}</b>
          </div>
          {run.finalScreenshot && <img className={s.ovShot} src={run.finalScreenshot} alt="End state" />}
        </>
      ) : (
        !recording && (
          <p className={s.ovText}>
            {steps.length} steps · not run{scenario?.builtIn ? ' · built-in (read-only)' : ''}. Replay runs from a fresh page load on the canvas device.
          </p>
        )
      )}
      <p className={s.hint}>Select a step for locator strategies, values and errors.</p>
    </div>
  );
}

function CompareView({ scenario, runs, a, b }: { scenario: Scenario; runs: ScenarioRun[]; a: string | null; b: string | null }) {
  const ra = runs.find((r) => r.id === a) ?? runs[1];
  const rb = runs.find((r) => r.id === b) ?? runs[0];
  const devices = studio().allDevices();
  const options = runs.map((r) => ({ value: r.id, label: `${viewportLabel(r.viewport, devices)} · ${r.status} · ${ago(r.startedAt)}` }));
  if (!ra || !rb) return <div className={s.emptyWrap}>Run the scenario twice to compare.</div>;
  const cmp = compareRuns(ra, rb, scenario);
  const delta = (ms: number | null) => (ms === null ? '—' : `${ms > 0 ? '+' : ms < 0 ? '−' : '±'}${formatMs(Math.abs(ms))}`);
  return (
    <div className={s.compare}>
      <div className={s.cmpHead}>
        <span className={s.cmpStep}>Step</span>
        <span className={s.cmpRun}>
          <span className={s.cmpTag}>A</span>
          <Select ariaLabel="Run A" value={ra.id} onChange={(v) => useRunner.setState((st) => ({ compare: { a: v, b: st.compare?.b ?? rb.id } }))} options={options} style={{ flex: 1, minWidth: 0 }} />
        </span>
        <span className={s.cmpRun}>
          <span className={s.cmpTag} data-b="true">
            B
          </span>
          <Select ariaLabel="Run B" value={rb.id} onChange={(v) => useRunner.setState((st) => ({ compare: { a: st.compare?.a ?? ra.id, b: v } }))} options={options} style={{ flex: 1, minWidth: 0 }} />
        </span>
        <span className={s.cmpDelta}>Δ B − A</span>
      </div>
      <div className={s.cmpSummary}>
        <span className={s.cmpStep}>Total</span>
        <span className={s.cmpRun}>
          <StatusGlyph status={ra.status} size={12} /> {formatMs(runDuration(ra))}
        </span>
        <span className={s.cmpRun}>
          <StatusGlyph status={rb.status} size={12} /> {formatMs(runDuration(rb))}
        </span>
        <span className={s.cmpDelta} data-sign={cmp.durationDeltaMs > 50 ? 'slower' : cmp.durationDeltaMs < -50 ? 'faster' : undefined}>
          {delta(cmp.durationDeltaMs)}
        </span>
      </div>
      <div className={s.cmpRows}>
        {cmp.steps.map((row) => (
          <div key={row.stepId} className={s.cmpRow} data-change={row.change}>
            <span className={s.cmpStep}>
              <span className={s.cmpIndex}>{row.index + 1}</span>
              <span className={s.cmpDesc}>{row.description}</span>
            </span>
            <span className={s.cmpRun}>
              {row.a ? <StatusGlyph status={row.a.status} size={11} /> : '—'}
              <span className={s.cmpMs}>{row.a && row.a.status !== 'skipped' ? formatMs(row.a.durationMs) : ''}</span>
              {row.a?.status === 'failed' && <span className={s.cmpErr}>{row.a.error}</span>}
            </span>
            <span className={s.cmpRun}>
              {row.b ? <StatusGlyph status={row.b.status} size={11} /> : '—'}
              <span className={s.cmpMs}>{row.b && row.b.status !== 'skipped' ? formatMs(row.b.durationMs) : ''}</span>
              {row.b?.status === 'failed' && <span className={s.cmpErr}>{row.b.error}</span>}
            </span>
            <span className={s.cmpDelta} data-sign={row.deltaMs !== null && row.deltaMs > 150 ? 'slower' : row.deltaMs !== null && row.deltaMs < -150 ? 'faster' : undefined}>
              {row.change === 'fixed' ? <Badge tone="success">fixed</Badge> : row.change === 'regressed' ? <Badge tone="danger">regressed</Badge> : row.change === 'changed' ? <Badge tone="warning">changed</Badge> : delta(row.deltaMs)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
