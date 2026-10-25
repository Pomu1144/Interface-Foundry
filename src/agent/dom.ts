import type { DomNode, DomSnapshot, NodeId } from '@shared/types';
import { componentNameFor } from './component';
import { elementOf, idOf, isIfdyNode, isVisible, labelFor, stableClasses, textPreview } from './nodes';
import { accessibleName } from './a11y';

const MAX_ATTRS = 12;

function serializeElement(el: Element, includeChildren: boolean, budget: { left: number }, nodes: Record<NodeId, DomNode>): NodeId {
  const id = idOf(el);
  const childNodes = [...el.childNodes].filter((c) => (c.nodeType === 1 && !isIfdyNode(c)) || (c.nodeType === 3 && c.textContent?.trim()));
  const cs = getComputedStyle(el);
  const attrs: [string, string][] = [];
  for (const a of [...el.attributes].slice(0, MAX_ATTRS)) {
    if (a.name === 'class' || a.name === 'id' || a.name === 'style' && a.value.length > 200) continue;
    attrs.push([a.name, a.value.length > 120 ? a.value.slice(0, 119) + '…' : a.value]);
  }
  const node: DomNode = {
    id,
    type: 1,
    tag: el.tagName.toLowerCase(),
    idAttr: el.id || undefined,
    classes: el.classList.length ? [...el.classList] : undefined,
    attrs: attrs.length ? attrs : undefined,
    childCount: childNodes.length,
    visible: el.tagName === 'HEAD' || el.closest('head') ? false : isVisible(el),
    display: cs.display,
    component: componentNameFor(el) ?? undefined,
  };
  if (childNodes.length === 1 && childNodes[0].nodeType === 3) {
    node.text = textPreview(el, 80);
  }
  nodes[id] = node;
  budget.left--;
  if (!includeChildren) {
    node.truncated = childNodes.length > 0;
    return id;
  }
  const children: NodeId[] = [];
  for (const c of childNodes) {
    if (budget.left <= 0) {
      node.truncated = true;
      break;
    }
    if (c.nodeType === 3) {
      if (childNodes.length === 1) continue; // already shown inline as text
      const tid = idOf(c);
      const t = (c.textContent ?? '').replace(/\s+/g, ' ').trim();
      nodes[tid] = { id: tid, type: 3, text: t.length > 80 ? t.slice(0, 79) + '…' : t, childCount: 0, visible: true };
      children.push(tid);
      budget.left--;
    } else {
      children.push(serializeElement(c as Element, true, budget, nodes));
    }
  }
  node.children = children;
  return id;
}

export function snapshot(maxNodes = 6000): DomSnapshot {
  const nodes: Record<NodeId, DomNode> = {};
  const budget = { left: maxNodes };
  const rootId = serializeElement(document.documentElement, true, budget, nodes);
  return {
    rootId,
    nodes,
    nodeCount: Object.keys(nodes).length,
    truncated: budget.left <= 0,
    url: location.href,
    title: document.title,
  };
}

export function children(id: NodeId): DomNode[] {
  const el = elementOf(id);
  if (!el) return [];
  const nodes: Record<NodeId, DomNode> = {};
  serializeElement(el, true, { left: 1500 }, nodes);
  return Object.values(nodes);
}

/** Find elements by tag, #id, .class, text content, or accessible name. */
export function find(text: string, limit = 50): { id: NodeId; label: string; match: string }[] {
  const q = text.trim();
  if (!q) return [];
  const out: { id: NodeId; label: string; match: string }[] = [];
  const seen = new Set<Element>();
  const push = (el: Element, match: string) => {
    if (seen.has(el) || isIfdyNode(el) || out.length >= limit) return;
    seen.add(el);
    out.push({ id: idOf(el), label: labelFor(el), match });
  };
  // CSS selector first (covers tag, #id, .class, [attr]).
  try {
    document.querySelectorAll(q).forEach((el) => push(el, 'selector'));
  } catch {
    /* not a selector */
  }
  const needle = q.toLowerCase();
  const all = document.body ? document.body.querySelectorAll('*') : [];
  for (const el of all) {
    if (out.length >= limit) break;
    if (isIfdyNode(el)) continue;
    if (el.id.toLowerCase().includes(needle)) push(el, 'id');
    else if (stableClasses(el).some((c) => c.toLowerCase().includes(needle))) push(el, 'class');
    else if (el.children.length === 0 && (el.textContent ?? '').toLowerCase().includes(needle)) push(el, 'text');
    else if (/^(button|a|input|select|textarea)$/i.test(el.tagName) || el.hasAttribute('role')) {
      const name = accessibleName(el).toLowerCase();
      if (name.includes(needle)) push(el, 'accessible name');
    }
  }
  return out;
}
