import type { NodeInfo } from '@shared/types';

/**
 * CSS-aware sizing: choose which property a canvas resize should edit so the
 * element keeps participating in its layout context, and preserve authored units.
 */
export type ResizePlan = { property: string; value: string; note?: string }[];

export function planResize(info: NodeInfo, axis: 'x' | 'y', newSizePx: number, viewportWidth: number): ResizePlan {
  const c = info.computed;
  const { layout } = info;
  const parentRow = layout.isFlexItem && (layout.flexDirection ?? 'row').startsWith('row');
  const parentCol = layout.isFlexItem && (layout.flexDirection ?? '').startsWith('column');
  const sizePx = Math.max(0, Math.round(newSizePx));
  const borderBox = c['box-sizing'] === 'border-box';
  // Content-box elements: the handle drags the border box, so subtract padding + border.
  const chrome =
    axis === 'x'
      ? info.box.padding.left + info.box.padding.right + info.box.border.left + info.box.border.right
      : info.box.padding.top + info.box.padding.bottom + info.box.border.top + info.box.border.bottom;
  const authored = Math.max(0, borderBox ? sizePx : sizePx - chrome);

  if (axis === 'x' && parentRow) {
    return [
      { property: 'flex-basis', value: `${authored}px`, note: 'Flex item on the main axis: sized with flex-basis' },
      { property: 'flex-grow', value: '0' },
    ];
  }
  if (axis === 'y' && parentCol) {
    return [
      { property: 'flex-basis', value: `${authored}px`, note: 'Flex item on the main axis: sized with flex-basis' },
      { property: 'flex-grow', value: '0' },
    ];
  }
  const prop = axis === 'x' ? 'width' : 'height';
  const current = info.computed[prop] ?? '';
  // Keep percentage widths percentage-based relative to the containing block (approximated by viewport).
  if (axis === 'x' && /%$/.test(current) && viewportWidth > 0) {
    return [{ property: prop, value: `${Math.round((authored / viewportWidth) * 1000) / 10}%` }];
  }
  return [{ property: prop, value: `${authored}px` }];
}
