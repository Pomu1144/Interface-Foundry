import {
  Camera,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  Crosshair,
  Hourglass,
  Keyboard,
  Link2,
  ListFilter,
  MousePointerClick,
  ShieldCheck,
  Smartphone,
  SquareCheck,
  TabletSmartphone,
  TextCursorInput,
} from 'lucide-react';
import { useEffect, useReducer, useState, type ComponentType, type ReactNode } from 'react';
import type { ScenarioRun, StepAction, StepResult } from '@shared/types';
import { Spinner } from '@/ui';
import { useStudio } from '@/store';
import s from './bits.module.css';

const ICONS: Record<StepAction['type'], ComponentType<{ size?: number; strokeWidth?: number }>> = {
  click: MousePointerClick,
  fill: TextCursorInput,
  press: Keyboard,
  focus: Crosshair,
  select: ListFilter,
  check: SquareCheck,
  navigate: Link2,
  viewport: Smartphone,
  fold: TabletSmartphone,
  wait: Hourglass,
  assert: ShieldCheck,
  screenshot: Camera,
};

/** Semantic tone per action family (studio steps vs. page input vs. checks). */
export function actionTone(t: StepAction['type']): 'input' | 'device' | 'check' | 'wait' | 'capture' {
  if (t === 'viewport' || t === 'fold' || t === 'navigate') return 'device';
  if (t === 'assert') return 'check';
  if (t === 'wait') return 'wait';
  if (t === 'screenshot') return 'capture';
  return 'input';
}

export function StepIcon({ type, size = 13 }: { type: StepAction['type']; size?: number }) {
  const Icon = ICONS[type];
  return (
    <span className={s.stepIcon} data-tone={actionTone(type)} style={{ width: size + 9, height: size + 9 }}>
      <Icon size={size} strokeWidth={1.9} />
    </span>
  );
}

export type Status = StepResult['status'] | ScenarioRun['status'] | 'idle' | 'current';

export function StatusGlyph({ status, size = 13 }: { status: Status; size?: number }) {
  switch (status) {
    case 'passed':
      return <CircleCheck size={size} className={s.ok} aria-label="Passed" />;
    case 'failed':
      return <CircleX size={size} className={s.bad} aria-label="Failed" />;
    case 'running':
    case 'current':
      return <Spinner size={size - 2} />;
    case 'aborted':
      return <CircleSlash size={size} className={s.muted} aria-label="Stopped" />;
    case 'skipped':
      return <CircleDashed size={size} className={s.muted} aria-label="Skipped" />;
    default:
      return <span className={s.idleDot} style={{ width: size - 4, height: size - 4 }} aria-label="Not run" />;
  }
}

function useNow(active: boolean, every = 500) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [active, every]);
  return now;
}

export const clock = (ms: number) => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

/** Red pulsing "REC" lozenge with elapsed time and step count. */
export function RecordingIndicator({ compact }: { compact?: boolean }) {
  const rec = useStudio((st) => st.recording);
  const now = useNow(rec.active);
  if (!rec.active) return null;
  return (
    <span className={s.rec} data-compact={compact ? 'true' : undefined} role="status" aria-live="polite">
      <span className={s.recDot} aria-hidden />
      <span className={s.recLabel}>REC</span>
      <span className={s.recTime}>{clock(now - (rec.startedAt ?? now))}</span>
      {!compact && (
        <span className={s.recSteps}>
          {rec.steps.length} step{rec.steps.length === 1 ? '' : 's'}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Single-owner hosts                                                  */
/* ------------------------------------------------------------------ */

const owners = new Map<string, symbol>();
const subs = new Map<string, Set<() => void>>();

/**
 * Several panels can host the same dialog; only the first mounted one renders
 * it so it never opens twice. Ownership moves when the owner unmounts.
 */
export function useHostOwner(key: string): boolean {
  const [id] = useState(() => Symbol(key));
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const set = subs.get(key) ?? new Set();
    subs.set(key, set);
    const claim = () => {
      if (!owners.get(key)) owners.set(key, id);
      force();
    };
    set.add(claim);
    if (!owners.get(key)) {
      owners.set(key, id);
      set.forEach((f) => f());
    }
    return () => {
      set.delete(claim);
      if (owners.get(key) === id) {
        owners.delete(key);
        set.forEach((f) => f());
      }
    };
  }, [id, key]);
  return owners.get(key) === id;
}

/** Empty / onboarding state with a vector glyph (no raster art). */
export function PanelEmpty({ icon: Icon, title, children, action, tone = 'accent' }: { icon: ComponentType<{ size?: number; strokeWidth?: number }>; title: ReactNode; children?: ReactNode; action?: ReactNode; tone?: 'accent' | 'danger' | 'success' }) {
  return (
    <div className={s.empty}>
      <span className={s.emptyGlyph} data-tone={tone}>
        <Icon size={20} strokeWidth={1.6} />
      </span>
      <div className={s.emptyTitle}>{title}</div>
      {children && <div className={s.emptyText}>{children}</div>}
      {action && <div className={s.emptyAction}>{action}</div>}
    </div>
  );
}
