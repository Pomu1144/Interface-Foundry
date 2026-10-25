import { ArrowLeft, ArrowRight, Check, ExternalLink, KeyRound, Lock, Trash2, TriangleAlert } from 'lucide-react';
import type { Scenario, StepAction, StepResult, TestStep } from '@shared/types';
import { Badge, IconButton, NumberField, Select, TextField } from '@/ui';
import { useStudio } from '@/store';
import { formatMs } from '@/modules/interaction-replayer/summary';
import { StatusGlyph, StepIcon } from './bits';
import { deleteStep, reorderStep, tryEdit, updateStep } from './recording';
import { ACTION_LABELS, ASSERTION_LABELS, describeViewportState, hasSecret, locatorStrategies, maskValue, secretNames, secretPlaceholder, stepLocator } from './steps';
import s from './timeline.module.css';

const STRATEGY_KEY: Record<string, string> = { testId: 'testId', 'role+name': 'role+name', label: 'label', placeholder: 'placeholder', css: 'css', text: 'text' };

function KV({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className={s.kv}>
      <span className={s.kvK}>{k}</span>
      <div className={s.kvV}>{children}</div>
    </div>
  );
}

function SecretValue({ value, onChange, editable }: { value: string; onChange: (v: string) => void; editable: boolean }) {
  const fixtures = useStudio((st) => st.settings.fixtures);
  const names = secretNames(value);
  const missing = names.filter((n) => !(n in fixtures));
  return (
    <div className={s.secret}>
      <span className={s.secretValue}>
        <Lock size={11} />
        {maskValue(value)}
      </span>
      {missing.length ? (
        <Badge tone="warning" title="Add a synthetic value under Settings → Fixtures">
          missing fixture
        </Badge>
      ) : names.length ? (
        <Badge tone="success" title="Resolved from Settings → Fixtures at replay time; never stored">
          fixture
        </Badge>
      ) : (
        <Badge tone="warning" title="This value was masked while recording. Pick a fixture so the step can be replayed.">
          masked
        </Badge>
      )}
      {editable && (
        <Select
          ariaLabel="Fixture"
          value={names[0] && names[0] in fixtures ? names[0] : ''}
          onChange={(n) => n && onChange(secretPlaceholder(n))}
          options={[{ value: '', label: 'Use fixture…' }, ...Object.keys(fixtures).map((n) => ({ value: n, label: n }))]}
          style={{ width: 120 }}
        />
      )}
    </div>
  );
}

