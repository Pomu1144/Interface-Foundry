import { create } from 'zustand';
import type { ViewportState } from '@shared/types';
import { DEFAULT_SUITE_MATRIX } from './matrix';

/**
 * Runner UI state shared by the Scenarios, Timeline and Tests panels. Runs
 * themselves live in the studio store (`runs`); this holds only what is
 * transient: progress, pause state and what each panel has selected.
 */
export type ActiveBatch = {
  id: string;
  label: string;
  startedAt: number;
  total: number;
  done: number;
  failed: number;
  current: { scenarioId: string; scenarioName: string; runId: string | null; viewportLabel: string; stepIndex: number; stepCount: number } | null;
};

export type PauseState = { runId: string; scenarioId: string; stepIndex: number; error: string };
export type PauseDecision = 'retry' | 'continue' | 'stop';

export type LastBatch = { id: string; label: string; startedAt: number; finishedAt: number; matrix: ViewportState[]; scenarioIds: string[]; runIds: string[]; aborted: boolean };

/** What the Timeline shows. */
export type TimelineSubject = { kind: 'recording' } | { kind: 'scenario'; scenarioId: string; runId: string | null };

type RunnerState = {
  active: ActiveBatch | null;
  paused: PauseState | null;
  lastBatch: LastBatch | null;
  /** Matrix used by the Tests panel and "Run on device matrix". */
  matrix: ViewportState[];
  audits: boolean;
  pauseOnFailure: boolean;
  subject: TimelineSubject | null;
  /** Timeline follows the active run while a batch is running. */
  follow: boolean;
  selectedStepId: string | null;
  compare: { a: string | null; b: string | null } | null;
  /** Which scenarios "Run tests" executes: 'financial', 'all' or a suite name. */
  scope: string;
  /** Run on the current device as it is, or on the matrix. */
  target: 'current' | 'matrix';
  /** Tests panel drill-down (run id). */
  testsSelection: string | null;
};

const MATRIX_KEY = 'ifdy.tests.matrix';
function loadMatrix(): ViewportState[] {
  try {
    const raw = localStorage.getItem(MATRIX_KEY);
    const v = raw ? (JSON.parse(raw) as ViewportState[]) : null;
    if (Array.isArray(v) && v.length && v.every((x) => typeof x?.deviceId === 'string')) return v;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_SUITE_MATRIX;
}

export const useRunner = create<RunnerState>()(() => ({
  active: null,
  paused: null,
  lastBatch: null,
  matrix: loadMatrix(),
  audits: true,
  pauseOnFailure: false,
  subject: null,
  follow: true,
  selectedStepId: null,
  compare: null,
  scope: 'financial',
  target: 'current',
  testsSelection: null,
}));

export const runner = () => useRunner.getState();

export function setMatrix(matrix: ViewportState[]) {
  useRunner.setState({ matrix });
  try {
    localStorage.setItem(MATRIX_KEY, JSON.stringify(matrix));
  } catch {
    /* storage unavailable */
  }
}

export function showInTimeline(subject: TimelineSubject, stepId: string | null = null) {
  useRunner.setState({ subject, selectedStepId: stepId, compare: null });
}
