import type {
  BoxModel,
  CssDeclaration,
  Insets,
  LayoutContext,
  MatchedRule,
  NodeId,
  StylesPayload,
} from '@shared/types';
import type { BreakpointInfo } from '@shared/protocol';
import { compareSpecificity, coveredProperties, isInherited, parseDeclarations, parsePx, specificity, splitSelectorList } from './css-utils';
import { elementOf, idOf, isIfdyNode, labelFor } from './nodes';
import { appliedCssomPatch } from './patches';

/* ------------------------------------------------------------------ */
/* Stylesheet traversal                                                */
/* ------------------------------------------------------------------ */

type RuleVisit = {
  rule: CSSStyleRule;
  key: string;
  sheetIndex: number;
  sheet: CSSStyleSheet;
  media: string[];
  layer?: string;
  order: number;
  conditionsMatch: boolean;
};

function allSheets(): CSSStyleSheet[] {
  const sheets = [...document.styleSheets];
  const adopted = (document as Document & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [];
  return [...sheets, ...adopted];
}

function sheetRules(sheet: CSSStyleSheet): CSSRuleList | null {
  try {
    return sheet.cssRules;
  } catch {
    return null;
  }
}

function isOverrideSheet(sheet: CSSStyleSheet) {
  const owner = sheet.ownerNode as Element | null;
  return Boolean(owner && owner.nodeType === 1 && isIfdyNode(owner));
}

/** Walk every accessible style rule in document order. */
export function walkRules(visit: (v: RuleVisit) => void): { inaccessible: string[] } {
  const inaccessible: string[] = [];
  let order = 0;
  allSheets().forEach((sheet, sheetIndex) => {
    if (sheet.disabled) return;
    const rules = sheetRules(sheet);
    if (!rules) {
      inaccessible.push(sheet.href ?? `inline sheet ${sheetIndex}`);
      return;
    }
    const sheetMedia = sheet.media?.mediaText ? [sheet.media.mediaText] : [];
    const recurse = (list: CSSRuleList, path: number[], media: string[], layer: string | undefined, conditionsMatch: boolean) => {
      for (let i = 0; i < list.length; i++) {
        const rule = list[i];
        const p = [...path, i];
        if (rule instanceof CSSStyleRule) {
          visit({ rule, key: `${sheetIndex}:${p.join('.')}`, sheetIndex, sheet, media, layer, order: order++, conditionsMatch });
          if (rule.cssRules?.length) recurse(rule.cssRules, p, media, layer, conditionsMatch);
        } else if (rule instanceof CSSMediaRule) {
          const text = rule.conditionText || rule.media.mediaText;
          recurse(rule.cssRules, p, [...media, text], layer, conditionsMatch && matchMediaSafe(text));
        } else if (typeof CSSSupportsRule !== 'undefined' && rule instanceof CSSSupportsRule) {
          recurse(rule.cssRules, p, media, layer, conditionsMatch && supportsSafe(rule.conditionText));
        } else if (typeof CSSLayerBlockRule !== 'undefined' && rule instanceof CSSLayerBlockRule) {
          recurse(rule.cssRules, p, media, rule.name || 'anonymous', conditionsMatch);
        } else if (typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule) {
          recurse(rule.cssRules, p, [...media, `@container ${rule.conditionText}`], layer, conditionsMatch);
        } else if (rule instanceof CSSImportRule && rule.styleSheet) {
          const nested = sheetRules(rule.styleSheet);
          if (nested) recurse(nested, p, rule.media.mediaText ? [...media, rule.media.mediaText] : media, layer, conditionsMatch && (!rule.media.mediaText || matchMediaSafe(rule.media.mediaText)));
        }
      }
    };
    recurse(rules, [], sheetMedia, undefined, !sheetMedia.length || matchMediaSafe(sheetMedia[0]));
  });
  return { inaccessible };
}

function matchMediaSafe(q: string) {
  try {
    return window.matchMedia(q).matches;
  } catch {
    return false;
  }
}

function supportsSafe(q: string) {
  try {
    return CSS.supports(q);
  } catch {
    return false;
  }
}

/** Find a style rule by its key, verifying the selector; falls back to a selector search. */
export function findRule(key: string, selector: string): CSSStyleRule | null {
  let found: CSSStyleRule | null = null;
  let bySelector: CSSStyleRule | null = null;
  walkRules((v) => {
    if (found) return;
    if (v.key === key && v.rule.selectorText === selector) found = v.rule;
    else if (!bySelector && v.rule.selectorText === selector) bySelector = v.rule;
  });
  return found ?? bySelector;
}

/* ------------------------------------------------------------------ */
/* Source labels and approximate line numbers                          */
/* ------------------------------------------------------------------ */

const sheetText = new Map<string, string | null>();

function sourceLabel(sheet: CSSStyleSheet, sheetIndex: number): { href?: string; label: string; ownerNode?: string } {
  if (sheet.href) {
    const u = new URL(sheet.href, location.href);
    return { href: sheet.href, label: u.pathname.split('/').filter(Boolean).pop() ?? sheet.href };
  }
  const owner = sheet.ownerNode as Element | null;
  if (owner) return { label: `<style> #${sheetIndex}`, ownerNode: owner.tagName.toLowerCase() };
  return { label: `constructed sheet #${sheetIndex}` };
}

async function loadSheetText(href: string) {
  if (sheetText.has(href)) return sheetText.get(href);
  sheetText.set(href, null);
  try {
    const r = await fetch(href, { cache: 'force-cache' });
    if (r.ok) sheetText.set(href, await r.text());
  } catch {
    /* ignore */
  }
  return sheetText.get(href) ?? null;
}

function lineOf(text: string | null | undefined, selector: string): number | undefined {
  if (!text) return undefined;
  const first = splitSelectorList(selector)[0];
  if (!first) return undefined;
  const pattern = first
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s*');
  try {
    const re = new RegExp(`(^|[\\s},;/])${pattern}\\s*[,{]`, 'm');
    const m = re.exec(text);
    if (!m) return undefined;
    return text.slice(0, m.index + m[1].length).split('\n').length;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Matched rules / cascade                                             */
/* ------------------------------------------------------------------ */

function declarationsOf(style: CSSStyleDeclaration): CssDeclaration[] {
  return parseDeclarations(style.cssText).map((d) => ({ ...d, overridden: false }));
}

function rulesFor(el: Element, opts: { inheritedOnly: boolean }): { rules: MatchedRule[]; inaccessible: string[] } {
  const rules: MatchedRule[] = [];
  const pending: { v: RuleVisit; spec: [number, number, number] }[] = [];
  const { inaccessible } = walkRules((v) => {
    if (!v.conditionsMatch) return;
    let best: [number, number, number] | null = null;
    for (const sel of splitSelectorList(v.rule.selectorText)) {
      try {
        if (el.matches(sel)) {
          const s = specificity(sel);
          if (!best || compareSpecificity(s, best) > 0) best = s;
        }
      } catch {
        /* unsupported selector */
      }
    }
    if (best) pending.push({ v, spec: best });
  });
  for (const { v, spec } of pending) {
    let decls = declarationsOf(v.rule.style);
    if (opts.inheritedOnly) decls = decls.filter((d) => isInherited(d.property));
    const patch = appliedCssomPatch(v.key);
    if (patch) {
      for (const d of decls) if (patch.has(d.property)) d.modified = true;
      for (const [prop, value] of patch) {
        if (value === null) decls.push({ property: prop, value: patch.originalValue(prop) ?? '', important: false, overridden: true, disabled: true });
      }
    }
    if (!decls.length) continue;
    const override = isOverrideSheet(v.sheet);
    rules.push({
      key: v.key,
      selector: v.rule.selectorText,
      origin: override ? 'override' : 'author',
      media: v.media.length ? v.media : undefined,
      layer: v.layer,
      specificity: spec,
      source: { ...sourceLabel(v.sheet, v.sheetIndex), sheetIndex: v.sheetIndex },
      declarations: decls,
      order: v.order,
    });
  }
  return { rules, inaccessible };
}

/** Mark overridden declarations: !important > override sheet > inline > specificity > order. */
function computeCascade(inline: MatchedRule | null, matched: MatchedRule[]) {
  const ordered = [...matched].sort((a, b) => compareSpecificity(b.specificity, a.specificity) || b.order - a.order);
  const all = inline ? [inline, ...ordered] : ordered;
  const rank = (r: MatchedRule, d: CssDeclaration) => (d.important ? 4 : 0) + (r.origin === 'override' ? 2 : 0) + (r.origin === 'inline' ? 1 : 0);
  const winners = new Map<string, { rank: number }>();
  // Highest-ranked first; within same rank, `all` is already ordered by priority.
  const flat: { r: MatchedRule; d: CssDeclaration; rank: number; idx: number }[] = [];
  all.forEach((r, ri) => r.declarations.forEach((d) => !d.disabled && flat.push({ r, d, rank: rank(r, d), idx: ri })));
  flat.sort((a, b) => b.rank - a.rank || a.idx - b.idx);
  for (const item of flat) {
    const covered = coveredProperties(item.d.property);
    const taken = covered.every((p) => winners.has(p));
    if (taken) {
      item.d.overridden = true;
      continue;
    }
    for (const p of covered) if (!winners.has(p)) winners.set(p, { rank: item.rank });
  }
}

export async function stylesFor(id: NodeId): Promise<StylesPayload | null> {
  const el = elementOf(id);
  if (!el) return null;
  const { rules: matched, inaccessible } = rulesFor(el, { inheritedOnly: false });
  const inlineStyle = (el as HTMLElement).style;
  const inline: MatchedRule | null =
    inlineStyle && inlineStyle.length
      ? {
          key: 'inline',
          selector: 'element.style',
          origin: 'inline',
          specificity: [1, 0, 0],
          source: { label: 'inline', sheetIndex: -1 },
          declarations: declarationsOf(inlineStyle),
          order: Number.MAX_SAFE_INTEGER,
        }
      : null;
  computeCascade(inline, matched);

  // Approximate line numbers for linked sheets.
  await Promise.all(
    matched.map(async (r) => {
      if (r.source.href) r.source.line = lineOf(await loadSheetText(r.source.href), r.selector);
    }),
  );

  const inherited: StylesPayload['inherited'] = [];
  let parent = el.parentElement;
  let hops = 0;
  while (parent && hops < 8) {
    const { rules } = rulesFor(parent, { inheritedOnly: true });
    if (rules.length) {
      computeCascade(null, rules);
      inherited.push({ from: { id: idOf(parent), label: labelFor(parent) }, rules: rules.sort((a, b) => compareSpecificity(b.specificity, a.specificity) || b.order - a.order) });
    }
    parent = parent.parentElement;
    hops++;
  }

  // Custom properties referenced or defined by matched rules.
  const varNames = new Set<string>();
  for (const r of [...matched, ...(inline ? [inline] : [])]) {
    for (const d of r.declarations) {
      if (d.property.startsWith('--')) varNames.add(d.property);
      for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) varNames.add(m[1]);
    }
  }
  const cs = getComputedStyle(el);
  const variables = [...varNames].map((name) => ({
    name,
    value: cs.getPropertyValue(name).trim(),
    definedOn: definingElementLabel(el, name),
  }));

  const activeMedia = new Set<string>();
  walkRules((v) => {
    if (v.conditionsMatch) v.media.forEach((m) => activeMedia.add(m));
  });

  return {
    nodeId: id,
    inline,
    matched: matched.sort((a, b) => compareSpecificity(b.specificity, a.specificity) || b.order - a.order),
    inherited,
    variables,
    activeMedia: [...activeMedia],
    inaccessibleSheets: inaccessible,
  };
}

function definingElementLabel(el: Element, name: string): string {
  let cur: Element | null = el;
  while (cur) {
    const own = (cur as HTMLElement).style?.getPropertyValue(name);
    if (own) return labelFor(cur);
    cur = cur.parentElement;
  }
  return ':root';
}

/* ------------------------------------------------------------------ */
/* Computed styles & box model                                         */
/* ------------------------------------------------------------------ */

export function computedFor(id: NodeId): Record<string, string> | null {
  const el = elementOf(id);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const out: Record<string, string> = {};
  for (let i = 0; i < cs.length; i++) {
    const p = cs.item(i);
    out[p] = cs.getPropertyValue(p);
  }
  return out;
}

export const CURATED_PROPS = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'box-sizing',
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-top-color', 'border-radius',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content', 'align-self', 'justify-self',
  'flex-grow', 'flex-shrink', 'flex-basis', 'order', 'gap', 'row-gap', 'column-gap',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'grid-auto-flow',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align',
  'text-transform', 'text-decoration-line', 'white-space', 'text-overflow', 'color',
  'background-color', 'background-image', 'opacity', 'box-shadow', 'overflow-x', 'overflow-y',
  'visibility', 'transform', 'object-fit', 'cursor', 'mix-blend-mode', 'filter', 'aspect-ratio',
];

export function curatedComputed(el: Element): Record<string, string> {
  const cs = getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const p of CURATED_PROPS) out[p] = cs.getPropertyValue(p);
  return out;
}

