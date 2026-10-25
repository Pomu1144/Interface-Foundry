import { HighlightStyle } from '@codemirror/language';
import { cssLanguage } from '@codemirror/lang-css';
import { htmlLanguage } from '@codemirror/lang-html';
import { javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from '@codemirror/lang-javascript';
import { jsonLanguage } from '@codemirror/lang-json';
import type { LRLanguage } from '@codemirror/language';
import { highlightTree, tagHighlighter, tags as t, type Tag } from '@lezer/highlight';

/**
 * One syntax palette for the editor and the diff viewer, built from the
 * `--syn-*` design tokens so it follows the studio theme (dark and light).
 */

type Rule = { tag: Tag | readonly Tag[]; color: string; italic?: boolean; weight?: number; cls: string };

export const SYNTAX_RULES: Rule[] = [
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--syn-comment)', italic: true, cls: 'syn-comment' },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier, t.self], color: 'var(--syn-keyword)', cls: 'syn-keyword' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--syn-tag)', cls: 'syn-tag' },
  { tag: [t.attributeName, t.className, t.labelName], color: 'var(--syn-attr)', cls: 'syn-attr' },
  { tag: [t.string, t.attributeValue, t.special(t.string), t.regexp, t.escape, t.url, t.character], color: 'var(--syn-string)', cls: 'syn-string' },
  { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom, t.unit, t.color, t.constant(t.name)], color: 'var(--syn-number)', cls: 'syn-number' },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--syn-property)', cls: 'syn-property' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName, t.typeName, t.namespace], color: 'var(--syn-fn)', cls: 'syn-fn' },
  { tag: [t.punctuation, t.bracket, t.separator, t.operator, t.derefOperator], color: 'var(--syn-punct)', cls: 'syn-punct' },
  { tag: [t.heading], color: 'var(--syn-tag)', weight: 600, cls: 'syn-tag' },
  { tag: [t.invalid], color: 'var(--danger)', cls: 'syn-invalid' },
];

export const ifdyHighlightStyle = HighlightStyle.define(
  SYNTAX_RULES.map((r) => ({ tag: r.tag as Tag | Tag[], color: r.color, ...(r.italic ? { fontStyle: 'italic' } : {}), ...(r.weight ? { fontWeight: String(r.weight) } : {}) })),
);

export type LanguageId = 'html' | 'css' | 'js' | 'jsx' | 'ts' | 'tsx' | 'json' | 'text';

export function languageFor(path: string): LanguageId {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'html' || ext === 'htm' || ext === 'vue' || ext === 'svelte' || ext === 'svg' || ext === 'xml') return 'html';
  if (ext === 'css' || ext === 'scss' || ext === 'less') return 'css';
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'js';
  if (ext === 'jsx') return 'jsx';
  if (ext === 'ts' || ext === 'mts' || ext === 'cts') return 'ts';
  if (ext === 'tsx') return 'tsx';
  if (ext === 'json' || ext === 'map' || ext === 'webmanifest') return 'json';
  return 'text';
}

export const LANGUAGE_LABEL: Record<LanguageId, string> = { html: 'HTML', css: 'CSS', js: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', tsx: 'TSX', json: 'JSON', text: 'Plain text' };

export function lrLanguage(id: LanguageId): LRLanguage | null {
  switch (id) {
    case 'html':
      return htmlLanguage;
    case 'css':
      return cssLanguage;
    case 'js':
      return javascriptLanguage;
    case 'jsx':
      return jsxLanguage;
    case 'ts':
      return typescriptLanguage;
    case 'tsx':
      return tsxLanguage;
    case 'json':
      return jsonLanguage;
    default:
      return null;
  }
}

export type Span = { from: number; to: number; cls: string };

/**
 * Highlight a whole document and split the result into lines of spans
 * (offsets relative to each line). Parsing the full text keeps context
 * (e.g. CSS inside <style>) correct for diff lines.
 */
export function highlightLines(text: string, lang: LanguageId, classes: Record<string, string>): { lines: string[]; spans: Span[][] } {
  const lines = text.split('\n');
  const spans: Span[][] = lines.map(() => []);
  const language = lrLanguage(lang);
  if (!language || text.length > 400_000) return { lines, spans };
  const starts: number[] = [];
  let off = 0;
  for (const l of lines) {
    starts.push(off);
    off += l.length + 1;
  }
  const highlighter = tagHighlighter(SYNTAX_RULES.flatMap((r) => (Array.isArray(r.tag) ? r.tag : [r.tag]).map((tag) => ({ tag, class: classes[r.cls] ?? r.cls }))));
  let tree;
  try {
    tree = language.parser.parse(text);
  } catch {
    return { lines, spans };
  }
  let lineIdx = 0;
  highlightTree(tree, highlighter, (from, to, cls) => {
    while (lineIdx < starts.length - 1 && starts[lineIdx + 1] <= from) lineIdx++;
    let li = lineIdx;
    let f = from;
    while (f < to && li < lines.length) {
      const lineEnd = starts[li] + lines[li].length;
      const end = Math.min(to, lineEnd);
      if (end > f) spans[li].push({ from: f - starts[li], to: end - starts[li], cls });
      li++;
      f = li < starts.length ? starts[li] : to;
    }
  });
  return { lines, spans };
}

/** Split syntax spans by extra marked ranges (e.g. intraline diff changes). */
export function segmentsFor(line: string, spans: Span[], marks: { from: number; to: number }[] = []): { text: string; cls: string; mark: boolean }[] {
  const cuts = new Set<number>([0, line.length]);
  for (const s of spans) {
    cuts.add(Math.max(0, Math.min(line.length, s.from)));
    cuts.add(Math.max(0, Math.min(line.length, s.to)));
  }
  for (const m of marks) {
    cuts.add(Math.max(0, Math.min(line.length, m.from)));
    cuts.add(Math.max(0, Math.min(line.length, m.to)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: { text: string; cls: string; mark: boolean }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (b <= a) continue;
    const span = spans.find((s) => s.from <= a && s.to >= b);
    const mark = marks.some((m) => m.from <= a && m.to >= b);
    const prev = out[out.length - 1];
    const cls = span?.cls ?? '';
    if (prev && prev.cls === cls && prev.mark === mark) prev.text += line.slice(a, b);
    else out.push({ text: line.slice(a, b), cls, mark });
  }
  return out;
}
