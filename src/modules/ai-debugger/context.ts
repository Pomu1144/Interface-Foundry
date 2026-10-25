import type { MatchedRule, NodeId, NodeInfo, ResponsiveIssue, StylesPayload } from '@shared/types';
import { studio } from '@/store';
import { previews } from '@/modules/preview-runtime/registry';
import { currentFold, currentViewportContext } from '@/modules/device-simulator/context';
import { describeChange } from '@/modules/change-manager/changes';
import type { PreviewConnection } from '@/modules/preview-runtime/connection';
import type { CtxAncestor, CtxComparison, CtxElement, CtxFold, CtxIssue, CtxRule, DiagnosisContext } from './schema';
import { redactContext, type RedactionStats } from './redact';
import { summarize, type Measurement } from './metrics';
import { otherViewportState, probeAt } from './probe';

/**
 * Builds the diagnosis context for the current selection from live agent data:
 * NodeInfo (path, layout, curated computed, box, a11y), matched styles, ancestor
 * boxes, viewport + fold, a fresh responsive audit, console errors and recent
 * edits — optionally plus a measurement at the other posture. The result is
 * redacted before anything else sees it.
 */

const ANCESTOR_PROPS = ['display', 'position', 'width', 'max-width', 'min-width', 'margin-left', 'margin-right', 'padding-left', 'padding-right', 'grid-template-columns', 'flex-direction', 'flex-wrap', 'justify-content', 'column-gap', 'overflow-x', 'overflow-y', 'box-sizing'];
const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary']);
const INTERACTIVE_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'switch', 'textbox', 'combobox', 'option', 'slider']);

export type BuiltContext = {
  context: DiagnosisContext;
  stats: RedactionStats;
  selectorMap: Record<string, string>;
  baseline: Measurement;
  otherBaseline: Measurement | null;
  /** Raw (unredacted) styles, used locally by the Debug view. Never sent. */
  styles: StylesPayload | null;
};

export function classSelectorOf(info: Pick<NodeInfo, 'tag' | 'classes' | 'selector'>): string {
  const stable = info.classes.filter((c) => /^[a-zA-Z_][\w-]*$/.test(c) && !/\d{4,}/.test(c) && !/^(is|has)-/.test(c));
  return stable.length ? info.tag + stable.slice(0, 3).map((c) => `.${c}`).join('') : info.selector;
}

export function isInteractive(info: NodeInfo): boolean {
  if (INTERACTIVE_TAGS.has(info.tag)) return info.tag !== 'a' || info.attrs.some(([n]) => n === 'href');
  return INTERACTIVE_ROLES.has(info.a11y.role) || info.a11y.focusable;
}

export function isPrimary(info: NodeInfo): boolean {
  const attr = (n: string) => info.attrs.find(([k]) => k === n)?.[1];
  if (attr('data-primary') !== undefined || /submit/.test(attr('data-testid') ?? '') || (info.tag === 'button' && attr('type') === 'submit')) return true;
  return info.classes.some((c) => /^(primary|cta|btn-primary|button--primary|btn--primary)$/.test(c));
}

export function toCtxRule(r: MatchedRule, maxDecls = 40): CtxRule {
  return {
    selector: r.selector,
    origin: r.origin,
    source: r.origin === 'inline' ? 'inline' : `${r.source.label}${r.source.line ? `:${r.source.line}` : ''}`,
    media: r.media?.length ? r.media : undefined,
    specificity: r.specificity,
    declarations: r.declarations.slice(0, maxDecls).map((d) => ({
      property: d.property,
      value: d.value.length > 200 ? d.value.slice(0, 199) + '…' : d.value,
      ...(d.important ? { important: true } : {}),
      ...(d.overridden ? { overridden: true } : {}),
      ...(d.disabled ? { disabled: true } : {}),
    })),
  };
}

