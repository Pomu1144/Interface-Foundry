/**
 * Small, tolerant CSS *source* parser used to map live edits back onto the
 * author's stylesheets. Unlike the CSSOM it keeps exact offsets for selectors,
 * blocks and declarations so edits can be spliced into the original text with
 * formatting and comments intact.
 *
 * Handles: comments, strings, url(...) with semicolons, nested @media /
 * @supports / @layer / @container / @scope blocks, CSS nesting, @font-face-like
 * declaration blocks, @keyframes, statement at-rules (@import) and broken input
 * (unterminated blocks/strings are closed at end of file).
 */

export type CssDecl = {
  property: string;
  value: string;
  important: boolean;
  /** Offset of the first character of the property. */
  start: number;
  /** Offset just after the terminating ";" (or after the value when the block ends without one). */
  end: number;
  valueStart: number;
  valueEnd: number;
  hasSemicolon: boolean;
  line: number;
};

export type CssRule = {
  type: 'rule';
  selector: string;
  /** Normalised selector for comparisons. */
  key: string;
  selectorStart: number;
  /** Offset of "{". */
  blockStart: number;
  /** Offset of "}" (text.length when unterminated). */
  blockEnd: number;
  declarations: CssDecl[];
  children: CssNode[];
  /** Ancestor @media conditions (outermost first), @container as "@container …". */
  media: string[];
  supports: string[];
  layer?: string;
  /** Selector of the enclosing style rule for nested CSS. */
  parentSelector?: string;
  /** Inside @keyframes / @font-face style blocks. */
  atBlock?: string;
  line: number;
};

export type CssAtRule = {
  type: 'at';
  name: string;
  prelude: string;
  start: number;
  blockStart: number | null;
  blockEnd: number | null;
  children: CssNode[];
  line: number;
};

export type CssNode = CssRule | CssAtRule;

export type CssSheet = {
  text: string;
  nodes: CssNode[];
  /** Every style rule in document order (including nested). */
  rules: CssRule[];
  atRules: CssAtRule[];
};

const CONDITIONAL = new Set(['media', 'supports', 'layer', 'container', 'scope', 'document', '-moz-document', 'starting-style']);
const DECLARATION_BLOCKS = new Set(['font-face', 'page', 'counter-style', 'property', 'font-palette-values', 'viewport', 'view-transition']);