function ActionFields({ step, editable }: { step: TestStep; editable: boolean }) {
  const a = step.action;
  const set = (action: StepAction) => tryEdit(() => updateStep(step.id, { action }));
  const deviceName = (id: string) => useStudio.getState().allDevices().find((d) => d.id === id)?.name ?? id;
  switch (a.type) {
    case 'fill':
      return (
        <KV k="Value">
          {a.masked || hasSecret(a.value) ? (
            <SecretValue value={hasSecret(a.value) ? a.value : '{{secret:value}}'} editable={editable} onChange={(v) => set({ ...a, value: v, masked: true })} />
          ) : editable ? (
            <TextField mono value={a.value} onCommit={(v) => set({ ...a, value: v })} placeholder="(empty — clears the field)" />
          ) : (
            <code className={s.code}>{a.value || '(empty)'}</code>
          )}
        </KV>
      );
    case 'select':
      return <KV k="Option">{editable ? <TextField mono value={a.value} onCommit={(v) => set({ ...a, value: v })} /> : <code className={s.code}>{a.value}</code>}</KV>;
    case 'press':
      return <KV k="Key">{editable ? <TextField mono value={a.key} onCommit={(v) => v && set({ ...a, key: v })} /> : <code className={s.code}>{a.key}</code>}</KV>;
    case 'check':
      return <KV k="State">{a.checked ? 'checked' : 'unchecked'}</KV>;
    case 'click':
      return (a.clickCount ?? 1) > 1 ? <KV k="Clicks">{a.clickCount} (same task)</KV> : null;
    case 'navigate':
      return <KV k="URL">{editable ? <TextField mono value={a.url} onCommit={(v) => v && set({ ...a, url: v })} /> : <code className={s.code}>{a.url}</code>}</KV>;
    case 'viewport':
      return <KV k="Device">{describeViewportState(a.state, deviceName(a.state.deviceId))}</KV>;
    case 'fold':
      return (
        <KV k="Posture">
          {editable ? (
            <Select ariaLabel="Posture" value={a.posture} onChange={(p) => set({ ...a, posture: p })} options={[{ value: 'folded', label: 'Folded' }, { value: 'expanded', label: 'Expanded' }]} />
          ) : (
            a.posture
          )}
          <span className={s.hint}>Skipped on single-posture devices.</span>
        </KV>
      );
    case 'screenshot':
      return <KV k="Label">{editable ? <TextField value={a.label} onCommit={(v) => set({ ...a, label: v || 'Screenshot' })} /> : a.label}</KV>;
    case 'wait': {
      const c = a.condition;
      if (c.kind === 'delay') return <KV k="Delay">{editable ? <NumberField value={`${c.ms}ms`} unit="ms" min={1} max={60000} step={100} onCommit={(v) => set({ ...a, condition: { kind: 'delay', ms: Math.round(parseFloat(v) || 0) || 1 } })} /> : `${c.ms} ms`}</KV>;
      if (c.kind === 'text') return <KV k="Text">{editable ? <TextField value={c.text} onCommit={(v) => set({ ...a, condition: { ...c, text: v } })} /> : maskValue(c.text)}</KV>;
      if (c.kind === 'url') return <KV k="URL has">{editable ? <TextField mono value={c.includes} onCommit={(v) => set({ ...a, condition: { ...c, includes: v } })} /> : <code className={s.code}>{c.includes}</code>}</KV>;
      return <KV k="Until">{c.kind === 'visible' ? 'visible' : 'hidden'}</KV>;
    }
    case 'assert': {
      const as = a.assertion;
      return (
        <>
          <KV k="Check">{ASSERTION_LABELS[as.kind]}</KV>
          {as.kind === 'text' && <KV k="Contains">{editable ? <TextField value={as.text} onCommit={(v) => set({ ...a, assertion: { ...as, text: v } })} /> : maskValue(as.text)}</KV>}
          {as.kind === 'value' &&
            (hasSecret(as.value) ? (
              <KV k="Equals">
                <SecretValue value={as.value} editable={editable} onChange={(v) => set({ ...a, assertion: { ...as, value: v } })} />
              </KV>
            ) : (
              <KV k="Equals">{editable ? <TextField mono value={as.value} placeholder="(empty)" onCommit={(v) => set({ ...a, assertion: { ...as, value: v } })} /> : <code className={s.code}>{as.value || '(empty)'}</code>}</KV>
            ))}
          {as.kind === 'count' && <KV k="Count">{editable ? <NumberField value={String(as.count)} unit="" min={0} onCommit={(v) => set({ ...a, assertion: { ...as, count: Math.max(0, Math.round(parseFloat(v) || 0)) } })} /> : as.count}</KV>}
          {as.kind === 'enabled' && (
            <KV k="Expect">
              {editable ? (
                <Select ariaLabel="Expect" value={as.enabled ? 'on' : 'off'} onChange={(v) => set({ ...a, assertion: { ...as, enabled: v === 'on' } })} options={[{ value: 'on', label: 'Enabled' }, { value: 'off', label: 'Disabled' }]} />
              ) : as.enabled ? (
                'enabled'
              ) : (
                'disabled'
              )}
            </KV>
          )}
        </>
      );
    }
    default:
      return null;
  }
}

