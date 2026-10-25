import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, Info, OctagonAlert, RotateCw, ShieldCheck, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, IconButton, Spinner, Tooltip } from '@/ui';
import type { Turn } from './state';
import { useAi } from './state';
import { cancelTurn, consentAlways, consentSendOnce, consentUseOffline, diagnose, providerLabel } from './engine';
import { diagnosisMarkdown, ResultView } from './ResultView';
import s from './ai.module.css';

const REMOTE_STEPS: { id: string; label: string }[] = [
  { id: 'collecting', label: 'Collect and redact context' },
  { id: 'sending', label: 'Send to the companion' },
  { id: 'thinking', label: 'Reason about the layout' },
  { id: 'writing', label: 'Write the diagnosis' },
  { id: 'validating', label: 'Validate against the schema' },
];
const LOCAL_STEPS = REMOTE_STEPS.filter((x) => x.id !== 'thinking');
const OFFLINE_STEPS = [
  { id: 'collecting', label: 'Collect and redact context' },
  { id: 'rules', label: 'Run offline rules' },
];

function fmtMs(ms?: number) {
  if (ms === undefined) return '';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function Progress({ threadKey, turn }: { threadKey: string; turn: Turn }) {
  const steps = turn.provider === 'heuristic' ? OFFLINE_STEPS : turn.provider === 'local' ? LOCAL_STEPS : REMOTE_STEPS;
  const stage = turn.stage?.stage === 'queued' ? 'sending' : turn.stage?.stage === 'repairing' ? 'validating' : turn.stage?.stage ?? 'collecting';
  const current = Math.max(0, steps.findIndex((x) => x.id === stage));
  return (
    <div className={s.progress} role="status" aria-live="polite">
      <ol className={s.steps}>
        {steps.map((step, i) => {
          const state = i < current ? 'done' : i === current ? 'active' : 'pending';
          return (
            <li key={step.id} className={s.step} data-state={state}>
              <span className={s.stepIcon}>{state === 'done' ? <Check size={12} /> : state === 'active' ? <Spinner size={11} /> : <span className={s.pending} />}</span>
              <span>{state === 'active' && turn.stage?.message ? turn.stage.message : step.label}</span>
              {state === 'active' && turn.stage?.chars ? <span className={s.chars}>{(turn.stage.chars / 1000).toFixed(1)}k chars</span> : null}
            </li>
          );
        })}
      </ol>
      {turn.stage?.thinking && <div className={s.thinking}>“…{turn.stage.thinking.trim()}”</div>}
      {turn.provider !== 'heuristic' && turn.status === 'running' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <Button size="sm" variant="ghost" icon={<X size={12} />} onClick={() => cancelTurn(threadKey, turn.id)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function Consent({ threadKey, turn }: { threadKey: string; turn: Turn }) {
  const [review, setReview] = useState(false);
  const status = useAi((x) => x.status);
  const json = JSON.stringify(turn.payload, null, 2);
  const bytes = new Blob([json]).size;
  const r = turn.redaction;
  const destination =
    turn.provider === 'anthropic'
      ? 'the Anthropic API, through the IFDY companion (the API key stays on the companion)'
      : `the local model endpoint ${status?.providers.local.endpoint ?? 'configured on the companion'}`;
  return (
    <div className={s.consent} role="dialog" aria-label="Review before sending">
      <div className={s.consentHead}>
        <ShieldCheck size={15} />
        Send this context to {turn.provider === 'anthropic' ? 'Anthropic' : 'the local model'}?
      </div>
      <p className={s.consentText}>
        IFDY will send the redacted diagnosis context for this element to {destination}. It contains geometry, matched CSS, audit findings and console errors — no form values or credentials. Nothing is stored by IFDY.
      </p>
      <div className={s.consentStats}>
        <span className={s.chip}>{(bytes / 1024).toFixed(1)} KB</span>
        {r && r.masked > 0 && <span className={s.chip}>{r.masked} digit runs masked</span>}
        {r && r.dropped > 0 && <span className={s.chip}>{r.dropped} form values removed</span>}
        {r && r.opaque > 0 && <span className={s.chip}>{r.opaque} opaque values replaced</span>}
        {r && r.truncated > 0 && <span className={s.chip}>{r.truncated} texts truncated</span>}
      </div>
      <button type="button" className={s.review} aria-expanded={review} onClick={() => setReview((v) => !v)}>
        {review ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Review what will be sent
      </button>
      {review && (
        <pre className={s.payload} tabIndex={0} aria-label="Exact request payload">
          {json}
        </pre>
      )}
      <div className={s.consentActions}>
        <Button size="sm" variant="violet" onClick={() => consentSendOnce(threadKey, turn.id)}>
          Send once
        </Button>
        <Button size="sm" onClick={() => consentAlways(threadKey, turn.id)}>
          Always allow for this project
        </Button>
      </div>
      <div>
        <button type="button" className={s.linkButton} onClick={() => consentUseOffline(threadKey, turn.id)}>
          Use offline engine instead
        </button>
      </div>
    </div>
  );
}

export function TurnView({ threadKey, turn }: { threadKey: string; turn: Turn }) {
  const label = providerLabel(turn.provider);
  return (
    <div className={s.turn}>
      <div className={s.question}>{turn.question}</div>
      {(turn.status === 'collecting' || turn.status === 'running') && <Progress threadKey={threadKey} turn={turn} />}
      {turn.status === 'consent' && <Consent threadKey={threadKey} turn={turn} />}
      {turn.status === 'cancelled' && (
        <div className={s.notice}>
          <Info size={12} />
          Cancelled — nothing was changed.
        </div>
      )}
      {turn.status === 'error' && (
        <div className={s.error} role="alert">
          <OctagonAlert size={14} />
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span>{turn.error}</span>
            <div className={s.actions}>
              <Button size="sm" icon={<RotateCw size={12} />} onClick={() => void diagnose(turn.question, turn.intent)}>
                Retry
              </Button>
              {turn.provider !== 'heuristic' && turn.context && (
                <Button size="sm" variant="ghost" onClick={() => consentUseOffline(threadKey, turn.id)}>
                  Use offline engine
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
      {turn.status === 'done' && turn.diagnosis && (
        <>
          <div className={s.answerHead}>
            <Sparkles size={13} />
            <span className={s.answerProvider}>{label}</span>
            <span className={s.answerMeta}>
              {fmtMs(turn.durationMs)}
              {turn.context ? ` · ${turn.context.viewport.width}×${turn.context.viewport.height}${turn.context.viewport.posture === 'expanded' ? ' expanded' : ''}` : ''}
            </span>
            {turn.servedBy && turn.model && turn.servedBy !== turn.model && turn.provider === 'anthropic' && (
              <Tooltip content="The requested model declined; the server-side fallback model answered.">
                <span>
                  <Badge tone="warning">fallback</Badge>
                </span>
              </Tooltip>
            )}
            {turn.repairs && turn.repairs.length > 0 && (
              <Tooltip content={turn.repairs.slice(0, 8).join(' · ')}>
                <span>
                  <Badge tone="outline">{turn.repairs.length} repaired</Badge>
                </span>
              </Tooltip>
            )}
            <span className={s.headActions}>
              <IconButton
                size="sm"
                label="Copy as Markdown"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(diagnosisMarkdown(turn.diagnosis!, turn.question))
                    .then(() => toast.success('Diagnosis copied as Markdown'))
                    .catch(() => toast.error('Clipboard is not available'));
                }}
              >
                <Copy size={12} />
              </IconButton>
              <IconButton size="sm" label="Run again" onClick={() => void diagnose(turn.question, turn.intent)}>
                <RotateCw size={12} />
              </IconButton>
            </span>
          </div>
          {turn.notice && (
            <div className={s.notice}>
              <Info size={12} />
              {turn.notice}
            </div>
          )}
          <ResultView turn={turn} diagnosis={turn.diagnosis} />
        </>
      )}
    </div>
  );
}
