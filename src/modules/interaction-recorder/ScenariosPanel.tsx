import { ChevronDown, Circle, CircleDot, Copy, FileInput, FlaskConical, Grid3x3, ListChecks, MoreHorizontal, Pencil, Play, Plus, Square, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Scenario, ScenarioRun, ViewportState } from '@shared/types';
import { Button, IconButton, Menu, SearchInput, Tooltip } from '@/ui';
import { studio, useStudio } from '@/store';
import { runAction } from '@/app/actions';
import { formatMs, latestRunByScenario, runBatch, runDuration, showInTimeline, stopRuns, useRunner } from '@/modules/interaction-replayer';
import { MatrixDialog } from '@/modules/interaction-replayer/MatrixDialog';
import { FINANCIAL_SUITES } from '@/modules/financial-ux-suite/scenarios';
import { AddStepPopover } from './AddStep';
import { PanelEmpty, RecordingIndicator, StatusGlyph } from './bits';
import { ImportScenarioDialog, SaveRecordingDialog, ScenarioMetaDialog } from './dialogs';
import { toggleRecording, useRecorderUi } from './recording';
import { duplicateScenario, serializeScenario } from './steps';
import s from './scenarios.module.css';

function run(list: Scenario[], opts: { matrix?: ViewportState[]; label?: string } = {}) {
  const r = useRunner.getState();
  runBatch(list, { matrix: opts.matrix, label: opts.label, pauseOnFailure: r.pauseOnFailure, audits: opts.matrix?.length ? r.audits : false }).catch((e) => toast.error((e as Error).message));
}

function openInTimeline(sc: Scenario, latest?: ScenarioRun) {
  showInTimeline({ kind: 'scenario', scenarioId: sc.id, runId: latest?.id ?? null });
  studio().setBottomTab('timeline');
}

