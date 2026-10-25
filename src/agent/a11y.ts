import type { A11yInfo, A11yIssue, IssueSeverity, NodeId, Rect, ViewportContext } from '@shared/types';
import { computeAccessibleDescription, computeAccessibleName, getRole } from 'dom-accessibility-api';
import { blend, contrastRatio, parseColor, parsePx, toHex } from './css-utils';
import { idOf, isIfdyNode, isVisible, labelFor, rectOf, resolveSelector, textPreview } from './nodes';

export function accessibleName(el: Element): string {
  try {
    return computeAccessibleName(el);
  } catch {
    return '';
  }
}

export function roleOf(el: Element): string {
  try {
    return getRole(el) ?? implicitRole(el);
  } catch {
    return implicitRole(el);
  }
}

function implicitRole(el: Element) {
  const t = el.tagName.toLowerCase();
  if (t === 'button') return 'button';
  if (t === 'a' && el.hasAttribute('href')) return 'link';
  if (/^h[1-6]$/.test(t)) return 'heading';
  if (t === 'img') return 'img';
  return 'generic';
}

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, summary, [tabindex], [contenteditable]:not([contenteditable="false"])';

export function isFocusable(el: Element): boolean {
  return el.matches(FOCUSABLE) && (el as HTMLElement).tabIndex >= -1;
}

export function tabbables(): HTMLElement[] {
  const list = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.tabIndex >= 0 && !isIfdyNode(el) && isVisible(el) && !el.closest('[inert]'),
  );
  const positive = list.filter((e) => e.tabIndex > 0).sort((a, b) => a.tabIndex - b.tabIndex);
  return [...positive, ...list.filter((e) => e.tabIndex === 0)];
}

/** Effective background behind `el`, compositing translucent ancestors over white. */
export function effectiveBackground(el: Element): { r: number; g: number; b: number } {
  const stack: { r: number; g: number; b: number; a: number }[] = [];
  let cur: Element | null = el;
  while (cur) {
    const c = parseColor(getComputedStyle(cur).backgroundColor);
    if (c && c.a > 0) {
      stack.push(c);
      if (c.a >= 1) break;
    }
    cur = cur.parentElement;
  }
  let base = { r: 255, g: 255, b: 255 };
  for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base);
  return base;
}

export function contrastFor(el: Element): A11yInfo['contrast'] {
  const text = (el.textContent ?? '').trim();
  if (!text) return undefined;
  const cs = getComputedStyle(el);
  const fgRaw = parseColor(cs.color);
  if (!fgRaw) return undefined;
  const bg = effectiveBackground(el);
  const fg = fgRaw.a < 1 ? blend(fgRaw, bg) : fgRaw;
  const ratio = contrastRatio(fg, bg);
  const fontSize = parsePx(cs.fontSize);
  const bold = Number(cs.fontWeight) >= 700;
  const large = fontSize >= 24 || (bold && fontSize >= 18.66);
  return {
    ratio: Math.round(ratio * 100) / 100,
    fg: toHex(fg),
    bg: toHex(bg),
    aa: ratio >= (large ? 3 : 4.5),
    aaLarge: ratio >= 3,
    aaa: ratio >= (large ? 4.5 : 7),
    fontSize,
    bold,
  };
}

