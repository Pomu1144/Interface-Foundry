/** Small CSS helpers shared by the style inspector and patcher. */

/** Split a declaration block into [property, value, important] without breaking on ; inside () or strings. */
export function parseDeclarations(cssText: string): { property: string; value: string; important: boolean }[] {
  const out: { property: string; value: string; important: boolean }[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  const pushDecl = (raw: string) => {
    const i = raw.indexOf(':');
    if (i <= 0) return;
    const property = raw.slice(0, i).trim();
    let value = raw.slice(i + 1).trim();
    let important = false;
    const m = /\s*!\s*important\s*$/i.exec(value);
    if (m) {
      important = true;
      value = value.slice(0, m.index).trim();
    }
    if (property && value) out.push({ property: property.startsWith('--') ? property : property.toLowerCase(), value, important });
  };
  for (let i = 0; i < cssText.length; i++) {
    const ch = cssText[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      pushDecl(cssText.slice(start, i));
      start = i + 1;
    }
  }
  pushDecl(cssText.slice(start));
  return out;
}

/** Specificity of a single complex selector as [ids, classes, types]. */
export function specificity(selector: string): [number, number, number] {
  let s = selector;
  let a = 0;
  let b = 0;
  let c = 0;
  // :is()/:not()/:has() take the max specificity of their argument; :where() is zero.
  s = s.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');
  s = s.replace(/:(is|not|has|matches)\(((?:[^()]|\([^()]*\))*)\)/g, (_m, _fn, inner: string) => {
    const best = splitSelectorList(inner)
      .map(specificity)
      .sort(compareSpecificity)
      .pop() ?? [0, 0, 0];
    a += best[0];
    b += best[1];
    c += best[2];
    return '';
  });
  s = s.replace(/"[^"]*"|'[^']*'/g, '');
  // Pseudo-elements (including legacy single-colon forms) count as types; strip them first.
  const pseudoEl = /::[\w-]+(\([^)]*\))?|:(before|after|first-line|first-letter)\b/g;
  c += (s.match(pseudoEl) ?? []).length;
  s = s.replace(pseudoEl, ' ');
  a += (s.match(/#[\w-]+/g) ?? []).length;
  b += (s.match(/\.[\w-]+/g) ?? []).length;
  b += (s.match(/\[[^\]]*\]/g) ?? []).length;
  b += (s.match(/:[\w-]+(\([^)]*\))?/g) ?? []).length;
  s = s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|:[\w-]+(\([^)]*\))?/g, ' ');
  c += (s.match(/(^|[\s>+~])([a-zA-Z][\w-]*)/g) ?? []).length;
  return [a, b, c];
}

export function compareSpecificity(x: [number, number, number], y: [number, number, number]): number {
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

export function splitSelectorList(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out.filter(Boolean);
}

export const INHERITED_PROPS = new Set([
  'color',
  'cursor',
  'direction',
  'font',
  'font-family',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'font-feature-settings',
  'letter-spacing',
  'line-height',
  'list-style',
  'list-style-type',
  'list-style-position',
  'quotes',
  'text-align',
  'text-indent',
  'text-transform',
  'text-shadow',
  'visibility',
  'white-space',
  'word-break',
  'word-spacing',
  'overflow-wrap',
  'caret-color',
  'accent-color',
  'color-scheme',
  '-webkit-font-smoothing',
]);

export function isInherited(prop: string) {
  return prop.startsWith('--') || INHERITED_PROPS.has(prop);
}

/** Longhands covered by common shorthands, for override detection. */
const SHORTHANDS: Record<string, string[]> = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  inset: ['top', 'right', 'bottom', 'left'],
  border: ['border-top', 'border-right', 'border-bottom', 'border-left', 'border-width', 'border-style', 'border-color'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
  background: ['background-color', 'background-image', 'background-position', 'background-size', 'background-repeat'],
  font: ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  gap: ['row-gap', 'column-gap'],
  overflow: ['overflow-x', 'overflow-y'],
  'grid-template': ['grid-template-columns', 'grid-template-rows', 'grid-template-areas'],
};

/** All property names a declaration of `prop` sets (itself + longhands). */
export function coveredProperties(prop: string): string[] {
  return [prop, ...(SHORTHANDS[prop] ?? [])];
}

export function parsePx(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** Convert a computed rgb()/rgba() color to {r,g,b,a}. */
export function parseColor(value: string): { r: number; g: number; b: number; a: number } | null {
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
}

export function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrastRatio(fg: { r: number; g: number; b: number }, bg: { r: number; g: number; b: number }): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export function blend(top: { r: number; g: number; b: number; a: number }, bottom: { r: number; g: number; b: number }) {
  return {
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
  };
}

export const toHex = ({ r, g, b }: { r: number; g: number; b: number }) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
