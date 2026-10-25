import clsx from 'clsx';
import { AlertTriangle, ChevronDown, Info, OctagonAlert, Sparkles } from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import s from './layout.module.css';

export function PanelHeader({ title, subtitle, actions, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={clsx(s.panelHeader, className)}>
      <div className={s.panelTitle}>
        {title}
        {subtitle && <span className={s.panelSubtitle}>{subtitle}</span>}
      </div>
      {actions}
    </div>
  );
}

export function Section({
  title,
  actions,
  children,
  defaultOpen = true,
  id,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(() => {
    if (!id) return defaultOpen;
    try {
      const v = localStorage.getItem(`ifdy.section.${id}`);
      return v === null ? defaultOpen : v === '1';
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () => {
    setOpen((o) => {
      if (id) {
        try {
          localStorage.setItem(`ifdy.section.${id}`, o ? '0' : '1');
        } catch {
          /* ignore */
        }
      }
      return !o;
    });
  };
  return (
    <section className={s.section}>
      <div className={s.sectionHeader}>
        <button className={s.sectionToggle} aria-expanded={open} onClick={toggle}>
          <ChevronDown size={12} className={s.chevron} />
          {title}
        </button>
        {actions && <div className={s.sectionActions}>{actions}</div>}
      </div>
      {open && <div className={s.sectionBody}>{children}</div>}
    </section>
  );
}

export function Row({ label, children, title }: { label: ReactNode; children: ReactNode; title?: string }) {
  return (
    <div className={s.row}>
      <span className={s.rowLabel} title={title ?? (typeof label === 'string' ? label : undefined)}>
        {label}
      </span>
      {children}
    </div>
  );
}

export function Grid({ cols = 2, children, style }: { cols?: 2 | 3; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className={cols === 2 ? s.grid2 : s.grid3} style={style}>
      {children}
    </div>
  );
}

export type Tone = 'neutral' | 'accent' | 'molten' | 'success' | 'warning' | 'danger' | 'violet' | 'info' | 'outline';

export function Badge({ children, tone = 'neutral', title, style }: { children: ReactNode; tone?: Tone; title?: string; style?: CSSProperties }) {
  return (
    <span className={s.badge} data-tone={tone} title={title} style={style}>
      {children}
    </span>
  );
}

export function Spinner({ size = 12 }: { size?: number }) {
  return <span className={s.spinner} style={{ width: size, height: size }} aria-hidden />;
}

export function EmptyState({ art, title, children, action }: { art?: string; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.empty}>
      {art && <img className={s.emptyArt} src={art} alt="" draggable={false} />}
      <div className={s.emptyTitle}>{title}</div>
      {children && <div className={s.emptyText}>{children}</div>}
      {action}
    </div>
  );
}

export function Notice({ tone = 'info', children, icon }: { tone?: 'info' | 'warning' | 'danger' | 'violet'; children: ReactNode; icon?: ReactNode }) {
  const Icon = tone === 'warning' ? AlertTriangle : tone === 'danger' ? OctagonAlert : tone === 'violet' ? Sparkles : Info;
  return (
    <div className={s.notice} data-tone={tone}>
      {icon ?? <Icon size={14} />}
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export function ScrollArea({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={clsx(s.scroll, className)} style={style}>
      {children}
    </div>
  );
}

export function Divider({ vertical }: { vertical?: boolean }) {
  return <div className={vertical ? s.vdivider : s.divider} />;
}
