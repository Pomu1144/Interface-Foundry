import { toast } from 'sonner';
import type { MatchedRule } from '@shared/types';
import { studio } from '@/store';
import { buildContext } from './context';
import { fetchAiStatus, streamDiagnose } from './client';
import { heuristicDiagnosis } from './heuristics';
import { inferIntent, MAX_HISTORY_TURNS, validateDiagnosis, type AiProviderId, type DiagnoseIntent, type DiagnoseRequest, type ProposedFix } from './schema';
import { ai, patchExperiment, patchFix, patchTurn, useAi, type Experiment, type ExperimentKind, type Thread, type Turn } from './state';
import { applyFix, breakpointExperiment, discardGroup, hasGroup, isGroupExperiment, previewFix, ruleExperiment, styleExperiment } from './fixes';
import { measureCurrent, rerunChecks } from './measure';
import { compareMeasurements } from './metrics';

/**
 * Orchestrates a diagnosis: context → consent gate → provider (offline engine,
 * an Anthropic or local model) → validated result; plus fix previews and debug
 * experiments with before/after measurements.
 */

let seq = 0;
const tid = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;
const controllers = new Map<string, AbortController>();

export const SUGGESTED_PROMPTS: { label: string; question: string; intent: DiagnoseIntent }[] = [
  { label: 'Why is this overflowing?', question: 'Why is this overflowing?', intent: 'overflow' },
  { label: 'Why does it look different expanded?', question: 'Why does it look different expanded?', intent: 'posture' },
  { label: 'Suggest an accessible fix', question: 'Suggest an accessible fix', intent: 'a11y' },
  { label: 'Propose a layout for the expanded posture', question: 'Propose a layout for the expanded posture', intent: 'layout' },
];

export function threadKeyFor(selector: string | null, route = studio().currentRoute): string {
  return `${route}::${selector ?? ''}`;
}

export function currentThreadKey(): string | null {
  const sel = studio().selection.info?.selector ?? studio().selection.selector;
  return sel ? threadKeyFor(sel) : null;
}

/* ------------------------------------------------------------------ */
/* Provider status                                                     */
/* ------------------------------------------------------------------ */

export async function loadStatus() {
  useAi.setState({ statusState: 'loading' });
  try {
    const status = await fetchAiStatus();
    useAi.setState({ status, statusState: 'ready' });
  } catch {
    const caps = studio().server.capabilities?.ai;
    useAi.setState({
      statusState: 'offline',
      status: caps
        ? { providers: { heuristic: { available: true }, anthropic: { configured: caps.anthropic, model: caps.model }, local: { configured: caps.local, model: caps.localModel, endpoint: null } }, limits: { maxBodyBytes: 0, perMinute: 0 } }
        : null,
    });
  }
}

export function providerAvailable(p: AiProviderId): boolean {
  if (p === 'heuristic') return true;
  const st = ai().status;
  if (!st || ai().statusState === 'offline') return false;
  return p === 'anthropic' ? st.providers.anthropic.configured : st.providers.local.configured;
}

export function providerLabel(p: AiProviderId): string {
  if (p === 'anthropic') return 'Anthropic model';
  if (p === 'local') return 'Local model';
  return 'Offline engine';
}

/* ------------------------------------------------------------------ */
/* Diagnosis                                                           */
/* ------------------------------------------------------------------ */

function ensureThread(key: string): Thread {
  const s = studio();
  const existing = ai().threads[key];
  if (existing) return existing;
  const info = s.selection.info;
  const thread: Thread = { key, label: info?.label ?? 'element', selector: info?.selector ?? '', route: s.currentRoute, turns: [] };
  useAi.setState((st) => ({ threads: { ...st.threads, [key]: thread } }));
  return thread;
}

function historyFor(thread: Thread, excludeId: string) {
  return thread.turns
    .filter((t) => t.id !== excludeId && t.status === 'done' && t.diagnosis)
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => ({ question: t.question, summary: t.diagnosis!.summary, fixes: t.diagnosis!.proposedFixes.map((f) => f.title) }));
}

