import type { NodeInfo } from '@shared/types';
import { toast } from 'sonner';

export async function copyText(text: string, message = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    toast.error('Clipboard access was denied by the browser.');
  }
}

const DEFAULTS: Record<string, string[]> = {
  'margin-top': ['0px'],
  'margin-right': ['0px'],
  'margin-bottom': ['0px'],
  'margin-left': ['0px'],
  'padding-top': ['0px'],
  'padding-right': ['0px'],
  'padding-bottom': ['0px'],
  'padding-left': ['0px'],
  'border-top-width': ['0px'],
  'border-right-width': ['0px'],
  'border-bottom-width': ['0px'],
  'border-left-width': ['0px'],
  'border-radius': ['0px'],
  'border-top-left-radius': ['0px'],
  'border-top-right-radius': ['0px'],
  'border-bottom-right-radius': ['0px'],
  'border-bottom-left-radius': ['0px'],
  'box-shadow': ['none'],
  opacity: ['1'],
  transform: ['none'],
  'background-image': ['none'],
  'background-color': ['rgba(0, 0, 0, 0)'],
  'z-index': ['auto'],
  top: ['auto'],
  left: ['auto'],
  right: ['auto'],
  bottom: ['auto'],
  filter: ['none'],
  'mix-blend-mode': ['normal'],
  'letter-spacing': ['normal'],
  'text-transform': ['none'],
  'text-decoration-line': ['none'],
  'min-width': ['auto', '0px'],
  'min-height': ['auto', '0px'],
  'max-width': ['none'],
  'max-height': ['none'],
  'flex-grow': ['0'],
  'flex-shrink': ['1'],
  'flex-basis': ['auto'],
  order: ['0'],
  gap: ['normal'],
  'row-gap': ['normal'],
  'column-gap': ['normal'],
  'grid-column': ['auto'],
  'grid-row': ['auto'],
  'align-self': ['auto'],
  'justify-self': ['auto'],
  visibility: ['visible'],
  cursor: ['auto'],
  'white-space': ['normal'],
  'text-overflow': ['clip'],
  'object-fit': ['fill'],
  'aspect-ratio': ['auto'],
  'overflow-x': ['visible'],
  'overflow-y': ['visible'],
  'font-style': ['normal'],
};

/** Human-sized CSS for the selected element: non-default computed values only. */
export function cssForInfo(info: NodeInfo): string {
  const lines: string[] = [];
  for (const [prop, value] of Object.entries(info.computed)) {
    if (!value) continue;
    if (DEFAULTS[prop]?.includes(value)) continue;
    if (/^(border-top-style|border-top-color)$/.test(prop) && info.computed['border-top-width'] === '0px') continue;
    if (/radius$/.test(prop) && prop !== 'border-radius') continue;
    if (/^grid-/.test(prop) && !info.computed.display.includes('grid')) continue;
    if (/^(flex-direction|flex-wrap|justify-content|align-items|align-content)$/.test(prop) && !/flex|grid/.test(info.computed.display)) continue;
    lines.push(`  ${prop}: ${value};`);
  }
  return `${info.selector} {\n${lines.join('\n')}\n}`;
}
