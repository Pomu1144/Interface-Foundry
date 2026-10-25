import { create } from 'zustand';
import type { StylesPayload } from '@shared/types';
import type { AiProviderId, AiStatus, Diagnosis, DiagnoseIntent, DiagnoseRequest, DiagnosisContext, ProgressStage } from './schema';
import type { RedactionStats } from './redact';
import type { Measurement, MeasurementComparison } from './metrics';
import type { RerunResult } from './measure';

/** UI state of the AI panel (kept out of the project store: conversations are not persisted). */

export type TurnStatus = 'collecting' | 'consent' | 'running' | 'done' | 'error' | 'cancelled';

export type Turn = {
  id: string;
  question: string;
  intent: DiagnoseIntent;
  provider: AiProviderId;
  status: TurnStatus;
  stage: { stage: ProgressStage | 'collecting'; message: string; chars?: number; thinking?: string } | null;
  startedAt: number;
  durationMs?: number;
  diagnosis?: Diagnosis;
  error?: string;
  model?: string;
  servedBy?: string;
  repairs?: string[];
  /** Why the provider differs from the one requested (e.g. Claude not configured). */
  notice?: string;
  context?: DiagnosisContext;
  payload?: DiagnoseRequest;
  selectorMap?: Record<string, string>;
  redaction?: RedactionStats;
  baseline?: Measurement;
  otherBaseline?: Measurement | null;
};

export type Thread = { key: string; label: string; selector: string; route: string; turns: Turn[] };

export type FixState = {
  status: 'idle' | 'previewing' | 'applied' | 'discarded';
  groupId?: string;
  busy?: 'preview' | 'apply' | 'measure' | 'rerun';
  result?: MeasurementComparison;
  before?: Measurement;
  rerun?: RerunResult;
  error?: string;
};

export type ExperimentKind = 'disable' | 'value' | 'width' | 'min-width' | 'breakpoint' | 'fix';

export type Experiment = {
  id: string;
  label: string;
  detail: string;
  kind: ExperimentKind;
  selector: string;
  status: 'measuring' | 'active' | 'promoted' | 'discarded' | 'gone';
  createdAt: number;
  before?: Measurement;
  after?: Measurement;
  result?: MeasurementComparison;
  error?: string;
};

export type AiPanelState = {
  view: 'diagnose' | 'debug';
  threads: Record<string, Thread>;
  fixes: Record<string, FixState>;
  experiments: Experiment[];
  status: AiStatus | null;
  statusState: 'idle' | 'loading' | 'ready' | 'offline';
  /** Raw styles for the Debug view (refreshed with the selection). */
  debugStyles: { selector: string; styles: StylesPayload | null; loading: boolean; error?: string } | null;
  compose: { text: string; nonce: number };
};

export const useAi = create<AiPanelState>()(() => ({
  view: 'diagnose',
  threads: {},
  fixes: {},
  experiments: [],
  status: null,
  statusState: 'idle',
  debugStyles: null,
  compose: { text: '', nonce: 0 },
}));

export const ai = () => useAi.getState();

export function patchTurn(threadKey: string, turnId: string, patch: Partial<Turn>) {
  useAi.setState((s) => {
    const t = s.threads[threadKey];
    if (!t) return s;
    return { threads: { ...s.threads, [threadKey]: { ...t, turns: t.turns.map((x) => (x.id === turnId ? { ...x, ...patch } : x)) } } };
  });
}

export function patchFix(key: string, patch: Partial<FixState>) {
  useAi.setState((s) => ({ fixes: { ...s.fixes, [key]: { ...(s.fixes[key] ?? { status: 'idle' }), ...patch } } }));
}

export function patchExperiment(id: string, patch: Partial<Experiment>) {
  useAi.setState((s) => ({ experiments: s.experiments.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
}
