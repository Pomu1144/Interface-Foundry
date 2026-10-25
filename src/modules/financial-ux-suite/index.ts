/**
 * Financial UX suite: built-in Harborline scenarios, the suite runner used by
 * the toolbar ("Run tests & audits") and the Tests panel, and report export.
 */
import { FlaskConical, ListChecks, Square } from 'lucide-react';
import { toast } from 'sonner';
import { shallow } from 'zustand/shallow';
import type { Scenario, ViewportState } from '@shared/types';
import { registerActions } from '@/app/actions';
import { studio, useStudio } from '@/store';
import { DEMO_PROJECT_ID } from '@/modules/project-adapter/projects';
import { isRunning, runBatch, stopRuns, useRunner } from '@/modules/interaction-replayer';
import { FINANCIAL_SCENARIOS, FINANCIAL_SUITES, isFinancialScenario } from './scenarios';

export { FINANCIAL_SCENARIOS, FINANCIAL_SUITES } from './scenarios';
export { buildTestReport, SCOPE_NOTE } from './report';

export type SuiteScope = 'financial' | 'all' | string;

export function scenariosForScope(all: Scenario[], sc: SuiteScope): Scenario[] {
  if (sc === 'all') return all;
  if (sc === 'financial') {
    const fin = all.filter(isFinancialScenario);
    return fin.length ? fin : all;
  }
  return all.filter((s) => (s.suite ?? 'Scenarios') === sc);
}

const isDemo = () => {
  const s = studio();
  return s.project?.id === DEMO_PROJECT_ID || s.source?.kind === 'demo';
};

/** Keep the built-in suite in the store exactly while the demo project is open (never persisted). */
function syncBuiltIns() {
  const s = studio();
  const demo = Boolean(s.project) && isDemo();
  const missing = FINANCIAL_SCENARIOS.some((b) => !s.scenarios.some((x) => x.id === b.id));
  if (demo && missing) s.setScenarios([...FINANCIAL_SCENARIOS, ...s.scenarios.filter((x) => !isFinancialScenario(x))]);
  else if (!demo && s.scenarios.some((x) => x.builtIn && isFinancialScenario(x))) s.setScenarios(s.scenarios.filter((x) => !(x.builtIn && isFinancialScenario(x))));
}

/** Run the selected scope on the selected target (current device or the matrix). */
export async function runSuite(opts: { matrix?: ViewportState[]; scenarios?: Scenario[]; audits?: boolean; label?: string } = {}) {
  const s = studio();
  if (!s.project) throw new Error('Open a project first.');
  const r = useRunner.getState();
  const sc = r.scope;
  const list = opts.scenarios ?? scenariosForScope(s.scenarios, sc);
  if (!list.length) throw new Error('There are no scenarios to run. Record one first.');
  const matrix = opts.matrix ?? (r.target === 'matrix' ? r.matrix : []);
  s.setBottomTab('tests');
  return runBatch(list, {
    matrix,
    audits: opts.audits ?? r.audits,
    pauseOnFailure: r.pauseOnFailure,
    label: opts.label ?? (sc === 'financial' ? 'Financial UX suite' : sc === 'all' ? 'All scenarios' : sc),
  });
}

/** Toolbar flask / Mod+Enter: project audits (when available) then the suite. */
export async function runTestsAndAudits() {
  if (isRunning()) {
    toast('Tests are already running', { description: 'Stop them first (Stop button or Escape in the Tests panel).' });
    return;
  }
  const s = studio();
  if (!s.project) return;
  if (s.recording.active) {
    toast.error('Stop the recording before running tests.');
    return;
  }
  s.setBottomTab('tests');
  const matrix = useRunner.getState().target === 'matrix' ? useRunner.getState().matrix : [];
  const tid = toast.loading('Running audits…');
  try {
    const mod = (await import('@/modules/responsive-audit')) as { runAllAudits?: (o?: { profiles?: ViewportState[] }) => Promise<{ responsive: number; a11y: number; errors: string[] }> };
    if (typeof mod.runAllAudits === 'function') {
      const c = await mod.runAllAudits(matrix.length ? { profiles: matrix } : {});
      toast.message('Audits finished', { id: tid, description: `${c.responsive} responsive · ${c.a11y} accessibility findings${c.errors.length ? ` · ${c.errors.join(' · ')}` : ''}` });
    } else toast.dismiss(tid);
  } catch (e) {
    toast.message('Audits unavailable', { id: tid, description: (e as Error).message });
  }
  try {
    const runs = await runSuite({ matrix });
    const failed = runs.filter((r) => r.status === 'failed').length;
    const aborted = runs.filter((r) => r.status === 'aborted').length;
    if (!runs.length) return;
    if (aborted) toast(`Stopped after ${runs.length - aborted} run${runs.length - aborted === 1 ? '' : 's'}`);
    else if (failed) toast.error(`${failed} of ${runs.length} runs failed`, { description: 'See the Tests panel for steps, screenshots and reproduction steps.' });
    else toast.success(`All ${runs.length} runs passed`, { description: 'UI and interaction behaviour only — not financial correctness or security.' });
  } catch (e) {
    toast.error((e as Error).message);
  }
}

export function registerFinancialSuite() {
  registerActions([
    {
      id: 'test.runAll',
      label: 'Run tests & audits',
      group: 'Test',
      shortcut: 'Mod+Enter',
      icon: FlaskConical,
      keywords: 'financial ux suite scenarios replay',
      enabled: () => Boolean(studio().project),
      run: runTestsAndAudits,
    },
    { id: 'test.stop', label: 'Stop running tests', group: 'Test', icon: Square, enabled: isRunning, run: () => stopRuns() },
    {
      id: 'test.runMatrix',
      label: 'Run the scenario suite on the device matrix',
      group: 'Test',
      icon: ListChecks,
      enabled: () => Boolean(studio().project) && !isRunning(),
      run: () => runSuite({ matrix: useRunner.getState().matrix }).catch((e) => toast.error((e as Error).message)),
    },
    { id: 'test.results', label: 'Show test results', group: 'Test', icon: ListChecks, run: () => studio().setBottomTab('tests') },
  ]);
  useStudio.subscribe((s) => [s.project?.id, s.source?.kind, s.scenarios] as const, syncBuiltIns, { equalityFn: shallow });
  syncBuiltIns();
}

