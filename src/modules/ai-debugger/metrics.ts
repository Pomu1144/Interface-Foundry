/**
 * Before/after measurements for fixes and experiments. Pure functions.
 */
import type { FoldGeometry, NodeInfo, Rect, ResponsiveIssue, ViewportContext } from '../../shared/types';
import { foldOverlap } from './heuristics';

export type Measurement = {
  viewport: ViewportContext;
  total: number;
  byRule: Record<string, number>;
  elementIssues: number;
  pageOverflowPx: number;
  elementOverflowPx: number;
  /** null when there is no fold in this viewport. */
  hingeOverlapPx: number | null;
  rect: Rect | null;
  visible: boolean;
};

export type MetricDelta = { key: string; label: string; before: number; after: number; unit: 'px' | '' ; better: boolean | null };
export type Verdict = 'improved' | 'unchanged' | 'worse' | 'mixed';
export type MeasurementComparison = { verdict: Verdict; deltas: MetricDelta[]; text: string };

export function pageOverflowFrom(issues: ResponsiveIssue[]): number {
  let max = 0;
  for (const i of issues) {
    if (i.rule !== 'horizontal-overflow') continue;
    const ev = i.evidence;
    const by = typeof ev.overflowBy === 'number' ? ev.overflowBy : typeof ev.documentWidth === 'number' && typeof ev.viewportWidth === 'number' ? ev.documentWidth - ev.viewportWidth : 0;
    max = Math.max(max, by);
  }
  return Math.round(max);
}

export function summarize(issues: ResponsiveIssue[], info: NodeInfo | null, viewport: ViewportContext, fold: FoldGeometry | null, selector: string | null, nodeId?: number | null): Measurement {
  const byRule: Record<string, number> = {};
  for (const i of issues) byRule[i.rule] = (byRule[i.rule] ?? 0) + 1;
  const mine = issues.filter((i) => (nodeId != null && i.nodeId === nodeId) || (selector && i.selector === selector));
  const rect = info?.rect ?? null;
  const visible = Boolean(info && rect && rect.width > 0 && rect.height > 0 && info.computed.display !== 'none' && info.computed.visibility !== 'hidden');
  return {
    viewport,
    total: issues.length,
    byRule,
    elementIssues: mine.length,
    pageOverflowPx: pageOverflowFrom(issues),
    elementOverflowPx: rect && visible ? Math.round(Math.max(0, rect.x + rect.width - viewport.width, -rect.x)) : 0,
    hingeOverlapPx: fold && rect ? (visible ? Math.round(foldOverlap(rect, fold)) : 0) : null,
    rect,
    visible,
  };
}

const METRICS: { key: keyof Measurement; label: string; unit: 'px' | ''; weight: number }[] = [
  { key: 'pageOverflowPx', label: 'page overflow', unit: 'px', weight: 3 },
  { key: 'hingeOverlapPx', label: 'under hinge', unit: 'px', weight: 3 },
  { key: 'elementIssues', label: 'element issues', unit: '', weight: 2 },
  { key: 'total', label: 'issues', unit: '', weight: 1 },
  { key: 'elementOverflowPx', label: 'element overflow', unit: 'px', weight: 2 },
];

/** Compare two measurements (lower is better for every metric) and describe the change with numbers. */
export function compareMeasurements(before: Measurement, after: Measurement): MeasurementComparison {
  const deltas: MetricDelta[] = [];
  let score = 0;
  let better = 0;
  let worse = 0;
  for (const m of METRICS) {
    const b = before[m.key] as number | null;
    const a = after[m.key] as number | null;
    if (b === null || a === null || b === undefined || a === undefined) continue;
    const d: MetricDelta = { key: m.key, label: m.label, before: b, after: a, unit: m.unit, better: a === b ? null : a < b };
    deltas.push(d);
    if (a < b) {
      score += m.weight;
      better++;
    } else if (a > b) {
      score -= m.weight;
      worse++;
    }
  }
  if (before.visible && !after.visible) {
    worse++;
    score -= 2;
    deltas.push({ key: 'visible', label: 'element visible', before: 1, after: 0, unit: '', better: false });
  } else if (!before.visible && after.visible) {
    better++;
    score += 2;
    deltas.push({ key: 'visible', label: 'element visible', before: 0, after: 1, unit: '', better: true });
  }
  const verdict: Verdict = better === 0 && worse === 0 ? 'unchanged' : worse === 0 ? 'improved' : better === 0 ? 'worse' : score > 0 ? 'improved' : score < 0 ? 'worse' : 'mixed';
  const changed = deltas.filter((d) => d.better !== null);
  const fmt = (d: MetricDelta) => (d.key === 'visible' ? (d.after ? 'now visible' : 'now hidden') : `${d.label} ${d.before}${d.unit} → ${d.after}${d.unit}`);
  const text = changed.length
    ? changed.slice(0, 3).map(fmt).join(' · ')
    : `no measurable change (${deltas
        .filter((d) => d.key === 'pageOverflowPx' || d.key === 'total' || d.key === 'hingeOverlapPx')
        .map((d) => `${d.label} ${d.after}${d.unit}`)
        .join(', ')})`;
  return { verdict, deltas, text };
}
