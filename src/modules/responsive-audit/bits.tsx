import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { IssueSeverity, ResponsiveIssue } from '@shared/types';
import { Badge, IconButton, type Tone } from '@/ui';
import { CLASS_LABEL } from './classify';
import s from './qa.module.css';

export const SEV_LABEL: Record<IssueSeverity, string> = { critical: 'Critical', serious: 'Serious', moderate: 'Moderate', minor: 'Minor', info: 'Info' };
export const SEV_TONE: Record<IssueSeverity, Tone> = { critical: 'danger', serious: 'molten', moderate: 'warning', minor: 'info', info: 'neutral' };

/** Empty state with a vector mark (no raster art), matching EmptyState's rhythm. */
export function QaEmpty({ icon, title, children, tone = 'accent' }: { icon: ReactNode; title: ReactNode; children?: ReactNode; tone?: 'accent' | 'success' | 'violet' | 'neutral' }) {
  return (
    <div className={s.qaEmpty}>
      <span className={s.qaEmptyMark} data-tone={tone}>
        {icon}
      </span>
      <div className={s.qaEmptyTitle}>{title}</div>
      {children && <div className={s.qaEmptyText}>{children}</div>}
    </div>
  );
}

export function SevDot({ severity }: { severity: IssueSeverity }) {
  return <span className={s.sev} data-sev={severity} aria-label={SEV_LABEL[severity]} role="img" />;
}

export function SevBadge({ severity }: { severity: IssueSeverity }) {
  return <Badge tone={SEV_TONE[severity]}>{SEV_LABEL[severity]}</Badge>;
}

const CLASS_TONE: Record<ResponsiveIssue['classification'], Tone> = { regression: 'danger', suspicious: 'warning', expected: 'outline' };
const CLASS_SHORT: Record<ResponsiveIssue['classification'], string> = { regression: 'Regression', suspicious: 'Review', expected: 'Expected' };

export function ClassBadge({ c, long }: { c: ResponsiveIssue['classification']; long?: boolean }) {
  return (
    <Badge tone={CLASS_TONE[c]} title={CLASS_LABEL[c]}>
      {long ? CLASS_LABEL[c] : CLASS_SHORT[c]}
    </Badge>
  );
}

export function EvidenceChips({ evidence }: { evidence: Record<string, string | number | boolean> }) {
  const entries = Object.entries(evidence).filter(([, v]) => v !== '' && v !== undefined && v !== null);
  if (!entries.length) return <span className={s.muted}>No measurements recorded.</span>;
  return (
    <div className={s.kv}>
      {entries.map(([k, v]) => (
        <span key={k} className={s.kvItem} title={`${k}: ${String(v)}`}>
          <span className={s.kvKey}>{k}</span>
          <span className={s.kvVal}>{typeof v === 'number' ? Math.round(v * 100) / 100 : String(v)}</span>
        </span>
      ))}
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <IconButton
      size="sm"
      label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          toast.error('Clipboard is not available');
        }
      }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
    </IconButton>
  );
}

export function CodeLine({ children, copy }: { children: ReactNode; copy?: string }) {
  return (
    <div className={s.code}>
      <span>{children}</span>
      {copy && <CopyButton text={copy} label="Copy selector" />}
    </div>
  );
}

/** Width of an element, tracked with ResizeObserver (for responsive panel layouts). */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function timeAgo(ts: number | undefined | null): string {
  if (!ts) return '';
  const d = Math.round((Date.now() - ts) / 1000);
  if (d < 5) return 'just now';
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Re-render periodically so relative times stay fresh. */
export function useTick(ms = 15_000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}