export function ctxStyles(styles: StylesPayload | null): DiagnosisContext['styles'] {
  if (!styles) return null;
  return {
    matched: styles.matched.filter((r) => r.origin !== 'user-agent').slice(0, 30).map((r) => toCtxRule(r)),
    inline: styles.inline ? toCtxRule(styles.inline) : null,
    inherited: styles.inherited.slice(0, 4).map((h) => ({ from: h.from.label, rules: h.rules.slice(0, 5).map((r) => toCtxRule(r, 12)) })),
    activeMedia: styles.activeMedia.slice(0, 40),
    variables: styles.variables.slice(0, 30).map((v) => ({ name: v.name, value: v.value })),
    inaccessibleSheets: styles.inaccessibleSheets.length,
  };
}

function ruleKey(r: MatchedRule) {
  return `${r.selector}|${r.source.label}|${(r.media ?? []).join('&')}`;
}

/** Rules matching only on one side of a comparison. */
export function ruleDiff(here: StylesPayload | null, there: StylesPayload | null): { onlyHere: CtxRule[]; onlyThere: CtxRule[] } {
  if (!here || !there) return { onlyHere: [], onlyThere: [] };
  const a = new Map(here.matched.filter((r) => r.origin === 'author').map((r) => [ruleKey(r), r]));
  const b = new Map(there.matched.filter((r) => r.origin === 'author').map((r) => [ruleKey(r), r]));
  return {
    onlyHere: [...a].filter(([k]) => !b.has(k)).map(([, r]) => toCtxRule(r, 12)).slice(0, 8),
    onlyThere: [...b].filter(([k]) => !a.has(k)).map(([, r]) => toCtxRule(r, 12)).slice(0, 8),
  };
}

function parentMap(): Map<NodeId, NodeId> {
  const dom = studio().dom;
  const map = new Map<NodeId, NodeId>();
  if (!dom) return map;
  for (const n of Object.values(dom.nodes)) for (const c of n.children ?? []) map.set(c, n.id);
  return map;
}

function isDescendantOf(id: NodeId, ancestor: NodeId, parents: Map<NodeId, NodeId>): boolean {
  let cur = parents.get(id);
  let hops = 0;
  while (cur !== undefined && hops++ < 200) {
    if (cur === ancestor) return true;
    cur = parents.get(cur);
  }
  return false;
}

export function relateIssues(issues: ResponsiveIssue[], info: NodeInfo, parents: Map<NodeId, NodeId>): CtxIssue[] {
  const pathIds = new Set(info.path.map((p) => p.id));
  const out: CtxIssue[] = [];
  for (const i of issues) {
    let relation: CtxIssue['relation'] | null = null;
    if (i.nodeId === info.id || i.selector === info.selector) relation = 'self';
    else if (i.selector === 'document') relation = 'page';
    else if (i.nodeId !== undefined && pathIds.has(i.nodeId)) relation = 'ancestor';
    else if (i.nodeId !== undefined && isDescendantOf(i.nodeId, info.id, parents)) relation = 'descendant';
    if (!relation) continue;
    out.push({ rule: i.rule, title: i.title, severity: i.severity, message: i.message, selector: i.selector, relation, evidence: i.evidence, suggestion: i.suggestion });
  }
  const order = { self: 0, ancestor: 1, descendant: 2, page: 3 };
  return out.sort((a, b) => order[a.relation] - order[b.relation]).slice(0, 14);
}

export function issueCounts(issues: ResponsiveIssue[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const i of issues) c[i.rule] = (c[i.rule] ?? 0) + 1;
  return c;
}

function pickComputed(computed: Record<string, string>, props: string[]) {
  const out: Record<string, string> = {};
  for (const p of props) if (computed[p] !== undefined) out[p] = computed[p];
  return out;
}