export function a11yInfo(el: Element): A11yInfo {
  const aria: [string, string][] = [];
  for (const a of el.attributes) if (a.name.startsWith('aria-') || a.name === 'role') aria.push([a.name, a.value]);
  const states: string[] = [];
  const h = el as HTMLInputElement;
  if (h.disabled) states.push('disabled');
  if (h.required) states.push('required');
  if (el.getAttribute('aria-invalid') === 'true') states.push('invalid');
  if (el.getAttribute('aria-expanded')) states.push(`expanded=${el.getAttribute('aria-expanded')}`);
  if (el.getAttribute('aria-pressed')) states.push(`pressed=${el.getAttribute('aria-pressed')}`);
  if (typeof h.checked === 'boolean' && (h.type === 'checkbox' || h.type === 'radio')) states.push(h.checked ? 'checked' : 'unchecked');
  if (document.activeElement === el) states.push('focused');
  let description: string | undefined;
  try {
    description = computeAccessibleDescription(el) || undefined;
  } catch {
    /* ignore */
  }
  return {
    role: roleOf(el),
    name: accessibleName(el),
    description,
    focusable: isFocusable(el),
    tabIndex: el.hasAttribute('tabindex') || isFocusable(el) ? (el as HTMLElement).tabIndex : null,
    hidden: el.closest('[aria-hidden="true"]') !== null || !isVisible(el),
    states,
    aria,
    contrast: el.children.length === 0 ? contrastFor(el) : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* axe-core                                                            */
/* ------------------------------------------------------------------ */

type AxeResult = {
  violations: {
    id: string;
    impact?: string | null;
    help: string;
    description: string;
    helpUrl: string;
    tags: string[];
    nodes: { target: (string | string[])[]; html: string; failureSummary?: string }[];
  }[];
};

declare global {
  interface Window {
    axe?: { run: (ctx: unknown, opts: unknown) => Promise<AxeResult>; configure?: (c: unknown) => void };
    /** Provided by the controlled-browser init script: loads axe-core via the companion (CSP-proof). */
    __ifdyLoadAxe?: () => Promise<void>;
  }
}

let axeLoading: Promise<void> | null = null;
let agentOrigin = '';

export function setAgentOrigin(origin: string) {
  agentOrigin = origin;
}

function loadAxe(): Promise<void> {
  if (window.axe) return Promise.resolve();
  if (!axeLoading && typeof window.__ifdyLoadAxe === 'function') {
    axeLoading = window.__ifdyLoadAxe().catch((err: unknown) => {
      axeLoading = null;
      throw err instanceof Error ? err : new Error(String(err));
    });
  }
  if (!axeLoading) {
    axeLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `${agentOrigin}/__ifdy/axe.js`;
      s.setAttribute('data-ifdy', '');
      s.onload = () => resolve();
      s.onerror = () => {
        axeLoading = null;
        reject(new Error('Could not load axe-core into the preview (its Content-Security-Policy may block injected scripts).'));
      };
      (document.head ?? document.documentElement).appendChild(s);
    });
  }
  return axeLoading;
}

const impactMap: Record<string, IssueSeverity> = { critical: 'critical', serious: 'serious', moderate: 'moderate', minor: 'minor' };

export async function runAxe(viewport?: ViewportContext): Promise<A11yIssue[]> {
  await loadAxe();
  const result = await window.axe!.run(
    { exclude: [['[data-ifdy]'], ['[data-ifdy-agent]']] },
    { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } },
  );
  return result.violations.map((v, i) => ({
    id: `axe-${v.id}-${i}`,
    ruleId: v.id,
    impact: impactMap[v.impact ?? 'minor'] ?? 'minor',
    help: v.help,
    description: v.description,
    helpUrl: v.helpUrl,
    tags: v.tags,
    viewport,
    nodes: v.nodes.slice(0, 25).map((n) => {
      const selector = (n.target.flat() as string[]).join(' ');
      const el = resolveSelector(selector);
      return {
        selector,
        html: n.html.length > 300 ? n.html.slice(0, 299) + '…' : n.html,
        summary: n.failureSummary ?? '',
        nodeId: el ? idOf(el) : undefined,
      };
    }),
  }));
}

/* ------------------------------------------------------------------ */
/* Keyboard audit                                                      */
/* ------------------------------------------------------------------ */

function focusIndicator(el: HTMLElement): boolean {
  const before = getComputedStyle(el);
  const snap = [before.outlineStyle, before.outlineWidth, before.boxShadow, before.borderColor, before.backgroundColor].join('|');
  const prev = document.activeElement as HTMLElement | null;
  el.focus({ preventScroll: true });
  const after = getComputedStyle(el);
  const changed =
    (after.outlineStyle !== 'none' && parsePx(after.outlineWidth) > 0) ||
    [after.outlineStyle, after.outlineWidth, after.boxShadow, after.borderColor, after.backgroundColor].join('|') !== snap;
  prev?.focus?.({ preventScroll: true });
  return changed;
}

export function keyboardAudit(): { order: { id: NodeId; label: string; rect: Rect; visibleFocus: boolean }[]; traps: string[] } {
  const order = tabbables().map((el) => ({
    id: idOf(el),
    label: `${labelFor(el)} — ${accessibleName(el) || textPreview(el, 40) || 'unnamed'}`,
    rect: rectOf(el),
    visibleFocus: focusIndicator(el),
  }));
  // Elements that look interactive but cannot be reached with the keyboard.
  const traps: string[] = [];
  const candidates = document.body?.querySelectorAll<HTMLElement>('[onclick], div, span, li, img') ?? [];
  for (const el of candidates) {
    if (isIfdyNode(el) || isFocusable(el) || !isVisible(el)) continue;
    const cs = getComputedStyle(el);
    const clickable = el.hasAttribute('onclick') || el.onclick !== null || (cs.cursor === 'pointer' && !el.closest('a,button,label,summary'));
    if (clickable && !el.querySelector('a,button,input,select,textarea')) {
      traps.push(`${labelFor(el)} looks interactive (${el.hasAttribute('onclick') || el.onclick ? 'click handler' : 'pointer cursor'}) but is not keyboard focusable`);
    }
    if (traps.length > 30) break;
  }
  return { order, traps };
}
