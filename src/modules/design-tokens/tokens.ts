import type { Change, DesignToken, TokenType } from '@shared/types';
import type { TokenUsage } from '@shared/protocol';
import { studio, useStudio } from '@/store';
import { effectiveChanges, makeChange, replaceAll } from '@/modules/change-manager/changes';
import { setStyles } from '@/modules/change-manager/edit';
import { currentViewportContext } from '@/modules/device-simulator/context';
import { callPrimary } from '@/modules/preview-runtime/registry';
import { cssVarFromName, fromDtcg, inferTokenType, nameFromCssVar, tokenId } from './dtcg';

/**
 * Token operations. The store's `tokens` list is the library (base values);
 * every value edit is a Change of kind 'token' so it previews live, is
 * undoable, survives reloads and exports to source (`:root` declarations).
 */

/* ------------------------------------------------------------------ */
/* Scan info (usage counts, page-defined variables), per project       */
/* ------------------------------------------------------------------ */

export type ScanInfo = { at: number; vars: Record<string, { value: string; usage: number }> };
const scanKey = () => `ifdy.tokens.scan.${studio().project?.id ?? 'none'}`;
let scanCache: { key: string; info: ScanInfo | null } | null = null;
const scanListeners = new Set<() => void>();

export function scanInfo(): ScanInfo | null {
  const key = scanKey();
  if (scanCache?.key === key) return scanCache.info;
  let info: ScanInfo | null = null;
  try {
    info = JSON.parse(localStorage.getItem(key) ?? 'null') as ScanInfo | null;
  } catch {
    info = null;
  }
  scanCache = { key, info };
  return info;
}
function setScanInfo(info: ScanInfo) {
  scanCache = { key: scanKey(), info };
  try {
    localStorage.setItem(scanKey(), JSON.stringify(info));
  } catch {
    /* ignore */
  }
  scanListeners.forEach((l) => l());
}
export function onScanInfo(fn: () => void) {
  scanListeners.add(fn);
  return () => {
    scanListeners.delete(fn);
  };
}
useStudio.subscribe(
  (s) => s.project?.id,
  () => {
    scanCache = null;
    scanListeners.forEach((l) => l());
  },
);

/** Whether the page itself defines this custom property (seen by the last scan). */
export function definedOnPage(cssVar: string): boolean {
  return Boolean(scanInfo()?.vars[cssVar]);
}

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

export function tokenChanges(changes: Change[], cssVar: string): Change[] {
  return changes.filter((c) => c.kind === 'token' && c.property === cssVar);
}

/** Current value: latest committed (or transient) token edit, else the library value. */
export function liveValue(t: DesignToken, changes = studio().changes, transient = studio().transient): string {
  const all = [...changes, ...transient];
  for (let i = all.length - 1; i >= 0; i--) {
    const c = all[i];
    if (c.kind === 'token' && c.property === t.cssVar && c.after !== null) return c.after;
  }
  return t.value;
}

function tokenChange(t: DesignToken, before: string | null, after: string, note?: string): Change {
  return makeChange({
    kind: 'token',
    target: { selector: ':root', label: `:root ${t.cssVar}` },
    property: t.cssVar,
    before,
    after,
    viewport: currentViewportContext(),
    origin: 'tokens',
    scope: 'selector',
    note,
  });
}

export function previewTokenValue(t: DesignToken, value: string) {
  studio().previewChange(tokenChange(t, liveValue(t, studio().changes, []), value));
}

export function cancelTokenPreview() {
  studio().previewChange(null);
}

export function commitTokenValue(t: DesignToken, value: string) {
  const before = liveValue(t, studio().changes, []);
  if (before === value) {
    studio().previewChange(null);
    return;
  }
  studio().commitChange(tokenChange(t, before, value));
}

/** Drop every edit of this token (back to the library value). Undoable. */
export function resetToken(t: DesignToken) {
  const s = studio();
  const left = s.changes.filter((c) => !(c.kind === 'token' && c.property === t.cssVar));
  if (left.length === s.changes.length) return;
  useStudio.setState({ ...replaceAll({ changes: s.changes, undoStack: s.undoStack, redoStack: s.redoStack }, left), transient: [], saveStatus: 'unsaved' });
}

/* ------------------------------------------------------------------ */
/* Library edits                                                       */
/* ------------------------------------------------------------------ */

export function createToken(input: { name: string; type: TokenType; value: string; cssVar?: string; description?: string }): DesignToken {
  const cssVar = input.cssVar?.trim() || cssVarFromName(input.name);
  const t: DesignToken = { id: tokenId(), name: input.name.trim() || nameFromCssVar(cssVar), type: input.type, value: input.value.trim(), cssVar, description: input.description };
  studio().upsertToken(t);
  // A new variable must exist on the page before anything can use it.
  if (!definedOnPage(cssVar)) studio().commitChange(tokenChange(t, null, t.value, 'define token'));
  return t;
}

export function updateToken(t: DesignToken, patch: Partial<Pick<DesignToken, 'name' | 'type' | 'description' | 'cssVar'>>) {
  const next = { ...t, ...patch };
  if (patch.cssVar && patch.cssVar !== t.cssVar) {
    // Only user-defined variables can be renamed; carry their edits over.
    const s = studio();
    const moved = s.changes.map((c) => (c.kind === 'token' && c.property === t.cssVar ? { ...c, property: patch.cssVar!, target: { ...c.target, label: `:root ${patch.cssVar}` } } : c));
    useStudio.setState({ ...replaceAll({ changes: s.changes, undoStack: s.undoStack, redoStack: s.redoStack }, moved), saveStatus: 'unsaved' });
  }
  studio().upsertToken(next);
}