const insets = (cs: CSSStyleDeclaration, prefix: string, suffix = ''): Insets => ({
  top: parsePx(cs.getPropertyValue(`${prefix}-top${suffix}`)),
  right: parsePx(cs.getPropertyValue(`${prefix}-right${suffix}`)),
  bottom: parsePx(cs.getPropertyValue(`${prefix}-bottom${suffix}`)),
  left: parsePx(cs.getPropertyValue(`${prefix}-left${suffix}`)),
});

export function boxFor(el: Element): BoxModel {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const padding = insets(cs, 'padding');
  const border = insets(cs, 'border', '-width');
  const margin = insets(cs, 'margin');
  const auto = (v: string) => (v === 'auto' ? NaN : parsePx(v));
  return {
    content: {
      x: r.x + border.left + padding.left,
      y: r.y + border.top + padding.top,
      width: Math.max(0, r.width - border.left - border.right - padding.left - padding.right),
      height: Math.max(0, r.height - border.top - border.bottom - padding.top - padding.bottom),
    },
    padding,
    border,
    margin,
    borderBox: { x: r.x, y: r.y, width: r.width, height: r.height },
    boxSizing: cs.boxSizing,
    position: cs.position,
    offsets: { top: auto(cs.top), right: auto(cs.right), bottom: auto(cs.bottom), left: auto(cs.left) },
  };
}