/** Start a diagnosis for the current selection. */
export async function diagnose(question: string, intentHint?: DiagnoseIntent) {
  const s = studio();
  const info = s.selection.info;
  if (!info) {
    toast('Select an element in the preview first');
    return;
  }
  const q = question.trim() || 'Why is this overflowing?';
  const intent = intentHint ?? inferIntent(q);
  const key = threadKeyFor(info.selector);
  const thread = ensureThread(key);
  const requested = s.settings.aiProvider;
  const external = requested !== 'heuristic';
  const usable = external && providerAvailable(requested);
  const provider: AiProviderId = usable ? requested : 'heuristic';
  const turn: Turn = {
    id: tid(),
    question: q,
    intent,
    provider,
    status: 'collecting',
    stage: { stage: 'collecting', message: 'Collecting element context' },
    startedAt: Date.now(),
    notice: external && !usable ? `${requested === 'anthropic' ? 'Anthropic is' : 'The local model is'} not configured on the companion, so the offline engine answered.` : undefined,
  };
  useAi.setState((st) => ({ view: 'diagnose', threads: { ...st.threads, [key]: { ...(st.threads[key] ?? thread), turns: [...(st.threads[key]?.turns ?? []), turn] } } }));
  try {
    const wantsCompare = intent === 'posture' || intent === 'layout' || info.computed.display === 'none';
    const built = await buildContext({ compare: wantsCompare, onStage: (message) => patchTurn(key, turn.id, { stage: { stage: 'collecting', message } }) });
    patchTurn(key, turn.id, { context: built.context, selectorMap: built.selectorMap, redaction: built.stats, baseline: built.baseline, otherBaseline: built.otherBaseline });
    if (provider === 'heuristic') return runHeuristic(key, turn.id);
    const payload: DiagnoseRequest = { provider, question: q, intent, context: built.context, history: historyFor(ai().threads[key] ?? thread, turn.id) };
    patchTurn(key, turn.id, { payload });
    if (!s.settings.aiConsent) {
      patchTurn(key, turn.id, { status: 'consent', stage: null });
      return;
    }
    await runRemote(key, turn.id);
  } catch (err) {
    patchTurn(key, turn.id, { status: 'error', error: (err as Error).message, stage: null, durationMs: Date.now() - turn.startedAt });
  }
}

function findTurn(key: string, id: string): Turn | undefined {
  return ai().threads[key]?.turns.find((t) => t.id === id);
}

export function runHeuristic(key: string, turnId: string) {
  const t = findTurn(key, turnId);
  if (!t?.context) return;
  const raw = heuristicDiagnosis(t.context, t.question, t.intent);
  const v = validateDiagnosis(raw);
  if (!v.ok) {
    patchTurn(key, turnId, { status: 'error', error: v.errors.join('; '), stage: null });
    return;
  }
  patchTurn(key, turnId, {
    status: 'done',
    provider: 'heuristic',
    diagnosis: v.value,
    repairs: v.repairs,
    model: 'heuristic rules',
    stage: null,
    durationMs: Date.now() - t.startedAt,
  });
}

/** Send a turn's prepared payload to the companion (after consent). */
export async function runRemote(key: string, turnId: string) {
  const t = findTurn(key, turnId);
  if (!t?.payload) return;
  const controller = new AbortController();
  controllers.set(turnId, controller);
  patchTurn(key, turnId, { status: 'running', stage: { stage: 'sending', message: 'Connecting to the companion' } });
  let finished = false;
  try {
    await streamDiagnose(
      t.payload,
      (e) => {
        if (e.type === 'progress') patchTurn(key, turnId, { stage: { stage: e.stage, message: e.message, chars: e.chars, thinking: e.thinking } });
        else if (e.type === 'result') {
          finished = true;
          patchTurn(key, turnId, { status: 'done', diagnosis: e.diagnosis, model: e.model, servedBy: e.servedBy, repairs: e.repairs, durationMs: Date.now() - t.startedAt, stage: null });
        } else if (e.type === 'error') {
          finished = true;
          patchTurn(key, turnId, { status: 'error', error: e.message, stage: null, durationMs: Date.now() - t.startedAt });
        }
      },
      controller.signal,
    );
    if (!finished) patchTurn(key, turnId, { status: 'error', error: 'The companion closed the stream without a result.', stage: null });
  } catch (err) {
    if (controller.signal.aborted) patchTurn(key, turnId, { status: 'cancelled', stage: null });
    else patchTurn(key, turnId, { status: 'error', error: (err as Error).message, stage: null });
  } finally {
    controllers.delete(turnId);
  }
}