export function StepDetails({ step, index, count, result, editable, readonlyReason, scenario }: { step: TestStep; index: number; count: number; result?: StepResult; editable: boolean; readonlyReason?: string; scenario?: Scenario }) {
  const loc = stepLocator(step.action);
  const used = result?.usedLocator;
  return (
    <div className={s.details}>
      <div className={s.detailsHead}>
        <StepIcon type={step.action.type} size={13} />
        <div className={s.detailsTitle}>
          <span>{ACTION_LABELS[step.action.type]}</span>
          <span className={s.detailsIndex}>
            Step {index + 1} of {count}
          </span>
        </div>
        {editable ? (
          <span className={s.detailsActions}>
            <IconButton size="sm" label="Move earlier" disabled={index === 0} onClick={() => tryEdit(() => reorderStep(index, index - 1))}>
              <ArrowLeft size={13} />
            </IconButton>
            <IconButton size="sm" label="Move later" disabled={index === count - 1} onClick={() => tryEdit(() => reorderStep(index, index + 1))}>
              <ArrowRight size={13} />
            </IconButton>
            <IconButton size="sm" label="Delete step" tone="danger" onClick={() => tryEdit(() => deleteStep(step.id))}>
              <Trash2 size={13} />
            </IconButton>
          </span>
        ) : (
          <Badge tone="outline" title={readonlyReason}>
            Read-only
          </Badge>
        )}
      </div>

      <div className={s.detailsBody}>
        {result && (
          <div className={s.result} data-status={result.status}>
            <StatusGlyph status={result.status} size={13} />
            <span className={s.resultText}>
              {result.status === 'passed' ? 'Passed' : result.status === 'failed' ? 'Failed' : result.error ? 'Not applicable' : 'Skipped'}
              <span className={s.resultMeta}>
                {result.status !== 'skipped' && formatMs(result.durationMs)}
                {used && ` · located by ${used}`}
              </span>
            </span>
          </div>
        )}
        {result?.error && (
          <div className={s.error} data-tone={result.status === 'failed' ? 'danger' : 'muted'}>
            <TriangleAlert size={12} />
            <span>{result.error}</span>
          </div>
        )}
        {result?.screenshot && (
          <a className={s.shotLarge} href={result.screenshot} target="_blank" rel="noreferrer" title="Open full size">
            <img src={result.screenshot} alt={`Screenshot at step ${index + 1}`} />
            <ExternalLink size={11} className={s.shotOpen} />
          </a>
        )}

        <KV k="Description">{editable ? <TextField value={step.description} onCommit={(v) => tryEdit(() => updateStep(step.id, { description: v }))} /> : <span className={s.plain}>{step.description}</span>}</KV>
        <KV k="Expected">
          {editable ? (
            <TextField value={step.expect ?? ''} placeholder="Expected outcome (optional)" onCommit={(v) => tryEdit(() => updateStep(step.id, { expect: v || undefined }))} />
          ) : (
            <span className={s.plain}>{step.expect ?? '—'}</span>
          )}
        </KV>
        <ActionFields step={step} editable={editable} />
        <KV k="Timeout">
          {editable ? (
            <NumberField value={`${step.timeout}ms`} unit="ms" min={100} max={120000} step={100} onCommit={(v) => tryEdit(() => updateStep(step.id, { timeout: Math.max(100, Math.round(parseFloat(v) || 5000)) }))} />
          ) : (
            <span className={s.plain}>{formatMs(step.timeout)}</span>
          )}
        </KV>

        {loc && (
          <div className={s.locators}>
            <div className={s.locHead}>
              <KeyRound size={11} />
              Locator strategies <span className={s.hint}>tried in order</span>
            </div>
            {locatorStrategies(loc).map((st) => {
              const isUsed = used === STRATEGY_KEY[st.key];
              return (
                <div key={st.key} className={s.loc} data-used={isUsed ? 'true' : undefined}>
                  <span className={s.locK}>{st.label}</span>
                  <code className={s.locV} title={st.value}>
                    {st.value}
                  </code>
                  {isUsed && <Check size={12} className={s.locUsed} aria-label="Used in this run" />}
                </div>
              );
            })}
          </div>
        )}
        {scenario?.builtIn && <p className={s.hint}>Built-in step from the financial UX suite. Duplicate the scenario to edit it.</p>}
      </div>
    </div>
  );
}
