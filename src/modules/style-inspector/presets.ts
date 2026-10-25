import { toast } from 'sonner';
import type { NodeInfo } from '@shared/types';
import { studio, type StylePreset } from '@/store';
import { setStyles } from '@/modules/change-manager/edit';

/** Visual properties a reusable style captures (layout and geometry are excluded). */
const PRESET_PROPS = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-transform',
  'color',
  'background-color',
  'border-top-width',
  'border-top-style',
  'border-top-color',
  'border-radius',
  'box-shadow',
  'opacity',
];

const BORING: Record<string, string[]> = {
  'background-color': ['rgba(0, 0, 0, 0)'],
  'border-top-width': ['0px'],
  'border-top-style': ['none'],
  'border-radius': ['0px'],
  'box-shadow': ['none'],
  opacity: ['1'],
  'letter-spacing': ['normal'],
  'text-transform': ['none'],
  'font-style': ['normal'],
};

export function presetFromInfo(info: NodeInfo, name?: string): StylePreset {
  const declarations: StylePreset['declarations'] = [];
  for (const p of PRESET_PROPS) {
    const v = info.computed[p];
    if (!v || BORING[p]?.includes(v)) continue;
    if ((p === 'border-top-style' || p === 'border-top-color') && info.computed['border-top-width'] === '0px') continue;
    // Map single-side border longhands to the shorthand sides when applying.
    declarations.push({ property: p, value: v });
  }
  const base = info.component?.name ?? info.label;
  return { id: `style-${Date.now().toString(36)}`, name: name ?? base, declarations, source: info.selector, createdAt: Date.now() };
}

export function saveSelectionAsStyle() {
  const info = studio().selection.info;
  if (!info) return;
  const preset = presetFromInfo(info);
  studio().upsertStylePreset(preset);
  toast.success(`Saved style “${preset.name}”`, { description: `${preset.declarations.length} properties · apply it from Design → Saved styles` });
}

export function applyPreset(p: StylePreset) {
  const expanded = p.declarations.flatMap((d) => {
    if (d.property === 'border-top-width') return ['top', 'right', 'bottom', 'left'].map((side) => ({ property: `border-${side}-width`, value: d.value }));
    if (d.property === 'border-top-style') return [{ property: 'border-style', value: d.value }];
    if (d.property === 'border-top-color') return [{ property: 'border-color', value: d.value }];
    return [d];
  });
  setStyles(expanded, 'inspector');
}
