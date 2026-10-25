import type { Change, CssomPatch, DesignToken, DomPatch, PatchSet, ViewportContext } from '@shared/types';

/**
 * Pure change-set logic. The studio keeps an ordered list of Change records;
 * everything shown in the preview is derived from it, so undo/redo, crash
 * recovery and export never drift apart.
 */

let seq = 0;
export function changeId(): string {
  return `c${Date.now().toString(36)}${(seq++).toString(36)}`;
}

export function makeChange(partial: Omit<Change, 'id' | 'timestamp' | 'exportStatus' | 'experiment' | 'scope'> & Partial<Pick<Change, 'id' | 'timestamp' | 'exportStatus' | 'experiment' | 'scope'>>): Change {
  return {
    id: partial.id ?? changeId(),
    timestamp: partial.timestamp ?? Date.now(),
    exportStatus: partial.exportStatus ?? 'pending',
    experiment: partial.experiment ?? false,
    scope: partial.scope ?? 'element',
    ...partial,
  } as Change;
}

/** Collapse a change list to the effective final value per target/property/media. */
export function effectiveChanges(changes: Change[]): Change[] {
  const latest = new Map<string, Change>();
  for (const c of changes) {
    const key =
      c.kind === 'rule'
        ? `rule|${c.target.ruleKey}|${c.target.ruleSelector}|${c.property}`
        : c.kind === 'token'
          ? `token|${c.property}`
          : `${c.kind === 'visibility' ? 'style' : c.kind}|${c.target.selector}|${c.media ?? ''}|${c.kind === 'visibility' ? 'display' : c.property}`;
    latest.delete(key); // keep insertion order of the latest edit
    latest.set(key, c);
  }
  return [...latest.values()];
}

/** Whether a change is a no-op (back to its original value). */
export function isNoop(c: Change): boolean {
  return c.before === c.after && c.kind !== 'visibility';
}

function cssValue(c: Change): string | null {
  if (c.kind === 'visibility') return c.after === 'hidden' ? 'none' : null;
  return c.after;
}

function cssProperty(c: Change): string {
  return c.kind === 'visibility' ? 'display' : c.property;
}

type Block = { media: string; selector: string; decls: Map<string, string> };

function styleBlocks(changes: Change[]): Block[] {
  const blocks = new Map<string, Block>();
  for (const c of effectiveChanges(changes)) {
    if (c.kind !== 'style' && c.kind !== 'visibility') continue;
    const value = cssValue(c);
    if (value === null || value === '') continue;
    const media = c.media ?? '';
    const key = `${media}\u0000${c.target.selector}`;
    let b = blocks.get(key);
    if (!b) {
      b = { media, selector: c.target.selector, decls: new Map() };
      blocks.set(key, b);
    }
    b.decls.set(cssProperty(c), value);
  }
  return [...blocks.values()];
}

export function buildOverrideCss(changes: Change[], important = true): string {
  const blocks = styleBlocks(changes);
  const bang = important ? ' !important' : '';
  const byMedia = new Map<string, Block[]>();
  for (const b of blocks) {
    const list = byMedia.get(b.media) ?? [];
    list.push(b);
    byMedia.set(b.media, list);
  }
  const out: string[] = [];
  for (const [media, list] of byMedia) {
    const body = list.map((b) => `${b.selector} {\n${[...b.decls].map(([p, v]) => `  ${p}: ${v}${bang};`).join('\n')}\n}`).join('\n');
    out.push(media ? `@media ${media} {\n${indent(body)}\n}` : body);
  }
  return out.join('\n\n');
}

const indent = (s: string) =>
  s
    .split('\n')
    .map((l) => (l ? '  ' + l : l))
    .join('\n');

