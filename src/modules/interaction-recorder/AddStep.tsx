import { Camera, Crosshair, Hourglass, Plus, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import type { WaitCondition } from '@shared/types';
import { Button, Popover, Segmented, Select, Switch } from '@/ui';
import { useStudio } from '@/store';
import { assertionStep, buildAssertion, insertStep, locatorFromInfo, screenshotStep, selectedValue, tryEdit, waitStep, type AssertKind } from './recording';
import { ASSERTION_LABELS, locatorLabel, secretPlaceholder } from './steps';
import s from './addstep.module.css';

type Tab = 'assert' | 'wait' | 'screenshot';
type WaitKind = 'delay' | 'visible' | 'hidden' | 'text' | 'url';

const ASSERT_KINDS: AssertKind[] = ['visible', 'text', 'value', 'focused', 'in-viewport', 'enabled', 'hidden', 'no-horizontal-overflow'];
const WAIT_LABELS: Record<WaitKind, string> = { delay: 'Fixed delay', visible: 'Element visible', hidden: 'Element hidden', text: 'Text appears', url: 'URL includes' };

/**
 * Popover to add an assertion, wait or screenshot step. Element checks use the
 * element selected on the canvas (Inspect mode) or in Layers.
 */
export function AddStepPopover({ trigger, where, side = 'bottom', align = 'end' }: { trigger: ReactElement; where: string; side?: 'top' | 'bottom'; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const info = useStudio((st) => st.selection.info);
  const interaction = useStudio((st) => st.interaction);
  const fixtures = useStudio((st) => st.settings.fixtures);
  const [tab, setTab] = useState<Tab>('assert');
  const [kind, setKind] = useState<AssertKind>('visible');
  const [waitKind, setWaitKind] = useState<WaitKind>('delay');
  const [text, setText] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [ms, setMs] = useState('1000');
  const [label, setLabel] = useState('');
  const [sensitive, setSensitive] = useState(false);
  const locator = info ? locatorFromInfo(info) : null;
  const needsElement = (tab === 'assert' && kind !== 'no-horizontal-overflow') || (tab === 'wait' && (waitKind === 'visible' || waitKind === 'hidden'));
  const needsText = (tab === 'assert' && (kind === 'text' || kind === 'value')) || (tab === 'wait' && (waitKind === 'text' || waitKind === 'url'));

  // Prefill from the selection.
  useEffect(() => {
    if (!open) return;
    setSensitive(false);
    if (tab === 'assert' && kind === 'text') setText(info?.text?.slice(0, 120) ?? '');
    else if (tab === 'assert' && kind === 'value') {
      setText('');
      void selectedValue().then((v) => {
        if (!v) return;
        setSensitive(v.sensitive);
        setText(v.sensitive ? '' : v.value);
      });
    } else if (tab === 'assert' && kind === 'enabled') setEnabled(!info?.a11y.states.includes('disabled'));
    else if (tab === 'wait' && waitKind === 'url') setText(useStudio.getState().currentRoute || '#/');
    else if (tab === 'wait' && waitKind === 'text') setText('');
  }, [open, tab, kind, waitKind, info]);

  const canAdd = (!needsElement || Boolean(locator)) && (!needsText || text.length > 0 || (tab === 'assert' && kind === 'value')) && (tab !== 'wait' || waitKind !== 'delay' || Number(ms) > 0);

  const add = () =>
    tryEdit(() => {
      if (tab === 'screenshot') insertStep(screenshotStep(label || 'Screenshot'));
      else if (tab === 'wait') {
        const c: WaitCondition =
          waitKind === 'delay'
            ? { kind: 'delay', ms: Math.min(60_000, Math.max(1, Math.round(Number(ms)))) }
            : waitKind === 'text'
              ? { kind: 'text', text }
              : waitKind === 'url'
                ? { kind: 'url', includes: text }
                : { kind: waitKind, locator: locator! };
        insertStep(waitStep(c, waitKind === 'delay' ? Number(ms) + 1000 : 5000));
      } else {
        const a = buildAssertion(kind, locator, { text, value: text, enabled });
        if (!a) throw new Error('Select an element first.');
        insertStep(assertionStep(a));
      }
      setOpen(false);
    });

  const secretNames = Object.keys(fixtures);
  return (
    <Popover open={open} onOpenChange={setOpen} trigger={trigger} side={side} align={align} width={340}>
      <div className={s.pop}>
        <div className={s.head}>
          <span className={s.title}>Add step</span>
          <span className={s.where}>{where}</span>
        </div>
        <Segmented
          ariaLabel="Step type"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'assert', label: 'Assert', icon: <ShieldCheck size={12} /> },
            { value: 'wait', label: 'Wait', icon: <Hourglass size={12} /> },
            { value: 'screenshot', label: 'Screenshot', icon: <Camera size={12} /> },
          ]}
        />
        {tab === 'assert' && (
          <div className={s.row}>
            <span className={s.k}>Check</span>
            <Select ariaLabel="Assertion" value={kind} onChange={setKind} options={ASSERT_KINDS.map((k) => ({ value: k, label: ASSERTION_LABELS[k] }))} style={{ flex: 1 }} />
          </div>
        )}
        {tab === 'wait' && (
          <div className={s.row}>
            <span className={s.k}>Until</span>
            <Select ariaLabel="Wait condition" value={waitKind} onChange={setWaitKind} options={(Object.keys(WAIT_LABELS) as WaitKind[]).map((k) => ({ value: k, label: WAIT_LABELS[k] }))} style={{ flex: 1 }} />
          </div>
        )}
        {needsElement && (
          <div className={s.target} data-missing={locator ? undefined : 'true'}>
            <Crosshair size={13} />
            {locator ? (
              <span className={s.targetText} title={locator.css}>
                {locatorLabel(locator)}
              </span>
            ) : (
              <span className={s.targetText}>{interaction === 'interact' ? 'Switch to Inspect (I) and click an element, or pick one in Layers.' : 'Click an element on the canvas, or pick one in Layers.'}</span>
            )}
          </div>
        )}
        {needsText && (
          <div className={s.row}>
            <span className={s.k}>{tab === 'wait' && waitKind === 'url' ? 'URL' : kind === 'value' && tab === 'assert' ? 'Value' : 'Text'}</span>
            <input className={s.input} value={text} placeholder={tab === 'assert' && kind === 'value' ? (sensitive ? 'Sensitive field — choose a fixture' : 'Expected value (empty = cleared)') : 'Expected text'} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && canAdd && add()} />
          </div>
        )}
        {tab === 'assert' && kind === 'value' && secretNames.length > 0 && (
          <div className={s.fixtures}>
            <span className={s.k}>Fixture</span>
            {secretNames.map((n) => (
              <button key={n} type="button" className={s.fixture} data-on={text === secretPlaceholder(n) ? 'true' : undefined} onClick={() => setText(secretPlaceholder(n))}>
                {n}
              </button>
            ))}
          </div>
        )}
        {tab === 'assert' && kind === 'enabled' && (
          <div className={s.row}>
            <span className={s.k}>Enabled</span>
            <Switch checked={enabled} onChange={setEnabled} ariaLabel="Expect enabled" />
            <span className={s.hint}>{enabled ? 'Expect enabled' : 'Expect disabled'}</span>
          </div>
        )}
        {tab === 'wait' && waitKind === 'delay' && (
          <div className={s.row}>
            <span className={s.k}>Delay</span>
            <input className={s.input} inputMode="numeric" value={ms} onChange={(e) => setMs(e.target.value.replace(/[^\d]/g, ''))} />
            <span className={s.hint}>ms</span>
          </div>
        )}
        {tab === 'screenshot' && (
          <div className={s.row}>
            <span className={s.k}>Label</span>
            <input className={s.input} value={label} placeholder="e.g. Review step" onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          </div>
        )}
        <div className={s.foot}>
          <span className={s.hint}>{tab === 'screenshot' ? 'DOM raster of the viewport (approximate).' : tab === 'assert' ? 'Assertions retry for up to 2 s.' : ''}</span>
          <Button size="sm" variant="primary" icon={<Plus size={12} />} disabled={!canAdd} onClick={add}>
            Add
          </Button>
        </div>
      </div>
    </Popover>
  );
}