export function toCtxElement(info: NodeInfo): CtxElement {
  return {
    selector: info.selector,
    classSelector: classSelectorOf(info),
    label: info.label,
    tag: info.tag,
    path: info.path.map((p) => p.label),
    classes: info.classes,
    attrs: info.attrs,
    text: info.text,
    rect: info.rect,
    box: { content: info.box.content, padding: info.box.padding, border: info.box.border, margin: info.box.margin, boxSizing: info.box.boxSizing, position: info.box.position },
    layout: {
      display: info.layout.display,
      parentDisplay: info.layout.parentDisplay,
      flexDirection: info.layout.flexDirection,
      isFlexItem: info.layout.isFlexItem,
      isGridItem: info.layout.isGridItem,
      isPositioned: info.layout.isPositioned,
      overflowAncestors: info.layout.overflowAncestors.map((a) => ({ label: a.label, overflow: a.overflow })),
    },
    computed: info.computed,
    a11y: {
      role: info.a11y.role,
      name: info.a11y.name,
      focusable: info.a11y.focusable,
      hidden: info.a11y.hidden,
      states: info.a11y.states,
      contrast: info.a11y.contrast ? { ratio: info.a11y.contrast.ratio, fg: info.a11y.contrast.fg, bg: info.a11y.contrast.bg, aa: info.a11y.contrast.aa, aaLarge: info.a11y.contrast.aaLarge, fontSize: info.a11y.contrast.fontSize, bold: info.a11y.contrast.bold } : undefined,
    },
    component: info.component ? { name: info.component.name, source: info.component.source ? `${info.component.source.file}${info.component.source.line ? `:${info.component.source.line}` : ''}` : undefined } : undefined,
    interactive: isInteractive(info),
    primary: isPrimary(info),
  };
}

export function toCtxAncestor(info: NodeInfo): CtxAncestor {
  const dom = studio().dom;
  const node = dom?.nodes[info.id];
  const childCount = node?.children ? node.children.filter((c) => dom!.nodes[c]?.type === 1 && dom!.nodes[c]?.visible).length : undefined;
  return {
    selector: info.selector,
    classSelector: classSelectorOf(info),
    label: info.label,
    tag: info.tag,
    rect: info.rect,
    contentLeft: info.box.content.x,
    contentRight: info.box.content.x + info.box.content.width,
    childCount,
    computed: pickComputed(info.computed, ANCESTOR_PROPS),
  };
}

function connectionFor(): PreviewConnection | undefined {
  const s = studio();
  return previews.get(s.selection.instanceId) ?? previews.primary();
}

export function auditOptionsNow() {
  const st = studio().settings;
  return { viewport: currentViewportContext(), fold: currentFold(), minTapSize: st.minTapSize, minFontSize: st.minFontSize, maxLineLength: st.maxLineLength, ignoreSelectors: st.ignoreSelectors };
}

export type BuildOptions = { compare?: boolean; onStage?: (message: string) => void };