export function removeToken(t: DesignToken) {
  studio().deleteToken(t.id);
  if (!definedOnPage(t.cssVar)) resetToken(t);
}

/* ------------------------------------------------------------------ */
/* Scan / import                                                       */
/* ------------------------------------------------------------------ */

export async function scanPageTokens(): Promise<{ total: number; added: number; updated: number }> {
  const found = await callPrimary('tokens.scan', undefined, 10000);
  const s = studio();
  const byVar = new Map(s.tokens.map((t) => [t.cssVar, t]));
  const edited = new Set(effectiveChanges(s.changes).filter((c) => c.kind === 'token').map((c) => c.property));
  let added = 0;
  let updated = 0;
  const next = [...s.tokens];
  for (const f of found) {
    if (!f.value) continue;
    const existing = byVar.get(f.name);
    if (existing) {
      // Keep the user's name/type; refresh the base value unless they are editing it.
      if (!edited.has(f.name) && existing.value !== f.value) {
        next[next.indexOf(existing)] = { ...existing, value: f.value };
        updated++;
      }
      continue;
    }
    next.push({ id: tokenId(), name: nameFromCssVar(f.name), type: inferTokenType(f.name, f.value), value: f.value, cssVar: f.name });
    added++;
  }
  s.setTokens(next);
  setScanInfo({ at: Date.now(), vars: Object.fromEntries(found.map((f) => [f.name, { value: f.value, usage: f.usage }])) });
  return { total: found.length, added, updated };
}

export function importDtcg(json: unknown, mode: 'merge' | 'replace' = 'merge'): { added: number; updated: number; warnings: string[] } {
  const { tokens, warnings } = fromDtcg(json);
  const s = studio();
  const current = mode === 'replace' ? [] : [...s.tokens];
  let added = 0;
  let updated = 0;
  const changes: Change[] = [];
  for (const t of tokens) {
    const i = current.findIndex((x) => x.cssVar === t.cssVar);
    if (i >= 0) {
      const prev = current[i];
      current[i] = { ...prev, name: t.name, type: t.type, description: t.description ?? prev.description };
      // Imported values become (undoable) token edits so the page previews them.
      const live = liveValue(prev, s.changes, []);
      if (live !== t.value) changes.push(tokenChange(prev, live, t.value, 'import'));
      updated++;
    } else {
      current.push(t);
      if (!definedOnPage(t.cssVar)) changes.push(tokenChange(t, null, t.value, 'import'));
      added++;
    }
  }
  s.setTokens(current);
  if (changes.length) s.commitChange(changes);
  return { added, updated, warnings };
}

export function tokenUsageDetails(cssVar: string): Promise<TokenUsage[]> {
  return callPrimary('tokens.usage', { name: cssVar }, 10000);
}

/* ------------------------------------------------------------------ */
/* Apply to the selection                                              */
/* ------------------------------------------------------------------ */

export type ApplyTarget = { id: string; label: string; properties: string[] };

export function applyTargets(t: DesignToken, value = t.value): ApplyTarget[] {
  switch (t.type) {
    case 'color':
      return [
        { id: 'color', label: 'Text', properties: ['color'] },
        { id: 'bg', label: 'Background', properties: ['background-color'] },
        { id: 'border', label: 'Border', properties: ['border-color'] },
        { id: 'fill', label: 'Fill', properties: ['fill'] },
        { id: 'outline', label: 'Outline', properties: ['outline-color'] },
      ];
    case 'spacing':
      return [
        { id: 'padding', label: 'Padding', properties: ['padding'] },
        { id: 'gap', label: 'Gap', properties: ['gap'] },
        { id: 'margin', label: 'Margin', properties: ['margin'] },
        { id: 'px', label: 'Padding X', properties: ['padding-left', 'padding-right'] },
        { id: 'py', label: 'Padding Y', properties: ['padding-top', 'padding-bottom'] },
      ];
    case 'radius':
      return [{ id: 'radius', label: 'Corner radius', properties: ['border-radius'] }];
    case 'shadow':
      return [{ id: 'shadow', label: 'Box shadow', properties: ['box-shadow'] }];
    case 'z-index':
      return [{ id: 'z', label: 'Z-index', properties: ['z-index'] }];
    case 'typography': {
      const v = value.trim();
      if (/,|serif|sans|mono|system-ui|["']/.test(v) && !/^\d/.test(v)) return [{ id: 'family', label: 'Font family', properties: ['font-family'] }];
      if (/^(\d00|normal|bold)$/.test(v)) return [{ id: 'weight', label: 'Font weight', properties: ['font-weight'] }];
      if (/^\d*\.?\d+$/.test(v)) return [{ id: 'lh', label: 'Line height', properties: ['line-height'] }];
      return [
        { id: 'size', label: 'Font size', properties: ['font-size'] },
        { id: 'lh', label: 'Line height', properties: ['line-height'] },
        { id: 'ls', label: 'Letter spacing', properties: ['letter-spacing'] },
      ];
    }
    case 'breakpoint':
      return [];
    default:
      return [];
  }
}

export function applyTokenToSelection(t: DesignToken, target: ApplyTarget) {
  setStyles(
    target.properties.map((p) => ({ property: p, value: `var(${t.cssVar})` })),
    'tokens',
  );
}

export function applyTokenToProperty(t: DesignToken, property: string) {
  setStyles([{ property, value: `var(${t.cssVar})` }], 'tokens');
}
