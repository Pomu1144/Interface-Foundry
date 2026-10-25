import type { IssueSeverity, ResponsiveIssue, ViewportContext } from '@shared/types';
import { BUILT_IN_DEVICES } from '@/modules/device-simulator/devices';

/**
 * Pure helpers for responsive audit results: cross-viewport classification,
 * grouping, filtering and export. No store or DOM access, so they are unit-tested.
 */

export type ProfileRun = {
  viewport: ViewportContext;
  issues: ResponsiveIssue[];
  /** Which preview produced the result: the user's canvas or the hidden worker. */
  source: 'primary' | 'worker';
  error?: string;
};

export type Classification = ResponsiveIssue['classification'];

export const SEVERITY_ORDER: IssueSeverity[] = ['critical', 'serious', 'moderate', 'minor', 'info'];
export const CLASS_ORDER: Classification[] = ['regression', 'suspicious', 'expected'];

export const CLASS_LABEL: Record<Classification, string> = {
  regression: 'Likely regression',
  suspicious: 'Needs review',
  expected: 'Likely intentional',
};

export const RULE_LABEL: Record<string, string> = {
  'horizontal-overflow': 'Horizontal overflow',
  'clipped-content': 'Clipped content',
  'hidden-primary-action': 'Primary action hidden',
  'offscreen-primary-action': 'Primary action off-screen',
  'fold-intersection': 'Fold / hinge intersection',
  'tap-target': 'Small tap targets',
  'small-text': 'Small text',
  'line-length': 'Long line length',
  'stretched-control': 'Stretched controls',
  overlap: 'Overlapping controls',
  'image-distortion': 'Distorted images',
  'viewport-meta': 'Viewport meta',
};

