import type { ReactNode } from 'react';
import { ColorField, NumberField, Select } from '@/ui';
import { useStudio } from '@/store';
import { cancelPreview, previewStyle, setStyle } from '@/modules/change-manager/edit';
import { useEdited } from './hooks';

/** Numeric CSS property bound to the selection, with live scrubbing and undoable commit. */
export function StyleNumber({
  property,
  label,
  title,
  step = 1,
  min,
  unit = 'px',
  keywords,
  value,
}: {
  property: string;
  label?: ReactNode;
  title?: string;
  step?: number;
  min?: number;
  unit?: string;
  keywords?: string[];
  value?: string;
}) {
  const computed = useStudio((st) => st.selection.info?.computed[property] ?? '');
  const edited = useEdited(property);
  return (
    <NumberField
      label={label}
      title={title ?? property}
      value={value ?? computed}
      step={step}
      min={min}
      unit={unit}
      allowKeywords={keywords ?? ['auto', 'none', 'normal', 'fit-content', 'max-content', 'min-content', 'inherit', 'initial', 'unset']}
      modified={edited}
      onChange={(v) => previewStyle(property, v)}
      onCommit={(v) => {
        cancelPreview();
        if (v && v !== computed) setStyle(property, v);
      }}
    />
  );
}

export function StyleColor({ property }: { property: string }) {
  const computed = useStudio((st) => st.selection.info?.computed[property] ?? '');
  const edited = useEdited(property);
  return (
    <ColorField
      value={computed}
      modified={edited}
      onChange={(v) => previewStyle(property, v)}
      onCommit={(v) => {
        cancelPreview();
        if (v && v !== computed) setStyle(property, v);
      }}
    />
  );
}

export function StyleSelect({ property, options, ariaLabel }: { property: string; options: (string | { value: string; label: string })[]; ariaLabel?: string }) {
  const computed = useStudio((st) => st.selection.info?.computed[property] ?? '');
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  if (computed && !opts.some((o) => o.value === computed)) opts.unshift({ value: computed, label: computed });
  return <Select ariaLabel={ariaLabel ?? property} value={computed} options={opts} onChange={(v) => setStyle(property, v)} style={{ width: '100%' }} />;
}