export function ScenariosPanel() {
  const project = useStudio((st) => st.project);
  const scenarios = useStudio((st) => st.scenarios);
  const runs = useStudio((st) => st.runs);
  const recording = useStudio((st) => st.recording.active);
  const draftSteps = useStudio((st) => st.recording.steps.length);
  const active = useRunner((r) => r.active);
  const subject = useRunner((r) => r.subject);
  const matrix = useRunner((r) => r.matrix);
  const starting = useRecorderUi((u) => u.starting);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [meta, setMeta] = useState<Scenario | null>(null);
  const [matrixFor, setMatrixFor] = useState<{ list: Scenario[]; label: string } | null>(null);

  const latest = useMemo(() => latestRunByScenario(runs), [runs]);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? scenarios.filter((x) => `${x.name} ${x.suite ?? ''} ${x.description} ${x.tags.join(' ')}`.toLowerCase().includes(q)) : scenarios;
    const map = new Map<string, Scenario[]>();
    for (const sc of filtered) {
      const k = sc.suite ?? (sc.builtIn ? 'Built-in' : 'My scenarios');
      map.set(k, [...(map.get(k) ?? []), sc]);
    }
    const order = (k: string) => {
      const i = FINANCIAL_SUITES.indexOf(k);
      return i >= 0 ? i : 100;
    };
    return [...map.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
  }, [scenarios, query]);

  if (!project) {
    return (
      <div className={s.center}>
        <PanelEmpty
          icon={FlaskConical}
          title="Test scenarios"
          action={
            <Button variant="primary" onClick={() => runAction('project.openDemo')}>
              Open the Harborline demo
            </Button>
          }
        >
          Record clicks, typing, keys and fold changes, then replay them across devices. The demo ships a financial UX suite.
        </PanelEmpty>
      </div>
    );
  }

  const busy = Boolean(active);
  return (
    <div className={s.root}>
      <div className={s.bar}>
        {recording ? (
          <Button size="sm" variant="danger" icon={<Square size={10} fill="currentColor" />} onClick={() => void toggleRecording()}>
            Stop
          </Button>
        ) : (
          <Tooltip content="Record an interaction on the canvas" shortcut="Mod+Shift+R">
            <Button size="sm" variant="secondary" className={s.recordBtn} icon={<Circle size={10} fill="currentColor" className={s.recordIcon} />} disabled={busy || starting} onClick={() => void toggleRecording()}>
              Record
            </Button>
          </Tooltip>
        )}
        {busy ? (
          <Button size="sm" variant="ghost" icon={<Square size={10} fill="currentColor" />} onClick={() => stopRuns()}>
            Stop run
          </Button>
        ) : (
          <Tooltip content="Run tests & audits" shortcut="Mod+Enter">
            <Button size="sm" variant="ghost" icon={<Play size={11} fill="currentColor" />} disabled={recording || !scenarios.length} onClick={() => runAction('test.runAll')}>
              Run all
            </Button>
          </Tooltip>
        )}
        <span style={{ flex: 1 }} />
        <Menu
          align="end"
          width={250}
          trigger={
            <span>
              <IconButton size="sm" label="More">
                <MoreHorizontal size={14} />
              </IconButton>
            </span>
          }
          items={[
            { label: 'Import scenario JSON…', icon: <FileInput size={13} />, onSelect: () => useRecorderUi.setState({ importOpen: true }) },
            { label: 'Run all on device matrix…', icon: <Grid3x3 size={13} />, disabled: busy || recording || !scenarios.length, onSelect: () => setMatrixFor({ list: scenarios, label: 'All scenarios' }) },
            { label: 'Show test results', icon: <ListChecks size={13} />, onSelect: () => studio().setBottomTab('tests') },
            { type: 'separator' },
            { label: 'Pause at failures', checked: useRunner.getState().pauseOnFailure, onSelect: () => useRunner.setState((r) => ({ pauseOnFailure: !r.pauseOnFailure })) },
          ]}
        />
      </div>

      {recording && (
        <div className={s.recCard}>
          <div className={s.recTop}>
            <RecordingIndicator />
          </div>
          <p className={s.recText}>Use the page in Interact mode. Clicks, typing (masked), keys, navigation and device or fold changes become steps.</p>
          <div className={s.recActions}>
            <AddStepPopover
              where="Appends to the recording"
              align="start"
              trigger={
                <span>
                  <Button size="sm" variant="secondary" icon={<Plus size={12} />}>
                    Add assertion
                  </Button>
                </span>
              }
            />
            <Button size="sm" variant="ghost" onClick={() => studio().setBottomTab('timeline')}>
              Timeline
            </Button>
          </div>
        </div>
      )}

      {!recording && draftSteps > 0 && (
        <button className={s.draft} onClick={() => useRecorderUi.setState({ saveOpen: true })}>
          <span className={s.draftDot} />
          <span className={s.draftText}>
            Unsaved recording · {draftSteps} step{draftSteps === 1 ? '' : 's'}
          </span>
          <span className={s.draftAction}>Save…</span>
        </button>
      )}

      <div className={s.search}>
        <SearchInput value={query} onChange={setQuery} placeholder="Filter scenarios" />
      </div>

      <div className={s.list} role="tree" aria-label="Test scenarios">
        {!scenarios.length && (
          <div className={s.center}>
            <PanelEmpty
              icon={CircleDot}
              tone="danger"
              title="No scenarios yet"
              action={
                <Button variant="primary" icon={<Circle size={10} fill="currentColor" />} onClick={() => void toggleRecording()}>
                  Record an interaction
                </Button>
              }
            >
              Recordings become replayable scenarios you can run on any device profile.
            </PanelEmpty>
          </div>
        )}
        {scenarios.length > 0 && !groups.length && <div className={s.noMatch}>No scenarios match “{query}”.</div>}
        {groups.map(([suite, list]) => {
          const open = !collapsed[suite];
          const results = list.map((x) => latest.get(x.id)).filter(Boolean) as ScenarioRun[];
          const passed = results.filter((r) => r.status === 'passed').length;
          const failed = results.filter((r) => r.status === 'failed').length;
          return (
            <div key={suite} className={s.group} role="group">
              <div className={s.groupHead}>
                <button className={s.groupToggle} aria-expanded={open} onClick={() => setCollapsed((c) => ({ ...c, [suite]: open }))}>
                  <ChevronDown size={12} className={s.chev} />
                  <span className={s.groupName}>{suite}</span>
                  <span className={s.groupCount}>{list.length}</span>
                </button>
                {results.length > 0 && (
                  <span className={s.groupStats} title={`${passed} passed · ${failed} failed (latest runs)`}>
                    {passed > 0 && <span data-tone="ok">{passed}</span>}
                    {failed > 0 && <span data-tone="bad">{failed}</span>}
                  </span>
                )}
                <span className={s.groupActions}>
                  <IconButton size="sm" label={`Run ${suite}`} disabled={busy || recording} onClick={() => run(list, { label: suite })}>
                    <Play size={11} />
                  </IconButton>
                </span>
              </div>
              {open &&
                list.map((sc) => {
                  const last = latest.get(sc.id);
                  const isActive = active?.current?.scenarioId === sc.id;
                  const selected = subject?.kind === 'scenario' && subject.scenarioId === sc.id;
                  return (
                    <div key={sc.id} className={s.item} role="treeitem" aria-selected={selected} data-selected={selected ? 'true' : undefined} data-active={isActive ? 'true' : undefined}>
                      <button className={s.itemMain} onClick={() => openInTimeline(sc, last)} title={sc.description || sc.name}>
                        <StatusGlyph status={isActive ? 'running' : (last?.status ?? 'idle')} size={13} />
                        <span className={s.itemName}>{sc.name}</span>
                        {last && !isActive && <span className={s.itemMeta}>{formatMs(runDuration(last))}</span>}
                        {isActive && active?.current && (
                          <span className={s.itemMeta}>
                            {active.current.stepIndex + 1}/{active.current.stepCount}
                          </span>
                        )}
                      </button>
                      <span className={s.itemActions}>
                        <IconButton size="sm" label="Replay on the canvas device" disabled={busy || recording} onClick={() => run([sc])}>
                          <Play size={11} />
                        </IconButton>
                        <Menu
                          align="end"
                          width={240}
                          trigger={
                            <span>
                              <IconButton size="sm" label="Scenario actions">
                                <MoreHorizontal size={13} />
                              </IconButton>
                            </span>
                          }
                          items={[
                            { label: 'Replay on canvas device', icon: <Play size={13} />, disabled: busy || recording, onSelect: () => run([sc]) },
                            { label: 'Run on device matrix…', icon: <Grid3x3 size={13} />, disabled: busy || recording, onSelect: () => setMatrixFor({ list: [sc], label: sc.name }) },
                            { label: 'Open in timeline', onSelect: () => openInTimeline(sc, last) },
                            { type: 'separator' },
                            {
                              label: 'Copy as JSON',
                              icon: <Copy size={13} />,
                              onSelect: () =>
                                navigator.clipboard
                                  .writeText(serializeScenario(sc))
                                  .then(() => toast.success('Scenario copied', { description: 'Masked values stay as {{secret:…}} placeholders.' }))
                                  .catch(() => toast.error('Clipboard unavailable')),
                            },
                            {
                              label: sc.builtIn ? 'Duplicate to edit' : 'Duplicate',
                              icon: <Copy size={13} />,
                              onSelect: () => {
                                const copy = duplicateScenario(sc);
                                studio().upsertScenario(copy);
                                openInTimeline(copy);
                                toast.success(`Created “${copy.name}”`);
                              },
                            },
                            ...(sc.builtIn
                              ? []
                              : [
                                  { label: 'Rename…', icon: <Pencil size={13} />, onSelect: () => setMeta(sc) },
                                  {
                                    label: 'Delete',
                                    icon: <Trash2 size={13} />,
                                    onSelect: () => {
                                      studio().deleteScenario(sc.id);
                                      if (subject?.kind === 'scenario' && subject.scenarioId === sc.id) showInTimeline({ kind: 'recording' });
                                      toast(`Deleted “${sc.name}”`, { action: { label: 'Undo', onClick: () => studio().upsertScenario(sc) } });
                                    },
                                  },
                                ]),
                          ]}
                        />
                      </span>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>

      <SaveRecordingDialog />
      <ImportScenarioDialog />
      <ScenarioMetaDialog scenario={meta} onClose={() => setMeta(null)} />
      <MatrixDialog
        open={Boolean(matrixFor)}
        onOpenChange={(o) => !o && setMatrixFor(null)}
        initial={matrix}
        title={matrixFor ? `Run “${matrixFor.label}” on a device matrix` : 'Device matrix'}
        runsPerViewport={matrixFor?.list.length ?? 1}
        confirmLabel={(n) => `Run ${n * (matrixFor?.list.length ?? 1)} run${n * (matrixFor?.list.length ?? 1) === 1 ? '' : 's'}`}
        onConfirm={(m) => {
          if (!matrixFor) return;
          run(matrixFor.list, { matrix: m, label: `${matrixFor.label} × ${m.length} viewports` });
          studio().setBottomTab('tests');
        }}
      />
    </div>
  );
}
