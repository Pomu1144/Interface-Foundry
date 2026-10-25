import clsx from 'clsx';
import { forwardRef, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Tooltip } from './overlay';
import s from './controls.module.css';

type ButtonVariant = 'secondary' | 'ghost' | 'primary' | 'molten' | 'danger' | 'violet';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  trailing?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, trailing, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={clsx(s.button, s[variant], size !== 'md' && s[size], className)} {...rest}>
      {icon}
      {children}
      {trailing}
    </button>
  );
});

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  shortcut?: string;
  active?: boolean;
  tone?: 'accent' | 'molten' | 'violet' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  dot?: boolean;
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, active, tone = 'accent', size = 'md', dot, tooltipSide = 'bottom', className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={active === undefined ? undefined : active}
        data-active={active ? 'true' : undefined}
        data-tone={tone}
        className={clsx(s.iconButton, size === 'sm' && s.iconSm, size === 'lg' && s.iconLg, className)}
        {...rest}
      >
        {children}
        {dot && <span className={s.dot} />}
      </button>
    </Tooltip>
  );
});

export type SegmentOption<T extends string> = { value: T; label?: ReactNode; icon?: ReactNode; title?: string; disabled?: boolean };

/** macOS/Xcode-style segmented control with an animated thumb. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const btn = root.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(value)}"]`);
    if (btn) setThumb({ left: btn.offsetLeft, width: btn.offsetWidth });
  }, [value, options.length]);
  return (
    <div ref={ref} role="radiogroup" aria-label={ariaLabel} className={clsx(s.segmented, className)}>
      {thumb && <span className={s.thumb} style={{ left: thumb.left, width: thumb.width }} />}
      {options.map((o) => {
        const btn = (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            aria-label={typeof o.label === 'string' ? undefined : o.title}
            data-value={o.value}
            data-active={o.value === value ? 'true' : undefined}
            disabled={o.disabled}
            className={clsx(s.segment, !o.label && s.segmentIconOnly)}
            onClick={() => onChange(o.value)}
          >
            {o.icon}
            {o.label}
          </button>
        );
        return o.title ? (
          <Tooltip key={o.value} content={o.title}>
            {btn}
          </Tooltip>
        ) : (
          btn
        );
      })}
    </div>
  );
}

export type TabItem<T extends string> = { id: T; label: ReactNode; icon?: ReactNode; count?: number; tone?: 'danger' | 'warning' | 'accent' };

export function Tabs<T extends string>({
  value,
  items,
  onChange,
  ariaLabel,
  className,
  trailing,
}: {
  value: T;
  items: TabItem<T>[];
  onChange: (v: T) => void;
  ariaLabel: string;
  className?: string;
  trailing?: ReactNode;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={clsx(s.tabs, className)}>
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={t.id === value}
          className={s.tab}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            const i = items.findIndex((x) => x.id === value);
            if (e.key === 'ArrowRight') onChange(items[(i + 1) % items.length].id);
            if (e.key === 'ArrowLeft') onChange(items[(i - 1 + items.length) % items.length].id);
          }}
        >
          {t.icon}
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className={s.tabCount} data-tone={t.tone}>
              {t.count > 999 ? '999+' : t.count}
            </span>
          )}
        </button>
      ))}
      {trailing && <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>{trailing}</div>}
    </div>
  );
}