export function cancelTurn(key: string, turnId: string) {
  controllers.get(turnId)?.abort();
  const t = findTurn(key, turnId);
  if (t && (t.status === 'consent' || t.status === 'collecting')) patchTurn(key, turnId, { status: 'cancelled', stage: null });
}

export function consentSendOnce(key: string, turnId: string) {
  void runRemote(key, turnId);
}

export function consentAlways(key: string, turnId: string) {
  studio().updateSettings({ aiConsent: true });
  void runRemote(key, turnId);
}

export function consentUseOffline(key: string, turnId: string) {
  patchTurn(key, turnId, { provider: 'heuristic', notice: 'You chose the offline engine; nothing was sent.' });
  runHeuristic(key, turnId);
}

export function clearThread(key: string) {
  useAi.setState((st) => {
    const threads = { ...st.threads };
    delete threads[key];
    return { threads };
  });
}

/* ------------------------------------------------------------------ */
/* Fixes                                                               */
/* ------------------------------------------------------------------ */

export const fixKey = (turnId: string, fixId: string) => `${turnId}:${fixId}`;

function turnByFix(key: string): { thread: string; turn: Turn } | null {
  const [turnId] = key.split(':');
  for (const th of Object.values(ai().threads)) {
    const t = th.turns.find((x) => x.id === turnId);
    if (t) return { thread: th.key, turn: t };
  }
  return null;
}

async function measureAfter(key: string, selector: string | null) {
  const st = ai().fixes[key];
  try {
    const after = await measureCurrent(selector);
    if (st?.before) patchFix(key, { result: compareMeasurements(st.before, after), busy: undefined });
    else patchFix(key, { busy: undefined });
  } catch (err) {
    patchFix(key, { busy: undefined, error: (err as Error).message });
  }
}

export async function previewFixAction(turnId: string, fix: ProposedFix) {
  const key = fixKey(turnId, fix.id);
  const found = turnByFix(key);
  if (!found) return;
  const { turn } = found;
  const selector = studio().selection.info?.selector ?? null;
  patchFix(key, { busy: 'preview', error: undefined });
  try {
    const before = await measureCurrent(selector);
    const groupId = previewFix(fix, { ctx: turn.context, selectorMap: turn.selectorMap, provider: turn.provider });
    patchFix(key, { status: 'previewing', groupId, before, busy: 'measure', rerun: undefined });
    await measureAfter(key, selector);
  } catch (err) {
    patchFix(key, { busy: undefined, error: (err as Error).message });
  }
}

export async function applyFixAction(turnId: string, fix: ProposedFix) {
  const key = fixKey(turnId, fix.id);
  const found = turnByFix(key);
  if (!found) return;
  const st = ai().fixes[key];
  const selector = studio().selection.info?.selector ?? null;
  patchFix(key, { busy: 'apply', error: undefined });
  try {
    const before = st?.groupId && hasGroup(st.groupId) ? st.before : await measureCurrent(selector);
    const groupId = applyFix(fix, { ctx: found.turn.context, selectorMap: found.turn.selectorMap, provider: found.turn.provider, groupId: st?.groupId });
    patchFix(key, { status: 'applied', groupId, before, busy: 'measure' });
    toast.success(`Applied “${fix.title}”`, { description: 'Recorded in History; undo with ⌘Z / Ctrl+Z.' });
    await measureAfter(key, selector);
  } catch (err) {
    patchFix(key, { busy: undefined, error: (err as Error).message });
  }
}

export function discardFixAction(turnId: string, fix: ProposedFix) {
  const key = fixKey(turnId, fix.id);
  const st = ai().fixes[key];
  if (st?.groupId) discardGroup(st.groupId);
  patchFix(key, { status: 'discarded', groupId: undefined, result: undefined, rerun: undefined, busy: undefined });
}