export function buildPatchSet(changes: Change[], tokens: DesignToken[] = [], tokenOverrides = true): PatchSet {
  const eff = effectiveChanges(changes);
  const cssom: CssomPatch[] = eff
    .filter((c) => c.kind === 'rule' && c.target.ruleKey && c.target.ruleSelector)
    .map((c) => ({ id: c.id, ruleKey: c.target.ruleKey!, ruleSelector: c.target.ruleSelector!, property: c.property, value: c.after }));
  const dom: DomPatch[] = [];
  for (const c of eff) {
    if (c.kind === 'text' && c.after !== null) dom.push({ id: c.id, kind: 'text', selector: c.target.selector, value: c.after });
    if ((c.kind === 'attribute' || c.kind === 'asset') && c.target.selector) dom.push({ id: c.id, kind: 'attr', selector: c.target.selector, name: c.property, value: c.after });
  }
  const tokenMap: Record<string, string> = {};
  if (tokenOverrides) {
    for (const t of tokens) if (t.cssVar && t.value) tokenMap[t.cssVar] = t.value;
  }
  for (const c of eff) if (c.kind === 'token' && c.after !== null) tokenMap[c.property] = c.after;
  return { css: buildOverrideCss(changes), cssom, dom, tokens: tokenMap };
}

/** Media query that limits a change to widths like the current viewport. */
export function mediaForViewport(v: ViewportContext, mode: 'at-most' | 'at-least' | 'exact'): string {
  if (mode === 'at-most') return `(max-width: ${v.width}px)`;
  if (mode === 'at-least') return `(min-width: ${v.width}px)`;
  return `(min-width: ${v.width}px) and (max-width: ${v.width}px)`;
}

/* ------------------------------------------------------------------ */
/* Undo / redo                                                         */
/* ------------------------------------------------------------------ */

export type History = { changes: Change[]; undoStack: Change[][]; redoStack: Change[][] };

const MAX_UNDO = 200;

export function commit(h: History, next: Change | Change[]): History {
  const add = Array.isArray(next) ? next : [next];
  if (!add.length) return h;
  return {
    changes: [...h.changes, ...add],
    undoStack: [...h.undoStack, h.changes].slice(-MAX_UNDO),
    redoStack: [],
  };
}

export function replaceAll(h: History, changes: Change[]): History {
  return { changes, undoStack: [...h.undoStack, h.changes].slice(-MAX_UNDO), redoStack: [] };
}

export function undo(h: History): History {
  if (!h.undoStack.length) return h;
  const prev = h.undoStack[h.undoStack.length - 1];
  return { changes: prev, undoStack: h.undoStack.slice(0, -1), redoStack: [...h.redoStack, h.changes] };
}

export function redo(h: History): History {
  if (!h.redoStack.length) return h;
  const next = h.redoStack[h.redoStack.length - 1];
  return { changes: next, undoStack: [...h.undoStack, h.changes], redoStack: h.redoStack.slice(0, -1) };
}

/* ------------------------------------------------------------------ */
/* Summaries                                                           */
/* ------------------------------------------------------------------ */

export function describeChange(c: Change): string {
  const target = c.kind === 'rule' ? c.target.ruleSelector : c.target.label;
  switch (c.kind) {
    case 'style':
      return `${target}: ${c.property} ${c.before ?? '∅'} → ${c.after ?? '∅'}${c.media ? ` @media ${c.media}` : ''}`;
    case 'rule':
      return c.after === null ? `${target}: disabled ${c.property}` : `${target}: ${c.property} ${c.before ?? '∅'} → ${c.after}`;
    case 'text':
      return `${target}: text “${truncate(c.before)}” → “${truncate(c.after)}”`;
    case 'attribute':
    case 'asset':
      return `${target}: ${c.property}=${truncate(c.after)}`;
    case 'visibility':
      return `${target}: ${c.after === 'hidden' ? 'hidden in preview' : 'shown'}`;
    case 'token':
      return `token ${c.property}: ${c.before ?? '∅'} → ${c.after}`;
  }
}

const truncate = (s: string | null, n = 32) => (s === null ? '∅' : s.length > n ? s.slice(0, n - 1) + '…' : s);

export function changeSummaryMarkdown(changes: Change[]): string {
  const eff = effectiveChanges(changes).filter((c) => !isNoop(c));
  if (!eff.length) return '_No changes._';
  const lines = eff.map((c) => `- ${c.experiment ? '🧪 ' : ''}${describeChange(c)} _(origin: ${c.origin}; viewport: ${c.viewport.deviceName} ${c.viewport.width}×${c.viewport.height}${c.viewport.posture === 'expanded' ? ' expanded' : ''})_`);
  return lines.join('\n');
}
