/**
 * Node identity, labels and selectors inside the previewed document.
 */
import type { NodeId } from '@shared/types';

const ids = new WeakMap<Node, NodeId>();
const refs = new Map<NodeId, WeakRef<Node>>();
let nextId = 1;

export function idOf(node: Node): NodeId {
  let id = ids.get(node);
  if (!id) {
    id = nextId++;
    ids.set(node, id);
    refs.set(id, new WeakRef(node));
  }
  return id;
}

export function nodeOf(id: NodeId): Node | null {
  const n = refs.get(id)?.deref();
  if (!n) {
    refs.delete(id);
    return null;
  }
  return n;
}

export function elementOf(id: NodeId): Element | null {
  const n = nodeOf(id);
  return n && n.nodeType === 1 ? (n as Element) : null;
}

/** Elements created by IFDY itself, which must never show up in trees or audits. */
export function isIfdyNode(node: Node): boolean {
  if (node.nodeType !== 1) return false;
  const el = node as Element;
  return el.hasAttribute('data-ifdy') || el.hasAttribute('data-ifdy-agent') || el.id.startsWith('__ifdy');
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'BASE']);
export function isNonVisualTag(tag: string) {
  return SKIP_TAGS.has(tag.toUpperCase());
}

/** Auto-generated ids (React :r1:, uuid-like, long digit runs) are not stable selectors. */
function isStableToken(token: string): boolean {
  if (!token || token.length > 48) return false;
  if (/^[:_-]|:/.test(token)) return false;
  if (/\d{4,}/.test(token)) return false;
  if (/^[a-f0-9]{8,}$/i.test(token)) return false;
  if (/^(css|sc|jsx|emotion|svelte)-[a-z0-9]+$/i.test(token)) return false;
  return true;
}

export function stableClasses(el: Element): string[] {
  return [...el.classList].filter((c) => isStableToken(c) && !c.startsWith('ifdy'));
}

export function labelFor(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id && isStableToken(el.id) ? `#${el.id}` : '';
  const cls = stableClasses(el)
    .slice(0, 2)
    .map((c) => `.${c}`)
    .join('');
  return `${tag}${id}${cls}`;
}

const esc = (s: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\$&'));

function isUnique(selector: string, root: ParentNode = document): boolean {
  try {
    return root.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

/** A unique CSS selector for `el`, preferring ids, test ids and classes over positions. */
export function uniqueSelector(el: Element): string {
  if (el === document.documentElement) return 'html';
  if (el === document.body) return 'body';
  if (el.id && isStableToken(el.id) && isUnique(`#${esc(el.id)}`)) return `#${esc(el.id)}`;
  const testId = el.getAttribute('data-testid');
  if (testId && isUnique(`[data-testid="${testId}"]`)) return `[data-testid="${testId}"]`;

  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.documentElement) {
    let part = segmentFor(cur);
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter((s) => s !== cur && s.matches(part));
      if (siblings.length) {
        const sameTag = [...parent.children].filter((s) => s.tagName === cur!.tagName);
        part = `${part}:nth-of-type(${sameTag.indexOf(cur) + 1})`;
      }
    }
    parts.unshift(part);
    const candidate = parts.join(' > ');
    if (isUnique(candidate)) return candidate;
    if (parent && parent.id && isStableToken(parent.id) && isUnique(`#${esc(parent.id)}`)) {
      const withId = `#${esc(parent.id)} > ${candidate}`;
      if (isUnique(withId)) return withId;
    }
    cur = parent;
  }
  return parts.join(' > ') || el.tagName.toLowerCase();
}

function segmentFor(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const testId = el.getAttribute('data-testid');
  if (testId) return `${tag}[data-testid="${testId}"]`;
  const cls = stableClasses(el).slice(0, 2);
  return tag + cls.map((c) => `.${esc(c)}`).join('');
}

/** Class-level selector (tag + stable classes) used for "edit all matching" scope. */
export function classSelector(el: Element): string {
  const cls = stableClasses(el);
  if (!cls.length) return uniqueSelector(el);
  return el.tagName.toLowerCase() + cls.map((c) => `.${esc(c)}`).join('');
}

export function pathFor(el: Element): { id: NodeId; label: string }[] {
  const out: { id: NodeId; label: string }[] = [];
  let cur: Element | null = el;
  while (cur) {
    out.unshift({ id: idOf(cur), label: labelFor(cur) });
    cur = cur.parentElement;
  }
  return out;
}

export function textPreview(el: Element, max = 80): string {
  const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

export function isVisible(el: Element): boolean {
  const anyEl = el as Element & { checkVisibility?: (o?: object) => boolean };
  if (typeof anyEl.checkVisibility === 'function') {
    return anyEl.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
  }
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
}

export function rectOf(el: Element) {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

export function resolveSelector(selector: string): Element | null {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}
