import type { ComponentInfo, SourceLocation } from '@shared/types';

/**
 * Component mapping adapters.
 *  - annotated: data-ifdy-component / data-ifdy-source attributes (exact)
 *  - react:     fiber inspection; exact only when _debugSource is present
 *  - vue:       __vueParentComponent (dev builds)
 *  - svelte:    __svelte_meta (dev builds)
 * When none apply, no mapping is claimed.
 */

const SENSITIVE = /pass|pwd|secret|token|auth|ssn|account|card|cvv|pin|session|cookie|key/i;

function parseSource(raw: string | null | undefined): SourceLocation | undefined {
  if (!raw) return undefined;
  const m = /^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(raw.trim());
  if (!m) return undefined;
  return { file: m[1], line: m[2] ? Number(m[2]) : undefined, column: m[3] ? Number(m[3]) : undefined };
}

function sanitizeProps(props: Record<string, unknown> | null | undefined): Record<string, string> | undefined {
  if (!props) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props).slice(0, 24)) {
    if (k === 'children') continue;
    if (SENSITIVE.test(k)) {
      out[k] = '[redacted]';
      continue;
    }
    if (v === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof v)) {
      const s = String(v);
      out[k] = s.length > 80 ? s.slice(0, 79) + '…' : s;
    } else if (typeof v === 'function') out[k] = 'ƒ()';
    else if (Array.isArray(v)) out[k] = `Array(${v.length})`;
    else out[k] = '{…}';
  }
  return out;
}

type Fiber = {
  type: unknown;
  return: Fiber | null;
  memoizedProps?: Record<string, unknown>;
  _debugSource?: { fileName: string; lineNumber?: number; columnNumber?: number };
  _debugOwner?: Fiber | null;
};

function reactFiber(el: Element): Fiber | null {
  for (const key of Object.keys(el)) {
    if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
      return (el as unknown as Record<string, Fiber>)[key];
    }
  }
  return null;
}

function fiberName(f: Fiber): string | null {
  const t = f.type as { displayName?: string; name?: string; render?: { displayName?: string; name?: string }; type?: { name?: string } } | string | null;
  if (!t || typeof t === 'string') return null;
  const name = t.displayName || t.name || t.render?.displayName || t.render?.name || t.type?.name;
  if (!name || /^(Anonymous|_c\d*)$/.test(name)) return null;
  return name;
}

function annotated(el: Element): ComponentInfo | null {
  const root = el.closest('[data-ifdy-component]');
  if (!root) return null;
  const chain: ComponentInfo['chain'] = [];
  let cur: Element | null = root;
  while (cur) {
    const name = cur.getAttribute('data-ifdy-component');
    if (name) chain.push({ name, source: parseSource(cur.getAttribute('data-ifdy-source')) });
    cur = cur.parentElement?.closest('[data-ifdy-component]') ?? null;
  }
  const name = chain[0].name;
  return {
    framework: 'annotated',
    name,
    chain,
    source: chain[0].source,
    instances: document.querySelectorAll(`[data-ifdy-component="${CSS.escape(name)}"]`).length,
    reliability: chain[0].source ? 'exact' : 'heuristic',
  };
}

function react(el: Element): ComponentInfo | null {
  let node: Element | null = el;
  let fiber: Fiber | null = null;
  while (node && !fiber) {
    fiber = reactFiber(node);
    node = node.parentElement;
  }
  if (!fiber) return null;
  const chain: ComponentInfo['chain'] = [];
  let first: Fiber | null = null;
  for (let f: Fiber | null = fiber; f && chain.length < 12; f = f.return) {
    const name = fiberName(f);
    if (!name) continue;
    if (!first) first = f;
    const src = f._debugSource;
    chain.push({ name, source: src ? { file: src.fileName, line: src.lineNumber, column: src.columnNumber } : undefined });
  }
  if (!chain.length || !first) return null;
  return {
    framework: 'react',
    name: chain[0].name,
    chain,
    source: chain[0].source,
    props: sanitizeProps(first.memoizedProps),
    instances: 0,
    reliability: chain[0].source ? 'exact' : 'heuristic',
  };
}

function vue(el: Element): ComponentInfo | null {
  let node: Element | null = el;
  while (node) {
    const inst = (node as unknown as { __vueParentComponent?: { type: { __name?: string; name?: string; __file?: string }; parent: unknown; props?: Record<string, unknown> } }).__vueParentComponent;
    if (inst) {
      const chain: ComponentInfo['chain'] = [];
      let cur = inst as typeof inst | null;
      while (cur && chain.length < 12) {
        const name = cur.type.__name || cur.type.name;
        if (name) chain.push({ name, source: cur.type.__file ? { file: cur.type.__file } : undefined });
        cur = cur.parent as typeof inst | null;
      }
      if (!chain.length) return null;
      return { framework: 'vue', name: chain[0].name, chain, source: chain[0].source, props: sanitizeProps(inst.props), instances: 0, reliability: chain[0].source ? 'exact' : 'heuristic' };
    }
    node = node.parentElement;
  }
  return null;
}

function svelte(el: Element): ComponentInfo | null {
  let node: Element | null = el;
  while (node) {
    const meta = (node as unknown as { __svelte_meta?: { loc?: { file: string; line: number; column: number } } }).__svelte_meta;
    if (meta?.loc) {
      const name = meta.loc.file.split('/').pop()?.replace(/\.svelte$/, '') ?? 'Component';
      const source = { file: meta.loc.file, line: meta.loc.line + 1, column: meta.loc.column };
      return { framework: 'svelte', name, chain: [{ name, source }], source, instances: 0, reliability: 'exact' };
    }
    node = node.parentElement;
  }
  return null;
}

export function componentFor(el: Element): ComponentInfo | null {
  return annotated(el) ?? react(el) ?? vue(el) ?? svelte(el);
}

/** Cheap name lookup for tree rows (annotation only, no fiber walks). */
export function componentNameFor(el: Element): string | null {
  return el.getAttribute('data-ifdy-component');
}

export function hasReact(): boolean {
  const root = document.getElementById('root') ?? document.body?.firstElementChild;
  return Boolean(root && Object.keys(root).some((k) => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$')));
}