export async function rerunFixChecks(turnId: string, fix: ProposedFix) {
  const key = fixKey(turnId, fix.id);
  const found = turnByFix(key);
  const st = ai().fixes[key];
  if (!found || !st) return;
  patchFix(key, { busy: 'rerun', error: undefined });
  try {
    const rerun = await rerunChecks({ selector: studio().selection.info?.selector ?? found.turn.context?.element.selector ?? null, groupId: st.groupId ?? null, baseline: st.before ?? found.turn.baseline ?? null });
    patchFix(key, { rerun, busy: undefined });
  } catch (err) {
    patchFix(key, { busy: undefined, error: (err as Error).message });
  }
}

/** Keep fix state in sync with the change list (undo, History panel removals, external promotes). */
export function syncFixStates() {
  const fixes = ai().fixes;
  let changed = false;
  const next = { ...fixes };
  for (const [k, f] of Object.entries(fixes)) {
    if (!f.groupId || f.status === 'discarded') continue;
    if (!hasGroup(f.groupId)) {
      next[k] = { ...f, status: 'idle', groupId: undefined, result: undefined, rerun: undefined };
      changed = true;
    } else if (f.status === 'previewing' && !isGroupExperiment(f.groupId)) {
      next[k] = { ...f, status: 'applied' };
      changed = true;
    }
  }
  if (changed) useAi.setState({ fixes: next });
  const exps = ai().experiments;
  for (const e of exps) {
    if ((e.status === 'active' || e.status === 'measuring') && !hasGroup(e.id)) patchExperiment(e.id, { status: 'gone' });
    else if (e.status === 'active' && !isGroupExperiment(e.id)) patchExperiment(e.id, { status: 'promoted' });
  }
}

/* ------------------------------------------------------------------ */
/* Debug experiments                                                   */
/* ------------------------------------------------------------------ */

async function runExperiment(kind: ExperimentKind, label: string, detail: string, apply: () => string) {
  const selector = studio().selection.info?.selector ?? null;
  let before;
  try {
    before = await measureCurrent(selector);
  } catch (err) {
    toast.error((err as Error).message);
    return;
  }
  const id = apply();
  const exp: Experiment = { id, label, detail, kind, selector: selector ?? '', status: 'measuring', createdAt: Date.now(), before };
  useAi.setState((st) => ({ experiments: [exp, ...st.experiments].slice(0, 40) }));
  try {
    const after = await measureCurrent(selector);
    patchExperiment(id, { status: 'active', after, result: compareMeasurements(before, after) });
  } catch (err) {
    patchExperiment(id, { status: 'active', error: (err as Error).message });
  }
}

export function experimentDisable(rule: MatchedRule, property: string, value: string) {
  return runExperiment('disable', `Disable ${property}`, `${rule.selector} — ${rule.source.label}${rule.source.line ? `:${rule.source.line}` : ''}`, () => ruleExperiment(rule, property, value, null));
}

export function experimentValue(rule: MatchedRule, property: string, before: string, value: string) {
  return runExperiment('value', `${property}: ${before} → ${value}`, `${rule.selector} — ${rule.source.label}${rule.source.line ? `:${rule.source.line}` : ''}`, () => ruleExperiment(rule, property, before, value));
}

export function experimentStyle(kind: ExperimentKind, label: string, edits: { property: string; value: string; before: string | null; media?: string }[]) {
  const info = studio().selection.info;
  if (!info) return;
  return runExperiment(kind, label, info.label, () => styleExperiment(info.selector, info.label, edits));
}

export function experimentBreakpoint(rule: MatchedRule, media: string) {
  return runExperiment('breakpoint', `@media ${(rule.media ?? []).join(' and ')} → ${media}`, `${rule.selector} — ${rule.declarations.length} declaration(s)`, () => breakpointExperiment(rule, media));
}

export function promoteExperimentAction(id: string) {
  if (hasGroup(id)) studio().promoteExperiment(id);
  patchExperiment(id, { status: 'promoted' });
}

export function discardExperimentAction(id: string) {
  discardGroup(id);
  patchExperiment(id, { status: 'discarded' });
}
