import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, Bug, ChevronDown, FoldHorizontal, MousePointerClick, Smartphone, Sparkles, TabletSmartphone, Trash2 } from 'lucide-react';
import type { NodeInfo } from '@shared/types';
import { IconButton, Menu, Segmented, type MenuEntry } from '@/ui';
import { studio, useStudio } from '@/store';
import { currentFold, currentViewportContext } from '@/modules/device-simulator/context';
import { crossesFold } from './heuristics';
import { clearThread, diagnose, loadStatus, providerAvailable, providerLabel, SUGGESTED_PROMPTS, threadKeyFor } from './engine';
import { ai, useAi } from './state';
import type { AiProviderId } from './schema';
import { TurnView } from './TurnView';
import { DebugView } from './DebugView';
import s from './ai.module.css';

/**
 * AI assistant panel (right inspector "ai" tab): evidence-based diagnosis of the
 * selected element with the offline engine, an Anthropic model or a local model,
 * plus the root-cause Debug view.
 */
export function AiPanel() {
  const project = useStudio((st) => st.project);
  const info = useStudio((st) => st.selection.info);
  const loading = useStudio((st) => st.selection.loading);
  const view = useAi((x) => x.view);
  useEffect(() => {
    if (ai().statusState === 'idle') void loadStatus();
  }, []);

  return (
    <div className={s.panel} data-testid="ai-panel">
      <div className={s.bar}>
        <Segmented
          ariaLabel="AI view"
          value={view}
          onChange={(v) => useAi.setState({ view: v })}
          options={[
            { value: 'diagnose', label: 'Diagnose', icon: <Sparkles size={12} /> },
            { value: 'debug', label: 'Debug', icon: <Bug size={12} /> },
          ]}
        />
        <span className={s.barSpacer} />
        <ProviderMenu />
      </div>
      {project && info && <TargetStrip info={info} />}
      {!project ? (
        <Intro icon={<Sparkles size={18} />} title="No project open" text="Open the Harborline demo or import a project, then select an element to diagnose it." />
      ) : !info ? (
        <>
          <div className={s.scroll}>
            <Intro neutral icon={<MousePointerClick size={18} />} title={loading ? 'Inspecting…' : 'Select an element'} text="Click an element in the preview (Inspect mode) or pick a layer. The assistant explains why it renders the way it does and proposes fixes you can preview." />
            <div className={s.prompts}>
              {SUGGESTED_PROMPTS.map((p) => (
                <button key={p.label} type="button" className={s.promptRow} disabled>
                  <Sparkles size={13} />
                  {p.label}
                  <ArrowRight size={12} />
                </button>
              ))}
            </div>
          </div>
        </>
      ) : view === 'debug' ? (
        <div className={s.scroll} style={{ padding: 0, gap: 0 }}>
          <DebugView info={info} />
        </div>
      ) : (
        <DiagnoseView info={info} />
      )}
    </div>
  );
}