/** Collect, assemble and redact the context for the current selection. */
export async function buildContext(opts: BuildOptions = {}): Promise<BuiltContext> {
  const s = studio();
  const conn = connectionFor();
  const selected = s.selection.info;
  if (!conn?.ready) throw new Error('No preview is connected. Open a project first.');
  if (!selected) throw new Error('Select an element first.');
  opts.onStage?.('Inspecting element and matched styles');
  const info = (await conn.call('node.info', { id: selected.id }).catch(() => null)) ?? selected;
  const ancestorIds = info.path
    .slice(0, -1)
    .reverse()
    .filter((p) => p.label !== 'html')
    .slice(0, 7)
    .map((p) => p.id);
  const audit = auditOptionsNow();
  const [styles, ancestors, issues, breakpoints] = await Promise.all([
    conn.call('node.styles', { id: info.id }).catch(() => null),
    Promise.all(ancestorIds.map((id) => conn.call('node.info', { id }).catch(() => null))),
    conn.call('audit.responsive', audit, 20_000).catch(() => null),
    conn.call('layout.breakpoints').catch(() => []),
  ]);
  const freshIssues = issues ?? s.responsiveIssues.filter((i) => i.viewport.width === audit.viewport.width && i.viewport.height === audit.viewport.height);
  const parents = parentMap();
  const pageMedia = breakpoints.map((b) => b.query).slice(0, 80);

  let comparison: CtxComparison | null = null;
  let otherBaseline: Measurement | null = null;
  if (opts.compare) {
    const other = otherViewportState();
    opts.onStage?.(`Measuring the ${other.label} posture in a hidden preview`);
    try {
      const probe = await probeAt(other.state, info.selector, { withStyles: true });
      const sample = probe.samples[0];
      const diff = ruleDiff(styles, sample.styles);
      const visible = Boolean(sample.info && sample.info.rect.width > 0 && sample.info.rect.height > 0 && sample.info.computed.display !== 'none');
      comparison = {
        viewport: probe.viewport,
        fold: probe.fold as CtxFold | null,
        method: probe.method,
        element: sample.info ? { found: true, visible, rect: sample.info.rect, computed: pickComputed(sample.info.computed, [...ANCESTOR_PROPS, 'font-size', 'visibility', 'height']) } : { found: false, visible: false },
        issues: sample.info ? relateIssues(sample.issues, sample.info, new Map()) : [],
        issueCounts: issueCounts(sample.issues),
        rulesOnlyHere: diff.onlyHere,
        rulesOnlyThere: diff.onlyThere,
      };
      otherBaseline = summarize(sample.issues, sample.info, probe.viewport, probe.fold, info.selector, sample.info?.id);
    } catch {
      comparison = null;
    }
  }

  const notes = [
    'element/ancestors: live DOM geometry and curated computed styles (CSS px, viewport coordinates)',
    `styles: CSSOM of accessible stylesheets${styles?.inaccessibleSheets.length ? `; ${styles.inaccessibleSheets.length} cross-origin sheet(s) not readable` : ''}; source line numbers are approximate`,
    `issues: IFDY responsive audit (DOM geometry heuristics) at ${audit.viewport.width}×${audit.viewport.height}${issues ? '' : ' (cached results; live audit failed)'}`,
    ...(comparison ? [`comparison: ${comparison.method === 'compare-preview' ? 'live compare preview' : 'hidden worker preview'} at ${comparison.viewport.width}×${comparison.viewport.height} with current edits applied`] : []),
    'console: last 20 errors, redacted by the preview agent',
  ];

  const raw: DiagnosisContext = {
    schemaVersion: 1,
    page: { route: s.currentRoute || s.instances[conn.id]?.url || '', title: s.instances[conn.id]?.title ?? '' },
    viewport: audit.viewport,
    fold: audit.fold as CtxFold | null,
    element: toCtxElement(info),
    ancestors: ancestors.filter((a): a is NodeInfo => Boolean(a)).map(toCtxAncestor),
    styles: ctxStyles(styles),
    pageMedia,
    pageOverflowPx: summarize(freshIssues, info, audit.viewport, audit.fold, info.selector, info.id).pageOverflowPx,
    issues: relateIssues(freshIssues, info, parents),
    issueCounts: issueCounts(freshIssues),
    comparison,
    console: s.console
      .filter((e) => e.level === 'error' && (e.instanceId === conn.id || s.instances[e.instanceId]?.role === 'primary'))
      .slice(-20)
      .map((e) => ({ level: e.level, message: e.args.join(' ').slice(0, 400), source: e.source, count: e.count })),
    recentChanges: s.changes.slice(-10).map((c) => `${c.experiment ? '[experiment] ' : ''}${describeChange(c)}`),
    notes,
  };
  const red = redactContext(raw);
  return {
    context: red.context,
    stats: red.stats,
    selectorMap: red.selectorMap,
    baseline: summarize(freshIssues, info, audit.viewport, audit.fold, info.selector, info.id),
    otherBaseline,
    styles,
  };
}