export function ruleLabel(rule: string): string {
  return RULE_LABEL[rule] ?? rule.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** Stable key for a viewport (device, posture, orientation and size). */
export function viewportKey(v: Pick<ViewportContext, 'deviceId' | 'posture' | 'orientation' | 'width' | 'height'>): string {
  return `${v.deviceId}|${v.posture}|${v.orientation}|${v.width}x${v.height}`;
}

const builtInFoldable = (id: string) => Boolean(BUILT_IN_DEVICES.find((d) => d.id === id)?.expanded);

export function viewportLabel(v: ViewportContext, foldable: (deviceId: string) => boolean = builtInFoldable): string {
  const posture = v.posture === 'expanded' ? ' · expanded' : foldable(v.deviceId) ? ' · folded' : '';
  const orient = v.orientation === 'landscape' ? ' · landscape' : '';
  return `${v.deviceName}${posture}${orient}`;
}

const pairKey = (v: ViewportContext) => `${v.deviceId}|${v.orientation}`;
const issueKey = (i: ResponsiveIssue) => `${i.rule}\u0000${i.selector}`;

/**
 * Classify every issue by comparing the profiles that were audited.
 *
 *  - regression: a task is likely broken (primary action hidden / off-screen,
 *    interactive control split by a physical hinge, controls that start to
 *    overlap in one posture only, or an overflow at every audited viewport).
 *  - suspicious: the layout differs between postures/viewports in a way that is
 *    probably unintended (e.g. the same element overflows in one posture only).
 *  - expected: plain breakpoint behaviour (ellipsis truncation, controls that
 *    stretch on wide layouts).
 *
 * Adds `seenIn` and, for foldables, `onlyIn` evidence. Never mutates the input.
 */
export function classifyIssues(runs: ProfileRun[]): ResponsiveIssue[] {
  const ok = runs.filter((r) => !r.error);
  const presence = new Map<string, Set<string>>();
  for (const run of ok) {
    const vk = viewportKey(run.viewport);
    for (const i of run.issues) {
      const k = issueKey(i);
      const set = presence.get(k) ?? new Set<string>();
      set.add(vk);
      presence.set(k, set);
    }
  }
  const byPair = new Map<string, ProfileRun[]>();
  for (const run of ok) {
    const k = pairKey(run.viewport);
    byPair.set(k, [...(byPair.get(k) ?? []), run]);
  }
  const total = ok.length;

  const out: ResponsiveIssue[] = [];
  for (const run of ok) {
    const vk = viewportKey(run.viewport);
    const partner = (byPair.get(pairKey(run.viewport)) ?? []).find((r) => r !== run && r.viewport.posture !== run.viewport.posture);
    for (const issue of run.issues) {
      const seen = presence.get(issueKey(issue)) ?? new Set([vk]);
      const inPartner = partner ? seen.has(viewportKey(partner.viewport)) : undefined;
      const evidence: ResponsiveIssue['evidence'] = { ...issue.evidence };
      if (total > 1) evidence.seenIn = `${seen.size}/${total} viewports`;
      // Fold intersections only exist in the posture with a fold; saying so adds nothing.
      if (partner && inPartner === false && issue.rule !== 'fold-intersection') evidence.onlyIn = run.viewport.posture;
      out.push({ ...issue, evidence, classification: classifyOne(issue, { seenEverywhere: total > 1 && seen.size === total, partnerHas: inPartner }) });
    }
  }
  return out;
}

function classifyOne(issue: ResponsiveIssue, ctx: { seenEverywhere: boolean; partnerHas: boolean | undefined }): Classification {
  switch (issue.rule) {
    case 'hidden-primary-action':
    case 'offscreen-primary-action':
      return 'regression';
    case 'overlap':
      // Inset actions (e.g. a show-password toggle inside its field) overlap by design.
      return ctx.partnerHas === false ? 'regression' : 'suspicious';
    case 'fold-intersection': {
      const hinge = issue.evidence.kind === 'hinge' && Number(issue.evidence.foldEnd) > Number(issue.evidence.foldStart);
      const control = /control/i.test(issue.title) || issue.severity === 'serious';
      return hinge && control ? 'regression' : 'suspicious';
    }
    case 'horizontal-overflow':
      // The same element overflowing in one posture only: the layout reacts to the posture change.
      if (ctx.partnerHas === false) return 'suspicious';
      return ctx.seenEverywhere ? 'regression' : 'suspicious';
    case 'clipped-content':
      return issue.severity === 'minor' ? 'expected' : 'suspicious';
    case 'stretched-control':
      return 'expected';
    default:
      return 'suspicious';
  }
}

/* ------------------------------------------------------------------ */
/* Filtering & grouping                                                */
/* ------------------------------------------------------------------ */

export type IssueFilter = {
  severities?: IssueSeverity[];
  classification?: Classification | 'all';
  query?: string;
};

export function filterIssues(issues: ResponsiveIssue[], f: IssueFilter): ResponsiveIssue[] {
  const q = (f.query ?? '').trim().toLowerCase();
  return issues.filter((i) => {
    if (f.severities && f.severities.length && !f.severities.includes(i.severity)) return false;
    if (f.classification && f.classification !== 'all' && i.classification !== f.classification) return false;
    if (!q) return true;
    const hay = `${i.title} ${i.message} ${i.selector} ${i.rule} ${i.viewport.deviceName} ${i.suggestion ?? ''}`.toLowerCase();
    return q.split(/\s+/).every((t) => hay.includes(t));
  });
}

export type RuleGroup = { rule: string; label: string; severity: IssueSeverity; issues: ResponsiveIssue[] };
export type ViewportGroup = { key: string; viewport: ViewportContext; label: string; rules: RuleGroup[]; count: number; worst: IssueSeverity };

const sevRank = (s: IssueSeverity) => SEVERITY_ORDER.indexOf(s);
const worstOf = (list: { severity: IssueSeverity }[]): IssueSeverity => list.reduce<IssueSeverity>((w, i) => (sevRank(i.severity) < sevRank(w) ? i.severity : w), 'info');

/** Group issues by viewport, then by rule; most severe rules first, viewports by width. */
export function groupIssues(issues: ResponsiveIssue[]): ViewportGroup[] {
  const groups = new Map<string, ViewportGroup>();
  for (const i of issues) {
    const key = viewportKey(i.viewport);
    let g = groups.get(key);
    if (!g) {
      g = { key, viewport: i.viewport, label: viewportLabel(i.viewport), rules: [], count: 0, worst: 'info' };
      groups.set(key, g);
    }
    let r = g.rules.find((x) => x.rule === i.rule);
    if (!r) {
      r = { rule: i.rule, label: ruleLabel(i.rule), severity: i.severity, issues: [] };
      g.rules.push(r);
    }
    r.issues.push(i);
    g.count++;
  }
  const list = [...groups.values()];
  for (const g of list) {
    for (const r of g.rules) {
      r.issues.sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || CLASS_ORDER.indexOf(a.classification) - CLASS_ORDER.indexOf(b.classification));
      r.severity = worstOf(r.issues);
    }
    g.rules.sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || b.issues.length - a.issues.length || a.label.localeCompare(b.label));
    g.worst = worstOf(g.rules);
  }
  return list.sort((a, b) => a.viewport.width - b.viewport.width || a.label.localeCompare(b.label));
}

export function countBy<K extends string>(issues: ResponsiveIssue[], key: (i: ResponsiveIssue) => K): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const i of issues) out[key(i)] = (out[key(i)] ?? 0) + 1;
  return out;
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export function issuesToJson(issues: ResponsiveIssue[], meta: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      tool: 'IFDY responsive audit',
      scope: 'Automated heuristics on the rendered DOM of each audited viewport. Not a substitute for testing on real devices.',
      generatedAt: new Date().toISOString(),
      ...meta,
      issues: issues.map(({ nodeId: _n, ...rest }) => rest),
    },
    null,
    2,
  );
}

const md = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function issuesToMarkdown(issues: ResponsiveIssue[], title = 'Responsive audit'): string {
  const lines: string[] = [`# ${title}`, '', `_Generated ${new Date().toLocaleString()} by IFDY. Automated heuristics; confirm on real devices._`, ''];
  for (const g of groupIssues(issues)) {
    lines.push(`## ${g.label} — ${g.viewport.width}×${g.viewport.height} (${g.count})`, '');
    for (const r of g.rules) {
      lines.push(`### ${r.label}`, '');
      lines.push('| Severity | Classification | Element | Finding | Suggestion |', '| --- | --- | --- | --- | --- |');
      for (const i of r.issues) {
        lines.push(`| ${i.severity} | ${CLASS_LABEL[i.classification]} | \`${md(i.selector)}\` | ${md(i.message)} | ${md(i.suggestion ?? '')} |`);
      }
      lines.push('');
    }
  }
  if (!issues.length) lines.push('No issues found at the audited viewports.');
  return lines.join('\n');
}