export function parseCss(text: string): CssSheet {
  const rules: CssRule[] = [];
  const atRules: CssAtRule[] = [];
  const len = text.length;
  // Line starts for offset -> line lookups.
  const lineStarts = [0];
  for (let i = 0; i < len; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
  const lineAt = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  let pos = 0;
  const syntheticRules = new Set<CssRule>();

  const skipComment = (i: number) => {
    const close = text.indexOf('*/', i + 2);
    return close === -1 ? len : close + 2;
  };
  const skipString = (i: number) => {
    const q = text[i];
    let j = i + 1;
    while (j < len) {
      const ch = text[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === q || ch === '\n') return j + 1;
      j++;
    }
    return len;
  };
  const skipWsAndComments = (i: number) => {
    while (i < len) {
      const ch = text[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') i++;
      else if (ch === '/' && text[i + 1] === '*') i = skipComment(i);
      else break;
    }
    return i;
  };

  /** Scan forward to the next ";", "{" or "}" at paren depth 0. */
  const scanChunk = (i: number): { end: number; stop: ';' | '{' | '}' | 'eof' } => {
    let depth = 0;
    while (i < len) {
      const ch = text[i];
      if (ch === '/' && text[i + 1] === '*') {
        i = skipComment(i);
        continue;
      }
      if (ch === '"' || ch === "'") {
        i = skipString(i);
        continue;
      }
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '(' || ch === '[') depth++;
      else if ((ch === ')' || ch === ']') && depth > 0) depth--;
      else if (depth === 0 && (ch === ';' || ch === '{' || ch === '}')) return { end: i, stop: ch };
      else if (depth > 0 && ch === '}') {
        // Unbalanced parentheses: let the block close anyway.
        return { end: i, stop: '}' };
      }
      i++;
    }
    return { end: len, stop: 'eof' };
  };

  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

  type Ctx = { media: string[]; supports: string[]; layer?: string; parentSelector?: string; atBlock?: string; inRule: boolean };

  const parseDeclaration = (start: number, end: number, hasSemicolon: boolean): CssDecl | null => {
    const raw = text.slice(start, end);
    const colon = (() => {
      // First ":" outside comments/strings.
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch === '/' && raw[i + 1] === '*') {
          const c = raw.indexOf('*/', i + 2);
          i = c === -1 ? raw.length : c + 1;
          continue;
        }
        if (ch === ':') return i;
      }
      return -1;
    })();
    if (colon <= 0) return null;
    const property = stripComments(raw.slice(0, colon)).trim();
    if (!/^(--[\w-]*|-?[a-zA-Z][\w-]*)$/.test(property)) return null;
    let vStart = start + colon + 1;
    while (vStart < end && /\s/.test(text[vStart])) vStart++;
    let vEnd = end;
    while (vEnd > vStart && /\s/.test(text[vEnd - 1])) vEnd--;
    let value = text.slice(vStart, vEnd);
    let important = false;
    const imp = /\s*!\s*important\s*$/i.exec(value);
    if (imp) {
      important = true;
      value = value.slice(0, imp.index);
      vEnd = vStart + value.length;
    }
    return {
      property: property.startsWith('--') ? property : property.toLowerCase(),
      value: stripComments(value).trim(),
      important,
      start,
      end: hasSemicolon ? end + 1 : end,
      valueStart: vStart,
      valueEnd: vEnd,
      hasSemicolon,
      line: lineAt(start),
    };
  };

  /** Parse block contents until the matching "}" (returns offset of "}" or len). */
  const parseBlock = (ctx: Ctx, out: CssNode[], decls: CssDecl[] | null): number => {
    for (;;) {
      pos = skipWsAndComments(pos);
      if (pos >= len) return len;
      const ch = text[pos];
      if (ch === '}') return pos;
      if (ch === ';') {
        pos++;
        continue;
      }
      if (ch === '@') {
        const start = pos;
        const m = /^@([\w-]+)/.exec(text.slice(pos, pos + 64));
        const name = (m?.[1] ?? '').toLowerCase();
        const { end, stop } = scanChunk(pos + 1 + name.length);
        const prelude = stripComments(text.slice(pos + 1 + name.length, end)).trim().replace(/\s+/g, ' ');
        const at: CssAtRule = { type: 'at', name, prelude, start, blockStart: null, blockEnd: null, children: [], line: lineAt(start) };
        atRules.push(at);
        out.push(at);
        if (stop !== '{') {
          pos = stop === ';' ? end + 1 : end;
          continue;
        }
        at.blockStart = end;
        pos = end + 1;
        if (CONDITIONAL.has(name)) {
          const next: Ctx = {
            ...ctx,
            media: name === 'media' ? [...ctx.media, prelude] : name === 'container' ? [...ctx.media, `@container ${prelude}`] : ctx.media,
            supports: name === 'supports' ? [...ctx.supports, prelude] : ctx.supports,
            layer: name === 'layer' ? prelude || 'anonymous' : ctx.layer,
          };
          // Inside a style rule (nesting), conditional blocks may hold declarations directly.
          if (ctx.inRule) {
            const rule: CssRule = makeRule('&', start, end, next, true);
            const blockEnd = parseBlock({ ...next, inRule: true }, rule.children, rule.declarations);
            rule.blockEnd = blockEnd;
            at.children.push(...rule.children);
            if (rule.declarations.length) at.children.unshift(rule);
            at.blockEnd = blockEnd;
          } else {
            at.blockEnd = parseBlock({ ...next, inRule: false }, at.children, null);
          }
        } else if (DECLARATION_BLOCKS.has(name)) {
          const rule = makeRule(`@${name}${prelude ? ' ' + prelude : ''}`, start, end, ctx, false);
          rule.atBlock = name;
          const blockEnd = parseBlock({ ...ctx, inRule: true, atBlock: name, parentSelector: rule.selector }, rule.children, rule.declarations);
          rule.blockEnd = blockEnd;
          at.children.push(rule);
          at.blockEnd = blockEnd;
        } else {
          // @keyframes and unknown at-rules: children are rules (keyframe selectors).
          at.blockEnd = parseBlock({ ...ctx, inRule: false, atBlock: name }, at.children, null);
        }
        if (at.blockEnd !== null && at.blockEnd < len) pos = at.blockEnd + 1;
        else pos = len;
        continue;
      }
      const start = pos;
      const { end, stop } = scanChunk(pos);
      if (stop === '{') {
        const selector = stripComments(text.slice(start, end)).trim().replace(/\s+/g, ' ');
        const rule = makeRule(selector, start, end, ctx, false);
        pos = end + 1;
        const blockEnd = parseBlock({ ...ctx, inRule: true, parentSelector: resolveNested(selector, ctx.parentSelector) }, rule.children, rule.declarations);
        rule.blockEnd = blockEnd;
        out.push(rule);
        pos = blockEnd < len ? blockEnd + 1 : len;
        continue;
      }
      // Declaration (or garbage at top level).
      if (decls) {
        let dEnd = end;
        while (dEnd > start && /\s/.test(text[dEnd - 1])) dEnd--;
        const d = parseDeclaration(start, dEnd, stop === ';');
        if (d) {
          if (stop === ';') d.end = end + 1;
          decls.push(d);
        }
      }
      if (stop === ';') pos = end + 1;
      else pos = end; // "}" or eof handled by the loop
    }
  };

  const makeRule = (selector: string, start: number, blockStart: number, ctx: Ctx, synthetic: boolean): CssRule => {
    const full = resolveNested(selector, ctx.parentSelector);
    const rule: CssRule = {
      type: 'rule',
      selector: full,
      key: normalizeSelector(full),
      selectorStart: start,
      blockStart,
      blockEnd: len,
      declarations: [],
      children: [],
      media: ctx.media,
      supports: ctx.supports,
      layer: ctx.layer,
      parentSelector: ctx.parentSelector,
      atBlock: ctx.atBlock,
      line: lineAt(start),
    };
    if (synthetic) syntheticRules.add(rule);
    rules.push(rule);
    return rule;
  };

  const nodes: CssNode[] = [];
  while (pos < len) {
    const stop = parseBlock({ media: [], supports: [], inRule: false }, nodes, null);
    // Stray "}" at top level: skip it and keep going.
    pos = stop + 1;
  }
  const kept = rules.filter((r) => !syntheticRules.has(r) || r.declarations.length > 0);
  kept.sort((a, b) => a.selectorStart - b.selectorStart);
  return { text, nodes, rules: kept, atRules };
}

