import type { A11yIssue, IssueSeverity, NodeId, Rect, ViewportContext } from '@shared/types';
import { create } from 'zustand';
import { studio } from '@/store';
import { currentFold, currentViewportContext } from '@/modules/device-simulator/context';
import { previews } from '@/modules/preview-runtime/registry';
import { auditOptions } from '@/modules/responsive-audit/runner';
import { lastScroll } from '@/modules/responsive-audit/scroll';
import { candidateSelector, keyboardTrapIssue, labelToSelector, parseTrap, placeholderIssue, placeholderOnlyCandidates, targetSizeIssue } from './heuristics';

export type TabStop = { id: NodeId; label: string; rect: Rect; visibleFocus: boolean };
export type Trap = { label: string; reason: string; selector: string; nodeId?: NodeId };
export type KeyboardResult = { order: TabStop[]; traps: Trap[]; at: number; viewport: ViewportContext; route: string };

type A11yLab = {
  keyboard: KeyboardResult | null;
  keyboardStatus: 'idle' | 'running' | 'done' | 'error';
  keyboardError?: string;
  /** Numbered tab-order overlay on the canvas. */
  overlay: boolean;
  /** Fresh rects for the overlay (viewport coords at `scroll`). */
  rects: Record<NodeId, Rect | null>;
  rectsScroll: { x: number; y: number };
  axeError?: string;
  route: string | null;
  viewport: ViewportContext | null;
  durationMs: number | null;
};

export const useA11yLab = create<A11yLab>(() => ({
  keyboard: null,
  keyboardStatus: 'idle',
  overlay: false,
  rects: {},
  rectsScroll: { x: 0, y: 0 },
  route: null,
  viewport: null,
  durationMs: null,
}));

export const IMPACT_ORDER: IssueSeverity[] = ['critical', 'serious', 'moderate', 'minor', 'info'];

function primaryConn() {
  const conn = previews.primary();
  if (!conn?.ready) throw new Error('No preview is connected. Open a project first.');
  return conn;
}

async function keyboardRaw() {
  const conn = primaryConn();
  const raw = await conn.call('audit.keyboard', undefined, 20_000);
  const traps: Trap[] = await Promise.all(
    raw.traps.map(async (t) => {
      const { label, reason } = parseTrap(t);
      const selector = labelToSelector(label);
      const nodeId = (await conn.call('dom.resolve', { selector }).catch(() => null)) ?? undefined;
      return { label, reason, selector, nodeId };
    }),
  );
  return { order: raw.order, traps, conn };
}

let kbInflight: Promise<KeyboardResult> | null = null;

/** Tab order, visible-focus check and pointer-only controls on the canvas page. */
export function runKeyboardAudit(): Promise<KeyboardResult> {
  if (kbInflight) return kbInflight;
  kbInflight = (async () => {
    useA11yLab.setState({ keyboardStatus: 'running', keyboardError: undefined });
    try {
      const { order, traps, conn } = await keyboardRaw();
      const result: KeyboardResult = { order, traps, at: Date.now(), viewport: currentViewportContext(), route: studio().currentRoute };
      useA11yLab.setState({
        keyboard: result,
        keyboardStatus: 'done',
        rects: Object.fromEntries(order.map((o) => [o.id, o.rect])),
        rectsScroll: lastScroll.get(conn.id) ?? { x: 0, y: 0 },
      });
      return result;
    } catch (err) {
      useA11yLab.setState({ keyboardStatus: 'error', keyboardError: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      kbInflight = null;
    }
  })();
  return kbInflight;
}

let inflight: Promise<A11yIssue[]> | null = null;

/**
 * axe-core (WCAG 2.0–2.2 A/AA + best practices) on the canvas page, plus IFDY
 * heuristics for things axe accepts: placeholder-only labels, size-only tap
 * targets and pointer-only controls.
 */
export function runA11yAudit(): Promise<A11yIssue[]> {
  if (inflight) return inflight;
  inflight = doRun().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doRun(): Promise<A11yIssue[]> {
  const s = studio();
  const t0 = Date.now();
  s.setAuditStatus({ a11y: 'running' });
  useA11yLab.setState({ axeError: undefined });
  try {
    const conn = primaryConn();
    const viewport = currentViewportContext();
    const issues: A11yIssue[] = [];
    // Sequential on purpose: the keyboard check moves focus, which can change styles axe reads.
    try {
      issues.push(...(await conn.call('audit.a11y', { viewport }, 45_000)));
    } catch (err) {
      useA11yLab.setState({ axeError: err instanceof Error ? err.message : String(err) });
    }

    // D4-style: placeholder is the only label.
    const dom = await conn.call('dom.snapshot', { maxNodes: 8000 }).catch(() => null);
    if (dom) {
      const verified: { selector: string; placeholder: string; nodeId?: NodeId; html?: string }[] = [];
      for (const c of placeholderOnlyCandidates(dom).slice(0, 25)) {
        const info = await conn.call('node.info', { id: c.id }).catch(() => null);
        if (!info) continue;
        const attrs = new Map(info.attrs);
        if (attrs.get('aria-label')?.trim() || attrs.get('aria-labelledby')?.trim() || attrs.get('title')?.trim()) continue;
        const html = `<${info.tag} ${info.attrs.map(([k, v]) => `${k}="${v}"`).join(' ')}>`;
        verified.push({ selector: info.selector || candidateSelector(c), placeholder: c.placeholder, nodeId: c.id, html: html.length > 300 ? html.slice(0, 299) + '…' : html });
      }
      const p = placeholderIssue(verified, viewport);
      if (p) issues.push(p);
    }

    // D5-style: size-only tap targets (no spacing exception).
    const resp = await conn.call('audit.responsive', auditOptions(viewport, currentFold()), 30_000).catch(() => []);
    const t = targetSizeIssue(resp, viewport);
    if (t) issues.push(t);

    // D8-style: pointer-only controls, via the keyboard walk.
    const kb = await runKeyboardAudit().catch(() => null);
    if (kb) {
      const k = keyboardTrapIssue(kb.traps, viewport);
      if (k) issues.push(k);
    }

    issues.sort((a, b) => IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact) || b.nodes.length - a.nodes.length);
    s.setA11yIssues(issues);
    s.setAuditStatus({ a11y: 'done', at: Date.now() });
    useA11yLab.setState({ route: s.currentRoute, viewport, durationMs: Date.now() - t0 });
    return issues;
  } catch (err) {
    s.setAuditStatus({ a11y: 'error', error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
