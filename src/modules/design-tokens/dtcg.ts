import type { DesignToken, TokenType } from '@shared/types';

/**
 * Pure design-token serialization.
 *
 *  - W3C Design Tokens Community Group (DTCG) JSON import/export
 *    (`{ "color": { "brand": { "$type": "color", "$value": "#0B2545" } } }`)
 *  - CSS custom-property files
 *  - type inference for custom properties scanned from a page
 *
 * IFDY-specific metadata (token type, CSS variable, display name) travels in
 * `$extensions["com.ifdy"]` so a round trip is lossless while the file stays
 * readable by other DTCG tools (Style Dictionary, Tokens Studio, Figma).
 */

export const TOKEN_TYPES: TokenType[] = ['color', 'typography', 'spacing', 'radius', 'shadow', 'breakpoint', 'z-index', 'other'];

export const TOKEN_TYPE_LABEL: Record<TokenType, string> = {
  color: 'Color',
  typography: 'Typography',
  spacing: 'Spacing',
  radius: 'Radius',
  shadow: 'Shadow',
  breakpoint: 'Breakpoint',
  'z-index': 'Z-index',
  other: 'Other',
};

/** Default DTCG group used when a token name has no explicit path. */
const TYPE_GROUP: Record<TokenType, string> = {
  color: 'color',
  typography: 'typography',
  spacing: 'spacing',
  radius: 'radius',
  shadow: 'shadow',
  breakpoint: 'breakpoint',
  'z-index': 'zIndex',
  other: 'other',
};

export const IFDY_EXTENSION = 'com.ifdy';

