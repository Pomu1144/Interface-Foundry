import clsx from 'clsx';
import { Search } from 'lucide-react';
import { Slider as RSlider, Switch as RSwitch } from 'radix-ui';
import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import s from './fields.module.css';

/** Parse "12px" / "1.5rem" / "50%" / "auto" into number + unit. */
export function parseCssNumber(value: string): { n: number; unit: string } | null {
  const m = /^\s*(-?\d*\.?\d+)\s*([a-z%]*)\s*$/i.exec(value);
  if (!m) return null;
  return { n: parseFloat(m[1]), unit: m[2] || '' };
}

const round = (n: number, step: number) => {
  const decimals = step < 1 ? Math.min(3, String(step).split('.')[1]?.length ?? 2) : 0;
  return Number(n.toFixed(decimals));
};

/**
 * Figma-style numeric field: drag the label to scrub (Shift ×10, Alt ×0.1),
 * arrow keys to nudge, Enter/blur to commit. Keeps the authored unit.
 */
export function NumberField({
  value,
  onChange,
  onCommit,
  label,
  title,
  unit: defaultUnit = 'px',
  step = 1,
  min,
  max,
  placeholder,
  modified,
  disabled,
  className,
  allowKeywords = ['auto'],
}: {
  value: string;
  /** Live preview while scrubbing (transient). */
  onChange?: (v: string) => void;
  /** Final value (undoable). */
  onCommit: (v: string) => void;
  label?: ReactNode;
  title?: string;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  modified?: boolean;
  disabled?: boolean;
  className?: string;
  allowKeywords?: string[];
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const scrubRef = useRef<{ x: number; start: number; unit: string; moved: boolean } | null>(null);
  useEffect(() => {
    if (!focused && !scrubRef.current) setDraft(value);
  }, [value, focused]);

  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const format = (n: number, unit: string) => `${round(clamp(n), step)}${unit}`;

  const commitText = (text: string) => {
    const t = text.trim();
    if (!t) return onCommit('');
    if (allowKeywords.includes(t) || /^(calc|var|min|max|clamp)\(/.test(t)) return onCommit(t);
    const p = parseCssNumber(t);
    if (!p) {
      setDraft(value);
      return;
    }
    onCommit(format(p.n, p.unit || defaultUnit));
  };

  const parsed = parseCssNumber(draft);
  const showUnit = parsed?.unit ?? '';

  return (
    <label className={clsx(s.field, className)} data-modified={modified ? 'true' : undefined} data-disabled={disabled ? 'true' : undefined} title={title}>
      {label !== undefined && (
        <span
          className={s.scrub}
          onPointerDown={(e) => {
            const p = parseCssNumber(draft) ?? { n: 0, unit: defaultUnit };
            scrubRef.current = { x: e.clientX, start: p.n, unit: p.unit || defaultUnit, moved: false };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            document.body.style.cursor = 'ew-resize';
          }}
          onPointerMove={(e) => {
            const sc = scrubRef.current;
            if (!sc) return;
            const dx = e.clientX - sc.x;
            if (Math.abs(dx) > 1) sc.moved = true;
            const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
            const next = format(sc.start + Math.round(dx / 2) * step * k, sc.unit);
            setDraft(next);
            onChange?.(next);
          }}
          onPointerUp={(e) => {
            const sc = scrubRef.current;
            scrubRef.current = null;
            document.body.style.cursor = '';
            (e.target as HTMLElement).releasePointerCapture(e.pointerId);
            if (sc?.moved) onCommit(draft);
          }}
        >
          {label}
        </span>
      )}
      <input
        className={s.input}
        value={focused ? draft : parsed ? String(parsed.n) : draft}
        placeholder={placeholder}
        spellCheck={false}
        disabled={disabled}
        onFocus={(e) => {
          setFocused(true);
          requestAnimationFrame(() => e.target.select());
        }}
        onBlur={() => {
          setFocused(false);
          if (draft !== value) commitText(draft);
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitText(draft);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setDraft(value);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const p = parseCssNumber(draft) ?? { n: 0, unit: defaultUnit };
            const k = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
            const next = format(p.n + step * k, p.unit || defaultUnit);
            setDraft(next);
            onCommit(next);
          }
        }}
      />
      {!focused && showUnit && <span className={s.unit}>{showUnit}</span>}
    </label>
  );
}

export function TextField({
  value,
  onCommit,
  placeholder,
  mono,
  label,
  className,
  modified,
  ...rest
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  label?: ReactNode;
  className?: string;
  modified?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  return (
    <label className={clsx(s.field, className)} data-modified={modified ? 'true' : undefined}>
      {label !== undefined && <span className={s.scrub} style={{ cursor: 'default' }}>{label}</span>}
      <input
        {...rest}
        className={clsx(s.input, mono && s.mono)}
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (draft !== value) onCommit(draft);
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onCommit(draft);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setDraft(value);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
}

/** Convert any CSS color the browser understands into #rrggbb (alpha dropped). */
export function toHexColor(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(/[\s,/]+/).map(Number);
    return '#' + [r, g, b].map((v) => Math.round(v || 0).toString(16).padStart(2, '0')).join('');
  }
  if (/^#[0-9a-f]{3}$/i.test(color)) return '#' + color.slice(1).split('').map((c) => c + c).join('').toLowerCase();
  return '#000000';
}

export function ColorField({
  value,
  onChange,
  onCommit,
  modified,
  className,
}: {
  value: string;
  onChange?: (v: string) => void;
  onCommit: (v: string) => void;
  modified?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  const display = /^rgba?\(/.test(draft) ? toHexColor(draft) + (/rgba\([^)]*,\s*0?\.\d+\)/.test(draft) ? ` ${Math.round(parseFloat(draft.split(',').pop() ?? '1') * 100)}%` : '') : draft;
  return (
    <label className={clsx(s.field, className)} data-modified={modified ? 'true' : undefined}>
      <span className={s.swatch}>
        <span className={s.swatchFill} style={{ background: value }} />
        <input
          type="color"
          value={toHexColor(value)}
          onChange={(e) => {
            setDraft(e.target.value);
            onChange?.(e.target.value);
          }}
          onBlur={(e) => {
            if (e.target.value !== toHexColor(value)) onCommit(e.target.value);
          }}
          aria-label="Pick color"
        />
      </span>
      <input
        className={clsx(s.input, s.mono)}
        value={focused ? draft : display}
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (draft !== value) onCommit(draft);
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(value);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  style,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <select className={clsx(s.select, className)} style={style} aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Switch({ checked, onChange, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; ariaLabel: string }) {
  return (
    <RSwitch.Root className={s.switchRoot} checked={checked} onCheckedChange={onChange} aria-label={ariaLabel}>
      <RSwitch.Thumb className={s.switchThumb} />
    </RSwitch.Root>
  );
}

export function Slider({
  value,
  onChange,
  onCommit,
  min = 0,
  max = 1,
  step = 0.01,
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel: string;
}) {
  return (
    <RSlider.Root className={s.sliderRoot} value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} onValueCommit={(v) => onCommit?.(v[0])}>
      <RSlider.Track className={s.sliderTrack}>
        <RSlider.Range className={s.sliderRange} />
      </RSlider.Track>
      <RSlider.Thumb className={s.sliderThumb} aria-label={ariaLabel} />
    </RSlider.Root>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className={s.checkbox}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search',
  autoFocus,
  className,
  trailing,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  trailing?: ReactNode;
}) {
  return (
    <label className={clsx(s.search, className)}>
      <Search size={13} />
      <input value={value} placeholder={placeholder} autoFocus={autoFocus} spellCheck={false} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onChange('')} />
      {trailing}
    </label>
  );
}