export function layoutFor(el: Element): LayoutContext {
  const cs = getComputedStyle(el);
  const parent = el.parentElement;
  const pcs = parent ? getComputedStyle(parent) : null;
  const pd = pcs?.display ?? '';
  const overflowAncestors: LayoutContext['overflowAncestors'] = [];
  let cur = el.parentElement;
  while (cur && cur !== document.documentElement) {
    const c = getComputedStyle(cur);
    if (c.overflowX !== 'visible' || c.overflowY !== 'visible') {
      overflowAncestors.push({ id: idOf(cur), label: labelFor(cur), overflow: `${c.overflowX} / ${c.overflowY}` });
    }
    cur = cur.parentElement;
  }
  return {
    display: cs.display,
    parentDisplay: pd || undefined,
    flexDirection: pd.includes('flex') ? pcs!.flexDirection : cs.display.includes('flex') ? cs.flexDirection : undefined,
    isFlexItem: pd.includes('flex'),
    isGridItem: pd.includes('grid'),
    isPositioned: cs.position !== 'static',
    overflowAncestors: overflowAncestors.slice(0, 6),
  };
}

/* ------------------------------------------------------------------ */
/* Breakpoints & tokens                                                */
/* ------------------------------------------------------------------ */

export function breakpoints(): BreakpointInfo[] {
  const map = new Map<string, BreakpointInfo>();
  walkRules((v) => {
    for (const q of v.media) {
      if (q.startsWith('@container')) continue;
      const existing = map.get(q);
      if (existing) {
        existing.count++;
        continue;
      }
      const min = /min-width:\s*([\d.]+)(px|em|rem)/.exec(q);
      const max = /max-width:\s*([\d.]+)(px|em|rem)/.exec(q);
      const toPx = (m: RegExpExecArray | null) => (m ? parseFloat(m[1]) * (m[2] === 'px' ? 1 : 16) : undefined);
      const range = /(\d+(?:\.\d+)?)px\s*<=?\s*width\s*<=?\s*(\d+(?:\.\d+)?)px/.exec(q);
      map.set(q, {
        query: q,
        min: range ? parseFloat(range[1]) : toPx(min) ?? (/width\s*>=?\s*(\d+)/.exec(q) ? parseFloat(/width\s*>=?\s*(\d+)/.exec(q)![1]) : undefined),
        max: range ? parseFloat(range[2]) : toPx(max) ?? (/width\s*<=?\s*(\d+)/.exec(q) ? parseFloat(/width\s*<=?\s*(\d+)/.exec(q)![1]) : undefined),
        count: 1,
      });
    }
  });
  return [...map.values()].sort((a, b) => (a.min ?? a.max ?? 0) - (b.min ?? b.max ?? 0));
}

export function scanTokens(): { name: string; value: string; usage: number }[] {
  const names = new Map<string, number>();
  const usage = new Map<string, number>();
  walkRules((v) => {
    const sel = v.rule.selectorText;
    const decls = parseDeclarations(v.rule.style.cssText);
    for (const d of decls) {
      if (d.property.startsWith('--') && /(^|,)\s*(:root|html)\s*($|,)/.test(sel)) names.set(d.property, 1);
      for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) usage.set(m[1], (usage.get(m[1]) ?? 0) + 1);
    }
  });
  const rootStyle = document.documentElement.style;
  for (let i = 0; i < rootStyle.length; i++) {
    const p = rootStyle.item(i);
    if (p.startsWith('--')) names.set(p, 1);
  }
  const cs = getComputedStyle(document.documentElement);
  return [...names.keys()].map((name) => ({ name, value: cs.getPropertyValue(name).trim(), usage: usage.get(name) ?? 0 }));
}