/** Resolve a nested selector against its parent ("&:hover" -> ".btn:hover", ".icon" -> ".btn .icon"). */
export function resolveNested(selector: string, parent?: string): string {
  if (!parent) return selector;
  const parents = splitList(parent);
  const own = splitList(selector);
  const out: string[] = [];
  for (const p of parents) {
    for (const s of own) {
      if (s.includes('&')) out.push(s.replace(/&/g, p));
      else out.push(`${p} ${s}`);
    }
  }
  return out.join(', ');
}

function splitList(sel: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let quote: string | null = null;
  for (const ch of sel) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Normalise a selector so that authored text and CSSOM `selectorText`
 * compare equal: whitespace, combinator spacing, quotes in attribute
 * selectors and legacy single-colon pseudo-elements.
 */
export function normalizeSelector(sel: string): string {
  return splitList(sel.replace(/\/\*[\s\S]*?\*\//g, ''))
    .map((part) =>
      part
        .replace(/\s+/g, ' ')
        .replace(/\s*([>+~])\s*/g, ' $1 ')
        .replace(/\(\s+/g, '(')
        .replace(/\s+\)/g, ')')
        .replace(/\[\s*([^\]=~|^$*\s]+)\s*([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*(i|s)?\s*\]/g, (_m, attr: string, op: string, d?: string, s?: string, b?: string, flag?: string) => `[${attr}${op}"${d ?? s ?? b ?? ''}"${flag ? ' ' + flag : ''}]`)
        .replace(/\[\s*([^\]=\s]+)\s*\]/g, '[$1]')
        .replace(/(^|[^:]):(before|after|first-line|first-letter)\b/g, '$1::$2')
        .replace(/\s*,\s*/g, ', ')
        .trim(),
    )
    .join(', ');
}

export function normalizeMedia(m: string): string {
  return m
    .toLowerCase()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, '')
    .replace(/^@media/, '');
}

export function sameMedia(a: string[] | undefined, b: string[] | undefined): boolean {
  const x = (a ?? []).map(normalizeMedia).filter(Boolean);
  const y = (b ?? []).map(normalizeMedia).filter(Boolean);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** Find style rules by selector and media (exact media list match). */
export function findRules(sheet: CssSheet, selector: string, media?: string[]): CssRule[] {
  const key = normalizeSelector(selector);
  return sheet.rules.filter((r) => !r.atBlock && r.key === key && sameMedia(r.media, media));
}

/* ------------------------------------------------------------------ */
/* Text edits                                                          */
/* ------------------------------------------------------------------ */

export type TextEdit = { start: number; end: number; text: string };

export function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function lineStartOf(text: string, offset: number) {
  const i = text.lastIndexOf('\n', offset - 1);
  return i + 1;
}

function indentOfLine(text: string, offset: number): string {
  const start = lineStartOf(text, offset);
  return /^[ \t]*/.exec(text.slice(start))?.[0] ?? '';
}

/** Indentation unit used by the file (two spaces by default). */
export function indentUnit(text: string): string {
  const m = /\n([ \t]+)\S/.exec(text);
  if (!m) return '  ';
  if (m[1].startsWith('\t')) return '\t';
  const sizes = [...text.matchAll(/\n( +)\S/g)].map((x) => x[1].length).filter((n) => n > 0);
  const min = Math.min(...sizes, 8);
  return ' '.repeat(min >= 2 && min <= 8 ? min : 2);
}

/** Replace a declaration's value (keeping its !important flag). */
export function editDeclaration(text: string, d: CssDecl, value: string, opts: { important?: boolean } = {}): TextEdit {
  const important = opts.important ?? d.important;
  const declText = `${d.property}: ${value}${important ? ' !important' : ''}${d.hasSemicolon ? ';' : ''}`;
  return { start: d.start, end: d.end, text: declText };
}

/** Disable a declaration by commenting it out (CSSOM "disable" semantics). */
export function disableDeclaration(text: string, d: CssDecl): TextEdit {
  const original = text.slice(d.start, d.end).replace(/\*\//g, '* /');
  const withSemi = d.hasSemicolon ? original : `${original};`;
  return { start: d.start, end: d.end, text: `/* ${withSemi} */` };
}

/** Insert a new declaration at the end of a rule block, matching its formatting. */
export function insertDeclaration(text: string, rule: CssRule, property: string, value: string, important = false): TextEdit {
  return insertDeclarations(text, rule, [[property, value, important]]);
}

/** Insert several declarations at the end of a rule block as one edit. */
export function insertDeclarations(text: string, rule: CssRule, decls: [string, string, boolean?][]): TextEdit {
  const texts = decls.map(([p, v, imp]) => `${p}: ${v}${imp ? ' !important' : ''};`);
  const last = rule.declarations[rule.declarations.length - 1];
  const close = Math.min(rule.blockEnd, text.length);
  const inner = text.slice(rule.blockStart + 1, close);
  const multiline = inner.includes('\n');
  const eol = eolOf(text);
  if (multiline) {
    const indent = last ? indentOfLine(text, last.start) : indentOfLine(text, rule.selectorStart) + indentUnit(text);
    const lines = texts.map((t) => `${indent}${t}${eol}`).join('');
    const closeLineStart = lineStartOf(text, close);
    // "}" on its own line: insert the new lines just before it.
    if (/^[ \t]*$/.test(text.slice(closeLineStart, close))) {
      if (last && !last.hasSemicolon && last.end <= closeLineStart) {
        return { start: last.end, end: closeLineStart, text: `;${text.slice(last.end, closeLineStart)}${lines}` };
      }
      return { start: closeLineStart, end: closeLineStart, text: lines };
    }
    const semi = last && !last.hasSemicolon ? ';' : '';
    const at = last ? last.end : rule.blockStart + 1;
    return { start: at, end: at, text: `${semi}${texts.map((t) => `${eol}${indent}${t}`).join('')}` };
  }
  // Single-line rule: "a { color: red }" -> "a { color: red; prop: value; }"
  let at = close;
  while (at > rule.blockStart + 1 && /[ \t]/.test(text[at - 1])) at--;
  const semi = last && !last.hasSemicolon ? ';' : '';
  const spaceAfter = close > at ? '' : ' ';
  return { start: at, end: at, text: `${semi} ${texts.join(' ')}${spaceAfter}` };
}

/** Apply non-overlapping edits (sorted by position; inserts at the same offset keep order). */
export function applyEdits(text: string, edits: TextEdit[]): string {
  const sorted = edits.map((e, i) => ({ ...e, i })).sort((a, b) => a.start - b.start || a.i - b.i);
  let out = '';
  let cursor = 0;
  for (const e of sorted) {
    if (e.start < cursor) throw new Error('Overlapping edits');
    out += text.slice(cursor, e.start) + e.text;
    cursor = e.end;
  }
  return out + text.slice(cursor);
}

/** Text of a new rule block (optionally wrapped in @media). */
export function ruleBlock(selector: string, decls: [string, string][], opts: { media?: string; indent?: string; eol?: string; important?: boolean } = {}): string {
  const unit = opts.indent ?? '  ';
  const eol = opts.eol ?? '\n';
  const bang = opts.important ? ' !important' : '';
  if (opts.media) {
    const body = decls.map(([p, v]) => `${unit}${unit}${p}: ${v}${bang};`).join(eol);
    return `@media ${opts.media} {${eol}${unit}${selector} {${eol}${body}${eol}${unit}}${eol}}`;
  }
  const body = decls.map(([p, v]) => `${unit}${p}: ${v}${bang};`).join(eol);
  return `${selector} {${eol}${body}${eol}}`;
}

/** Offset at the end of the file for appending a block (adds separating blank line). */
export function appendEdit(text: string, block: string): TextEdit {
  const eol = eolOf(text);
  let lead = '';
  if (text.length) {
    if (!text.endsWith('\n')) lead = eol + eol;
    else if (!text.endsWith('\n\n') && !text.endsWith('\r\n\r\n')) lead = eol;
  }
  return { start: text.length, end: text.length, text: `${lead}${block}${eol}` };
}

/** Insert a rule at the end of an existing @media block. */
export function insertIntoAtRule(text: string, at: CssAtRule, block: string): TextEdit | null {
  if (at.blockEnd === null || at.blockStart === null) return null;
  const eol = eolOf(text);
  const unit = indentUnit(text);
  const close = at.blockEnd;
  const indented = block
    .split(/\r?\n/)
    .map((l) => (l ? unit + l : l))
    .join(eol);
  const closeLineStart = lineStartOf(text, close);
  if (/^[ \t]*$/.test(text.slice(closeLineStart, close))) {
    return { start: closeLineStart, end: closeLineStart, text: `${eol}${indented}${eol}` };
  }
  return { start: close, end: close, text: `${eol}${indented}${eol}` };
}

/** 1-based line for an offset. */
export function lineOfOffset(text: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}
