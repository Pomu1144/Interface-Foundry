import type { CssomPatch, DomPatch, PatchSet } from '@shared/types';
import { resolveSelector } from './nodes';
import { findRule } from './styles';

/**
 * Applies the studio's PatchSet idempotently. The studio owns the full list of
 * active edits; every call describes the complete desired state, so undo, redo
 * and crash recovery are simply "apply the new set".
 */

const OVERRIDE_ID = '__ifdy-overrides';
const TOKENS_ID = '__ifdy-tokens';

let current: PatchSet = { css: '', cssom: [], dom: [], tokens: {} };

type CssomOriginal = { rule: CSSStyleRule; property: string; value: string; priority: string };
const cssomApplied = new Map<string, { patch: CssomPatch; original: CssomOriginal }>();
const domOriginals = new Map<string, { el: Element; restore: () => void }>();

function styleEl(id: string): HTMLStyleElement {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    el.setAttribute('data-ifdy', '');
  }
  const host = document.head ?? document.documentElement;
  // Keep IFDY sheets last so they win ties with author styles.
  if (el.parentNode !== host || host.lastElementChild !== el) host.appendChild(el);
  return el;
}

export function applyPatchSet(set: PatchSet): { applied: number; failed: string[] } {
  current = set;
  const failed: string[] = [];
  let applied = 0;

  // 1. Override stylesheet.
  const overrides = styleEl(OVERRIDE_ID);
  if (overrides.textContent !== set.css) overrides.textContent = set.css;
  if (set.css) applied++;

  // 2. Design tokens as :root custom properties.
  const tokenCss = Object.keys(set.tokens).length
    ? `:root{${Object.entries(set.tokens)
        .map(([k, v]) => `${k}:${v} !important;`)
        .join('')}}`
    : '';
  const tokens = styleEl(TOKENS_ID);
  if (tokens.textContent !== tokenCss) tokens.textContent = tokenCss;

  // 3. CSSOM rule edits: revert those no longer present, then apply.
  const wanted = new Map(set.cssom.map((p) => [p.id, p]));
  for (const [id, entry] of cssomApplied) {
    const next = wanted.get(id);
    if (!next || next.value !== entry.patch.value || next.ruleKey !== entry.patch.ruleKey) {
      restoreCssom(entry.original);
      cssomApplied.delete(id);
    }
  }
  for (const patch of set.cssom) {
    if (cssomApplied.has(patch.id)) {
      applied++;
      continue;
    }
    const rule = findRule(patch.ruleKey, patch.ruleSelector);
    if (!rule) {
      failed.push(patch.id);
      continue;
    }
    const original: CssomOriginal = {
      rule,
      property: patch.property,
      value: rule.style.getPropertyValue(patch.property),
      priority: rule.style.getPropertyPriority(patch.property),
    };
    // If another patch already touched this property, keep the first original.
    for (const e of cssomApplied.values()) {
      if (e.original.rule === rule && e.original.property === patch.property) {
        original.value = e.original.value;
        original.priority = e.original.priority;
      }
    }
    if (patch.value === null) rule.style.removeProperty(patch.property);
    else rule.style.setProperty(patch.property, patch.value, patch.important ? 'important' : original.priority);
    cssomApplied.set(patch.id, { patch, original });
    applied++;
  }

  // 4. DOM patches (text, attributes).
  const wantedDom = new Set(set.dom.map((d) => d.id));
  for (const [id, entry] of domOriginals) {
    if (!wantedDom.has(id)) {
      entry.restore();
      domOriginals.delete(id);
    }
  }
  for (const patch of set.dom) {
    if (!applyDomPatch(patch)) failed.push(patch.id);
    else applied++;
  }
  return { applied, failed };
}

function restoreCssom(o: CssomOriginal) {
  if (o.value) o.rule.style.setProperty(o.property, o.value, o.priority);
  else o.rule.style.removeProperty(o.property);
}

function applyDomPatch(patch: DomPatch): boolean {
  const el = resolveSelector(patch.selector);
  if (!el) return false;
  const existing = domOriginals.get(patch.id);
  if (existing && existing.el !== el) {
    existing.restore();
    domOriginals.delete(patch.id);
  }
  if (patch.kind === 'text') {
    if (!domOriginals.has(patch.id)) {
      const before = el.textContent ?? '';
      domOriginals.set(patch.id, { el, restore: () => (el.textContent = before) });
    }
    if (el.textContent !== patch.value) el.textContent = patch.value;
    return true;
  }
  if (patch.kind === 'attr') {
    if (!domOriginals.has(patch.id)) {
      const had = el.hasAttribute(patch.name);
      const before = el.getAttribute(patch.name);
      domOriginals.set(patch.id, {
        el,
        restore: () => (had && before !== null ? el.setAttribute(patch.name, before) : el.removeAttribute(patch.name)),
      });
    }
    if (patch.value === null) el.removeAttribute(patch.name);
    else if (el.getAttribute(patch.name) !== patch.value) el.setAttribute(patch.name, patch.value);
    return true;
  }
  if (patch.kind === 'hide') {
    const h = el as HTMLElement;
    if (!domOriginals.has(patch.id)) {
      const before = h.style.getPropertyValue('display');
      const prio = h.style.getPropertyPriority('display');
      domOriginals.set(patch.id, { el, restore: () => (before ? h.style.setProperty('display', before, prio) : h.style.removeProperty('display')) });
    }
    h.style.setProperty('display', 'none', 'important');
    return true;
  }
  return false;
}

/** Re-apply DOM patches after the app re-renders (SPA frameworks may replace nodes). */
export function reapplyAfterMutation() {
  if (!current.dom.length) {
    // Only make sure our sheets are still attached and last.
    if (current.css) styleEl(OVERRIDE_ID);
    if (Object.keys(current.tokens).length) styleEl(TOKENS_ID);
    return;
  }
  for (const patch of current.dom) {
    const el = resolveSelector(patch.selector);
    const entry = domOriginals.get(patch.id);
    if (!el) continue;
    if (!entry || entry.el !== el || !el.isConnected) {
      domOriginals.delete(patch.id);
      applyDomPatch(patch);
    } else if (patch.kind === 'text' && el.textContent !== patch.value) {
      el.textContent = patch.value;
    }
  }
  if (current.css) styleEl(OVERRIDE_ID);
}

/** For the styles inspector: which declarations of a rule IFDY has modified. */
export function appliedCssomPatch(ruleKey: string) {
  const map = new Map<string, string | null>();
  const originals = new Map<string, string>();
  for (const { patch, original } of cssomApplied.values()) {
    if (patch.ruleKey === ruleKey) {
      map.set(patch.property, patch.value);
      originals.set(patch.property, original.value);
    }
  }
  if (!map.size) return null;
  return Object.assign(map, { originalValue: (p: string) => originals.get(p) });
}

export function currentPatchSet() {
  return current;
}
