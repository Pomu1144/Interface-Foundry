import type { ComponentType, ReactNode } from 'react';
import s from './export.module.css';

/**
 * Vector empty / unavailable state used by the tokens, assets, components,
 * files, export and git views: a lucide mark in a quiet tile, a title, a
 * sentence of guidance and an optional action.
 */
export function EmptyPanel({
  icon: Icon,
  title,
  children,
  action,
  tone = 'neutral',
  compact,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  tone?: 'neutral' | 'accent' | 'warning' | 'danger' | 'molten';
  compact?: boolean;
}) {
  return (
    <div className={s.empty} data-compact={compact ? 'true' : undefined}>
      <span className={s.emptyMark} data-tone={tone}>
        <Icon size={compact ? 16 : 20} strokeWidth={1.6} />
      </span>
      <div className={s.emptyTitle}>{title}</div>
      {children && <div className={s.emptyText}>{children}</div>}
      {action && <div className={s.emptyAction}>{action}</div>}
    </div>
  );
}