let seq = 0;
export function tokenId(): string {
  return `t${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function isValidCssVar(v: string): boolean {
  return /^--[A-Za-z_][\w-]*$/.test(v);
}

/** "color.brand/primary 500" -> "--color-brand-primary-500" */
export function cssVarFromName(name: string): string {
  const body = name
    .trim()
    .replace(/^--/, '')
    .replace(/[./\s]+/g, '-')
    .replace(/[^\w-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `--${body || 'token'}`;
}

/** "--hl-color-navy" -> "hl-color-navy" */
export function nameFromCssVar(v: string): string {
  return v.replace(/^--/, '');
}

/* ------------------------------------------------------------------ */
/* Value classification                                                */
/* ------------------------------------------------------------------ */

const NAMED_COLORS = new Set(
  'black white red green blue yellow orange purple pink gray grey silver maroon olive lime aqua teal navy fuchsia transparent currentcolor rebeccapurple gold indigo violet tomato coral crimson salmon khaki beige ivory lavender plum orchid tan chocolate brown cyan magenta'.split(' '),
);

export function isColorValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(v)) return true;
  if (/^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/.test(v)) return true;
  return NAMED_COLORS.has(v);
}

export function isLengthValue(value: string): boolean {
  return /^-?\d*\.?\d+(px|rem|em|%|vw|vh|vmin|vmax|ch|ex|pt|svh|dvh|lvh|cqw|cqh)$/.test(value.trim()) || /^(calc|clamp|min|max)\(/.test(value.trim());
}

function isShadowValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === 'none') return false;
  if (/\binset\b/.test(v)) return true;
  // At least two lengths followed/preceded by a color.
  const lengths = v.match(/-?\d*\.?\d+(px|rem|em)|\b0\b/g)?.length ?? 0;
  return lengths >= 2 && /(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|color-mix\()/.test(v);
}

function isFontFamilyValue(value: string): boolean {
  const v = value.trim();
  return /,/.test(v) && /(sans-serif|serif|monospace|system-ui|ui-sans-serif|ui-monospace|cursive|"|')/i.test(v);
}

/** Infer a token type from a custom property name and its (resolved) value. */
export function inferTokenType(name: string, value: string): TokenType {
  const n = name.toLowerCase().replace(/^--/, '');
  const v = value.trim();
  if (/(^|-)(z|zindex|z-index|layer|stack)(-|$)/.test(n) && /^-?\d+$/.test(v)) return 'z-index';
  if (/(shadow|elevation)/.test(n) || isShadowValue(v)) return 'shadow';
  if (isColorValue(v) || /(^|-)(color|colour|bg|fg|fill|stroke|tint|hue)(-|$)/.test(n) && !isLengthValue(v)) return 'color';
  if (/(radius|rounded|corner|round)/.test(n)) return 'radius';
  if (/(breakpoint|(^|-)bp(-|$)|screen|viewport|(^|-)mq(-|$))/.test(n)) return 'breakpoint';
  if (/(font|family|weight|leading|line-height|lh|tracking|letter|text-size|(^|-)fs(-|$)|type|heading|body-size)/.test(n) || isFontFamilyValue(v)) return 'typography';
  if (/(space|spacing|gap|gutter|pad|padding|margin|inset|(^|-)size(-|$)|(^|-)sp(-|$)|width|height|offset)/.test(n) || isLengthValue(v)) return 'spacing';
  if (/^-?\d+$/.test(v) && /(^|-)z/.test(n)) return 'z-index';
  return 'other';
}

/* ------------------------------------------------------------------ */
/* DTCG export                                                         */
/* ------------------------------------------------------------------ */

export type DtcgToken = {
  $type?: string;
  $value: unknown;
  $description?: string;
  $extensions?: Record<string, unknown>;
};
export type DtcgGroup = { [key: string]: DtcgGroup | DtcgToken | string | undefined };

function dtcgTypeFor(t: DesignToken, value: string): string | undefined {
  switch (t.type) {
    case 'color':
      return 'color';
    case 'spacing':
    case 'radius':
    case 'breakpoint':
      return isLengthValue(value) ? 'dimension' : undefined;
    case 'z-index':
      return 'number';
    case 'shadow':
      return 'shadow';
    case 'typography':
      if (isFontFamilyValue(value) || /^["'][^"']+["']$/.test(value.trim())) return 'fontFamily';
      if (/^(\d00|normal|bold|bolder|lighter)$/.test(value.trim())) return 'fontWeight';
      if (isLengthValue(value)) return 'dimension';
      if (/^\d*\.?\d+$/.test(value.trim())) return 'number';
      return undefined;
    default:
      return undefined;
  }
}

const sanitizeKey = (k: string) => k.replace(/[{}]/g, '').replace(/^\$+/, '') || 'token';

/** Path segments under which a token is exported. */
export function exportPath(t: DesignToken): string[] {
  const parts = t.name
    .split(/[./]/)
    .map((p) => sanitizeKey(p.trim()))
    .filter(Boolean);
  if (parts.length > 1) return parts;
  return [TYPE_GROUP[t.type], parts[0] ?? sanitizeKey(nameFromCssVar(t.cssVar))];
}

function splitTopLevel(value: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let quote: string | null = null;
  for (const ch of value) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function shadowToDtcg(value: string): unknown {
  const layers = splitTopLevel(value).map((layer) => {
    const inset = /\binset\b/.test(layer);
    const rest = layer.replace(/\binset\b/, '').trim();
    const colorMatch = /(#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix|color)\([^)]*\)+|\b[a-z]+\b)\s*$/.exec(rest) ?? /^(#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\))/.exec(rest);
    const color = colorMatch ? colorMatch[1] : null;
    const lens = (color ? rest.replace(color, '') : rest).trim().split(/\s+/).filter(Boolean);
    if (!color || lens.length < 2 || lens.length > 4 || !lens.every((l) => /^-?\d*\.?\d+(px|rem|em)?$/.test(l))) return null;
    const norm = (l: string | undefined) => (l === undefined ? '0px' : /^-?\d*\.?\d+$/.test(l) ? `${l}px` : l);
    const o: Record<string, unknown> = { color, offsetX: norm(lens[0]), offsetY: norm(lens[1]), blur: norm(lens[2]), spread: norm(lens[3]) };
    if (inset) o.inset = true;
    return o;
  });
  if (layers.some((l) => l === null)) return value;
  return layers.length === 1 ? layers[0] : layers;
}

/**
 * Export tokens as a DTCG document. `values` (cssVar -> value) overrides the
 * stored values, e.g. live edits that are not yet committed to source.
 */
export function toDtcg(tokens: DesignToken[], values: Record<string, string> = {}, opts: { extensions?: boolean } = {}): DtcgGroup {
  const withExt = opts.extensions !== false;
  const byVar = new Map(tokens.map((t) => [t.cssVar, t]));
  const doc: DtcgGroup = {};
  for (const t of tokens) {
    const value = values[t.cssVar] ?? t.value;
    const path = exportPath(t);
    let group: DtcgGroup = doc;
    let ok = true;
    for (const seg of path.slice(0, -1)) {
      const existing = group[seg];
      if (existing === undefined) group[seg] = {};
      else if (typeof existing !== 'object' || '$value' in existing) {
        ok = false;
        break;
      }
      group = group[seg] as DtcgGroup;
    }
    const leaf = path[path.length - 1];
    if (!ok || (group[leaf] !== undefined)) {
      // Collision with a token/group of the same path: fall back to a flat, unique key.
      group = doc;
      let key = sanitizeKey(t.name.replace(/[./]/g, '-'));
      while (doc[key] !== undefined) key += '_';
      path.splice(0, path.length, key);
    }
    const alias = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value.trim());
    const aliased = alias ? byVar.get(alias[1]) : undefined;
    const type = dtcgTypeFor(t, aliased ? aliased.value : value);
    const token: DtcgToken = { $value: aliased ? `{${exportPath(aliased).join('.')}}` : value };
    if (type) token.$type = type;
    if (!aliased) {
      if (type === 'shadow') token.$value = shadowToDtcg(value);
      if (type === 'number' && /^-?\d*\.?\d+$/.test(value.trim())) token.$value = Number(value);
      if (type === 'fontFamily') token.$value = splitTopLevel(value).map((f) => f.replace(/^["']|["']$/g, ''));
      if (type === 'fontWeight' && /^\d+$/.test(value.trim())) token.$value = Number(value);
    }
    if (t.description) token.$description = t.description;
    if (withExt) token.$extensions = { [IFDY_EXTENSION]: { name: t.name, cssVar: t.cssVar, type: t.type, ...(token.$value !== value && !aliased ? { css: value } : {}) } };
    group[path[path.length - 1]] = token;
  }
  return doc;
}

/* ------------------------------------------------------------------ */
/* DTCG import                                                         */
/* ------------------------------------------------------------------ */

type Collected = { path: string[]; type?: string; raw: unknown; description?: string; ext?: { name?: string; cssVar?: string; type?: string; css?: string } };

/** A DTCG token (`$value`) or a legacy Style Dictionary token (`value` with no nested token groups). */
function isTokenNode(c: Record<string, unknown>): boolean {
  if ('$value' in c) return true;
  if (!('value' in c)) return false;
  return !Object.values(c).some((v) => v && typeof v === 'object' && !Array.isArray(v) && ('value' in (v as object) || '$value' in (v as object)));
}

function dimensionToCss(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && 'value' in v) {
    const o = v as { value: unknown; unit?: unknown };
    return `${o.value}${typeof o.unit === 'string' ? o.unit : ''}`;
  }
  return null;
}

function colorToCss(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as { hex?: string; colorSpace?: string; components?: (number | string)[]; alpha?: number };
    if (o.hex && (o.alpha === undefined || o.alpha === 1)) return o.hex;
    if (Array.isArray(o.components)) {
      const comps = o.components.map((c) => (c === 'none' ? 'none' : Number(c)));
      const alpha = o.alpha !== undefined && o.alpha !== 1 ? ` / ${o.alpha}` : '';
      if (!o.colorSpace || o.colorSpace === 'srgb') {
        const [r, g, b] = comps.map((c) => (typeof c === 'number' ? Math.round(c * 255) : 0));
        if (!alpha) return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
        return `rgb(${r} ${g} ${b}${alpha})`;
      }
      if (o.colorSpace === 'hsl') return `hsl(${comps[0]} ${comps[1]}% ${comps[2]}%${alpha})`;
      return `color(${o.colorSpace} ${comps.join(' ')}${alpha})`;
    }
    if (o.hex) return o.hex;
  }
  return null;
}

function shadowToCss(v: unknown): string | null {
  if (typeof v === 'string') return v;
  const layers = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  for (const l of layers) {
    if (!l || typeof l !== 'object') return null;
    const o = l as Record<string, unknown>;
    const parts = [o.inset ? 'inset' : '', dimensionToCss(o.offsetX) ?? '0', dimensionToCss(o.offsetY) ?? '0', dimensionToCss(o.blur) ?? '0', dimensionToCss(o.spread) ?? '0', colorToCss(o.color) ?? 'currentColor'];
    out.push(parts.filter(Boolean).join(' '));
  }
  return out.join(', ');
}

function typographyToCss(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const family = Array.isArray(o.fontFamily) ? o.fontFamily.map((f) => (/\s/.test(String(f)) ? `"${f}"` : String(f))).join(', ') : typeof o.fontFamily === 'string' ? o.fontFamily : 'inherit';
  const size = dimensionToCss(o.fontSize) ?? '1rem';
  const lh = o.lineHeight !== undefined ? `/${dimensionToCss(o.lineHeight)}` : '';
  const weight = o.fontWeight !== undefined ? `${o.fontWeight} ` : '';
  return `${weight}${size}${lh} ${family}`;
}

function rawToCss(dtcgType: string | undefined, raw: unknown): string | null {
  switch (dtcgType) {
    case 'color':
      return colorToCss(raw);
    case 'dimension':
    case 'duration':
      return dimensionToCss(raw);
    case 'shadow':
      return shadowToCss(raw);
    case 'typography':
      return typographyToCss(raw);
    case 'fontFamily':
      return Array.isArray(raw) ? raw.map((f) => (/[\s]/.test(String(f)) && !/^(ui-|system-)/.test(String(f)) ? `"${f}"` : String(f))).join(', ') : typeof raw === 'string' ? raw : null;
    case 'cubicBezier':
      return Array.isArray(raw) ? `cubic-bezier(${raw.join(', ')})` : typeof raw === 'string' ? raw : null;
    default:
      if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
      return colorToCss(raw) ?? dimensionToCss(raw) ?? shadowToCss(raw);
  }
}

function ourTypeFor(dtcgType: string | undefined, path: string[], value: string): TokenType {
  const name = path.join('-').toLowerCase();
  switch (dtcgType) {
    case 'color':
      return 'color';
    case 'shadow':
      return 'shadow';
    case 'fontFamily':
    case 'fontWeight':
    case 'typography':
      return 'typography';
    case 'dimension': {
      if (/(radius|rounded|corner)/.test(name)) return 'radius';
      if (/(breakpoint|screen|(^|-)bp(-|$)|viewport)/.test(name)) return 'breakpoint';
      if (/(font|text|type|size|leading|line|letter|tracking)/.test(name) && !/(space|spacing|gap)/.test(name)) return 'typography';
      return 'spacing';
    }
    case 'number':
      if (/(^|-)(z|zindex|z-index|layer|elevation)(-|$)/.test(name) || /zindex/i.test(name)) return 'z-index';
      if (/(line|leading|weight|font)/.test(name)) return 'typography';
      return 'other';
    case undefined:
      return inferTokenType(name, value);
    default:
      return 'other';
  }
}

/**
 * Import a DTCG (or legacy Style Dictionary) document. Aliases (`{color.brand}`)
 * become `var(--…)` references to the imported token's CSS variable.
 */
export function fromDtcg(input: unknown): { tokens: DesignToken[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { tokens: [], warnings: ['The file is not a DTCG token document (expected a JSON object).'] };
  const collected: Collected[] = [];
  const walk = (node: Record<string, unknown>, path: string[], inheritedType: string | undefined, depth: number) => {
    if (depth > 24) return;
    const groupType = typeof node.$type === 'string' ? node.$type : typeof node.type === 'string' && !('value' in node) ? (node.type as string) : inheritedType;
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$')) continue;
      if (!child || typeof child !== 'object' || Array.isArray(child)) continue;
      const c = child as Record<string, unknown>;
      if (isTokenNode(c)) {
        const legacy = !('$value' in c);
        const ext = (c.$extensions as Record<string, unknown> | undefined)?.[IFDY_EXTENSION] as Collected['ext'] | undefined;
        collected.push({
          path: [...path, key],
          type: (typeof c.$type === 'string' ? c.$type : legacy && typeof c.type === 'string' ? c.type : undefined) ?? groupType,
          raw: legacy ? c.value : c.$value,
          description: typeof c.$description === 'string' ? c.$description : legacy && typeof c.comment === 'string' ? c.comment : undefined,
          ext: ext && typeof ext === 'object' ? ext : undefined,
        });
      } else {
        walk(c, [...path, key], groupType, depth + 1);
      }
    }
  };
  walk(input as Record<string, unknown>, [], undefined, 0);

  // First pass: names + css variables, so aliases can resolve to them.
  const byPath = new Map<string, { cssVar: string }>();
  const usedVars = new Set<string>();
  const metas = collected.map((c) => {
    let cssVar = c.ext?.cssVar && isValidCssVar(c.ext.cssVar) ? c.ext.cssVar : cssVarFromName(c.path.join('-'));
    if (usedVars.has(cssVar)) {
      warnings.push(`Duplicate CSS variable ${cssVar} for ${c.path.join('.')} — renamed.`);
      let i = 2;
      while (usedVars.has(`${cssVar}-${i}`)) i++;
      cssVar = `${cssVar}-${i}`;
    }
    usedVars.add(cssVar);
    byPath.set(c.path.join('.'), { cssVar });
    return { c, cssVar };
  });

  const resolveAliases = (s: string) =>
    s.replace(/\{([^{}]+)\}/g, (m, ref: string) => {
      const target = byPath.get(ref.trim());
      if (!target) {
        warnings.push(`Unresolved alias ${m}.`);
        return m;
      }
      return `var(${target.cssVar})`;
    });

  const tokens: DesignToken[] = [];
  for (const { c, cssVar } of metas) {
    let value: string | null;
    if (typeof c.raw === 'string' && /^\{[^{}]+\}$/.test(c.raw.trim())) value = resolveAliases(c.raw.trim());
    else if (c.ext?.css && typeof c.ext.css === 'string') value = c.ext.css;
    else {
      value = rawToCss(c.type, c.raw);
      if (value !== null) value = resolveAliases(value);
    }
    if (value === null || value === '') {
      warnings.push(`Skipped ${c.path.join('.')}: unsupported value.`);
      continue;
    }
    const type = c.ext?.type && (TOKEN_TYPES as string[]).includes(c.ext.type) ? (c.ext.type as TokenType) : ourTypeFor(c.type, c.path, value);
    tokens.push({
      id: tokenId(),
      name: c.ext?.name ?? c.path.join('.'),
      type,
      value,
      description: c.description,
      cssVar,
    });
  }
  return { tokens, warnings };
}

/* ------------------------------------------------------------------ */
/* CSS variables file                                                  */
/* ------------------------------------------------------------------ */

export function toCssVariables(tokens: DesignToken[], values: Record<string, string> = {}, opts: { header?: string; selector?: string } = {}): string {
  const selector = opts.selector ?? ':root';
  const lines: string[] = [];
  if (opts.header) lines.push(`/* ${opts.header.replace(/\*\//g, '* /')} */`);
  lines.push(`${selector} {`);
  let first = true;
  for (const type of TOKEN_TYPES) {
    const group = tokens.filter((t) => t.type === type);
    if (!group.length) continue;
    if (!first) lines.push('');
    first = false;
    lines.push(`  /* ${TOKEN_TYPE_LABEL[type]} */`);
    for (const t of group) {
      const v = (values[t.cssVar] ?? t.value).replace(/;/g, '');
      const desc = t.description ? ` /* ${t.description.replace(/\*\//g, '* /')} */` : '';
      lines.push(`  ${t.cssVar}: ${v};${desc}`);
    }
  }
  lines.push('}');
  const bps = tokens.filter((t) => t.type === 'breakpoint');
  if (bps.length) {
    lines.push('', '/* Custom properties cannot be used inside @media conditions; breakpoint tokens are listed for reference:');
    for (const t of bps) lines.push(` *   ${t.cssVar} → @media (min-width: ${values[t.cssVar] ?? t.value})`);
    lines.push(' */');
  }
  return lines.join('\n') + '\n';
}

/** Parse "--x: value;" pairs from a pasted CSS snippet (used by the import box). */
export function parseCssVariables(css: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/(--[A-Za-z_][\w-]*)\s*:\s*([^;}]+)/g)) out.push({ name: m[1], value: m[2].trim() });
  return out;
}