function Intro({ icon, title, text, neutral }: { icon: React.ReactNode; title: string; text: string; neutral?: boolean }) {
  return (
    <div className={s.intro}>
      <span className={s.introMark} data-tone={neutral ? 'neutral' : undefined} aria-hidden>
        {icon}
      </span>
      <div className={s.introTitle}>{title}</div>
      <div className={s.introText}>{text}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

function ProviderMenu() {
  const provider = useStudio((st) => st.settings.aiProvider);
  const consent = useStudio((st) => st.settings.aiConsent);
  const status = useAi((x) => x.status);
  const statusState = useAi((x) => x.statusState);
  const available = (p: AiProviderId) => providerAvailable(p);
  void status;
  const usable = available(provider);
  const hint = (p: 'anthropic' | 'local') => {
    if (statusState === 'loading') return 'checking…';
    if (statusState === 'offline') return 'companion offline';
    return available(p) ? (p === 'local' ? (ai().status?.providers.local.endpoint ?? 'ready') : 'ready') : 'not configured';
  };
  const items: MenuEntry[] = [
    { type: 'label', label: 'Provider' },
    { label: 'Offline engine', hint: 'built-in · deterministic', checked: provider === 'heuristic', onSelect: () => studio().updateSettings({ aiProvider: 'heuristic' }) },
    { label: 'Anthropic model', hint: hint('anthropic'), checked: provider === 'anthropic', disabled: !available('anthropic'), onSelect: () => studio().updateSettings({ aiProvider: 'anthropic' }) },
    { label: 'Local model', hint: hint('local'), checked: provider === 'local', disabled: !available('local'), onSelect: () => studio().updateSettings({ aiProvider: 'local' }) },
    { type: 'separator' },
    { label: 'Ask before sending context', checked: !consent, onSelect: () => studio().updateSettings({ aiConsent: !consent }) },
    { label: 'Refresh provider status', onSelect: () => void loadStatus() },
    { type: 'separator' },
    { type: 'label', label: 'Keys stay on the companion: ANTHROPIC_API_KEY · IFDY_LOCAL_AI_URL' },
  ];
  const dotState = provider === 'heuristic' ? 'ok' : usable ? 'violet' : 'warn';
  return (
    <Menu
      align="end"
      width={268}
      items={items}
      trigger={
        <button type="button" className={s.providerTrigger} aria-label={`AI provider: ${providerLabel(provider)}`} data-testid="ai-provider">
          <span className={s.dot} data-state={dotState} />
          <span>{provider !== 'heuristic' && !usable ? `${providerLabel(provider)} · not configured` : providerLabel(provider)}</span>
          <ChevronDown size={11} />
        </button>
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Target                                                              */
/* ------------------------------------------------------------------ */

function TargetStrip({ info }: { info: NodeInfo }) {
  useStudio((st) => st.viewport);
  useStudio((st) => st.transition.progress);
  const vp = currentViewportContext();
  const fold = currentFold();
  const crosses = fold ? crossesFold(info.rect, fold) : false;
  const label = info.label.replace(/^[a-z0-9-]+/, '') || info.selector;
  return (
    <div className={s.target}>
      <span className={s.targetTag}>{info.tag}</span>
      <span className={s.targetSel} title={info.selector}>
        {label}
      </span>
      <div className={s.targetMeta}>
        <span className={s.chip} title="Viewport">
          {vp.posture === 'expanded' ? <TabletSmartphone size={11} /> : <Smartphone size={11} />}
          {vp.deviceName}
          {vp.posture === 'expanded' ? ' · expanded' : ''} · {vp.width}×{vp.height}
        </span>
        <span className={s.chip} title="Element size">
          {Math.round(info.rect.width)}×{Math.round(info.rect.height)}
        </span>
        {fold && (
          <span className={s.chip} data-tone={crosses ? 'warning' : undefined} title={crosses ? 'This element crosses the fold' : 'Fold position'}>
            <FoldHorizontal size={11} style={{ transform: fold.axis === 'vertical' ? 'rotate(90deg)' : undefined }} />
            {fold.kind} {fold.axis === 'vertical' ? 'x' : 'y'} {Math.round(fold.offset)}–{Math.round(fold.offset + fold.maskLength)}
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Diagnose                                                            */
/* ------------------------------------------------------------------ */

function DiagnoseView({ info }: { info: NodeInfo }) {
  const route = useStudio((st) => st.currentRoute);
  const key = threadKeyFor(info.selector, route);
  const thread = useAi((x) => x.threads[key]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const turns = thread?.turns ?? [];
  const last = turns.at(-1);
  const busy = Boolean(last && (last.status === 'collecting' || last.status === 'running'));

  // Follow the conversation: scroll to the newest turn when it starts and when it finishes.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !last) return;
    const node = el.querySelector<HTMLElement>(`[data-turn="${last.id}"]`);
    if (node) el.scrollTo({ top: Math.max(0, node.offsetTop - 8), behavior: 'smooth' });
  }, [last?.id, last?.status]);

  return (
    <>
      <div className={s.scroll} ref={scrollRef}>
        {turns.length === 0 ? (
          <>
            <Intro icon={<Sparkles size={18} />} title={`Diagnose ${info.label.length > 32 ? info.tag : info.label}`} text="Observed facts, inferred causes with confidence, and CSS fixes you can preview as reversible experiments." />
            <div className={s.prompts}>
              {SUGGESTED_PROMPTS.map((p) => (
                <button key={p.label} type="button" className={s.promptRow} onClick={() => void diagnose(p.question, p.intent)}>
                  <Sparkles size={13} />
                  {p.label}
                  <ArrowRight size={12} />
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {turns.length > 1 || last?.status === 'done' ? (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -6 }}>
                <IconButton size="sm" label="Clear this conversation" onClick={() => clearThread(key)}>
                  <Trash2 size={12} />
                </IconButton>
              </div>
            ) : null}
            {turns.map((t) => (
              <div key={t.id} data-turn={t.id}>
                <TurnView threadKey={key} turn={t} />
              </div>
            ))}
          </>
        )}
      </div>
      <Composer label={info.label} busy={busy} hasTurns={turns.length > 0} />
    </>
  );
}

function Composer({ label, busy, hasTurns }: { label: string; busy: boolean; hasTurns: boolean }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const provider = useStudio((st) => st.settings.aiProvider);
  const consent = useStudio((st) => st.settings.aiConsent);
  useAi((x) => x.statusState);
  const effective: AiProviderId = provider !== 'heuristic' && providerAvailable(provider) ? provider : 'heuristic';
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(96, el.scrollHeight)}px`;
  }, [text]);
  const send = (q = text) => {
    if (busy || !q.trim()) return;
    void diagnose(q);
    setText('');
  };
  return (
    <div className={s.composer}>
      {hasTurns && (
        <div className={s.suggestions} aria-label="Suggested questions">
          {SUGGESTED_PROMPTS.map((p) => (
            <button key={p.label} type="button" className={s.suggestion} disabled={busy} onClick={() => void diagnose(p.question, p.intent)}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      <div className={s.inputWrap}>
        <textarea
          ref={ref}
          className={s.input}
          rows={1}
          value={text}
          placeholder={hasTurns ? `Ask a follow-up about ${label.length > 28 ? 'this element' : label}…` : `Ask about ${label.length > 28 ? 'this element' : label}…`}
          aria-label="Question for the AI assistant"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className={s.send} aria-label="Send" disabled={busy || !text.trim()} onClick={() => send()}>
          <ArrowUp size={14} />
        </button>
      </div>
      <div className={s.composerHint}>
        <span className={s.dot} data-state={effective === 'heuristic' ? 'ok' : 'violet'} />
        <span>
          {providerLabel(effective)}
          {effective === 'heuristic' ? ' · runs locally, nothing leaves the studio' : consent ? ' · sends redacted context' : ' · asks before sending'}
        </span>
        <span>↵ send · ⇧↵ newline</span>
      </div>
    </div>
  );
}
