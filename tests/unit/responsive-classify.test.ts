import { describe, expect, it } from 'vitest';
import type { ResponsiveIssue, ViewportContext } from '@shared/types';
import { classifyIssues, filterIssues, groupIssues, issuesToMarkdown, issuesToJson, viewportKey, type ProfileRun } from '@/modules/responsive-audit/classify';

const vp = (posture: 'folded' | 'expanded', width: number, deviceId = 'surface-duo', deviceName = 'Surface Duo'): ViewportContext => ({
  deviceId,
  deviceName,
  posture,
  orientation: 'portrait',
  width,
  height: 720,
});
const folded = vp('folded', 540);
const expanded = vp('expanded', 1114);
const desktop = vp('folded', 1440, 'desktop-1440', 'Desktop 1440');

let n = 0;
const issue = (rule: string, selector: string, viewport: ViewportContext, extra: Partial<ResponsiveIssue> = {}): ResponsiveIssue => ({
  id: `${rule}-${n++}`,
  rule,
  title: rule,
  severity: 'serious',
  message: `${selector} ${rule}`,
  selector,
  viewport,
  evidence: {},
  classification: 'suspicious',
  ...extra,
});

describe('classifyIssues', () => {
  it('marks an overflow present in one posture only as suspicious with onlyIn evidence', () => {
    const runs: ProfileRun[] = [
      { viewport: folded, source: 'primary', issues: [issue('horizontal-overflow', '.rate-banner', folded)] },
      { viewport: expanded, source: 'worker', issues: [] },
    ];
    const [i] = classifyIssues(runs);
    expect(i.classification).toBe('suspicious');
    expect(i.evidence.onlyIn).toBe('folded');
    expect(i.evidence.seenIn).toBe('1/2 viewports');
  });

  it('marks an overflow present at every audited viewport as a regression', () => {
    const runs: ProfileRun[] = [
      { viewport: folded, source: 'primary', issues: [issue('horizontal-overflow', '.wide', folded)] },
      { viewport: expanded, source: 'worker', issues: [issue('horizontal-overflow', '.wide', expanded)] },
      { viewport: desktop, source: 'worker', issues: [issue('horizontal-overflow', '.wide', desktop)] },
    ];
    expect(classifyIssues(runs).every((i) => i.classification === 'regression')).toBe(true);
  });

  it('treats controls split by a hinge and hidden primary actions as regressions', () => {
    const hinge = issue('fold-intersection', '[data-testid="login-submit"]', expanded, {
      title: 'Control is split by the hinge',
      evidence: { kind: 'hinge', foldStart: 540, foldEnd: 574 },
    });
    const crease = issue('fold-intersection', '.card', vp('expanded', 690, 'galaxy-z-fold-5', 'Galaxy Z Fold 5'), {
      title: 'Control straddles the fold crease',
      severity: 'moderate',
      evidence: { kind: 'crease', foldStart: 345, foldEnd: 345 },
    });
    const hidden = issue('hidden-primary-action', '.statement__download', folded);
    const out = classifyIssues([
      { viewport: folded, source: 'primary', issues: [hidden] },
      { viewport: expanded, source: 'worker', issues: [hinge] },
      { viewport: crease.viewport, source: 'worker', issues: [crease] },
    ]);
    expect(out.find((i) => i.selector === '[data-testid="login-submit"]')?.classification).toBe('regression');
    expect(out.find((i) => i.selector === '.statement__download')?.classification).toBe('regression');
    expect(out.find((i) => i.selector === '.card')?.classification).toBe('suspicious');
  });

  it('treats ellipsis truncation and stretched controls as expected breakpoint behaviour', () => {
    const out = classifyIssues([
      {
        viewport: desktop,
        source: 'worker',
        issues: [issue('clipped-content', '.name', desktop, { severity: 'minor' }), issue('stretched-control', 'input', desktop, { severity: 'minor' }), issue('clipped-content', '.box', desktop, { severity: 'moderate' })],
      },
    ]);
    expect(out.map((i) => i.classification)).toEqual(['expected', 'expected', 'suspicious']);
  });

  it('ignores runs that errored and never mutates the input', () => {
    const original = issue('tap-target', '#remember', folded);
    const runs: ProfileRun[] = [
      { viewport: folded, source: 'primary', issues: [original] },
      { viewport: expanded, source: 'worker', issues: [], error: 'timeout' },
    ];
    const out = classifyIssues(runs);
    expect(out).toHaveLength(1);
    expect(out[0].evidence.seenIn).toBeUndefined();
    expect(original.evidence).toEqual({});
  });
});

describe('grouping and filtering', () => {
  const list = classifyIssues([
    {
      viewport: expanded,
      source: 'worker',
      issues: [issue('tap-target', '#a', expanded, { severity: 'moderate' }), issue('fold-intersection', '#b', expanded, { title: 'Control is split by the hinge', evidence: { kind: 'hinge', foldStart: 540, foldEnd: 574 } })],
    },
    { viewport: folded, source: 'primary', issues: [issue('horizontal-overflow', '.rate-banner', folded), issue('tap-target', '#a', folded, { severity: 'moderate' })] },
  ]);

  it('groups by viewport (narrowest first) then by rule (most severe first)', () => {
    const groups = groupIssues(list);
    expect(groups.map((g) => g.viewport.width)).toEqual([540, 1114]);
    expect(groups[1].rules[0].rule).toBe('fold-intersection');
    expect(groups[0].count).toBe(2);
    expect(groups[0].worst).toBe('serious');
    expect(groups[0].key).toBe(viewportKey(folded));
  });

  it('filters by severity, classification and free text', () => {
    expect(filterIssues(list, { severities: ['moderate'] })).toHaveLength(2);
    expect(filterIssues(list, { classification: 'regression' }).map((i) => i.selector)).toEqual(['#b']);
    expect(filterIssues(list, { query: 'banner overflow' })).toHaveLength(1);
    expect(filterIssues(list, { query: 'nothing-like-this' })).toHaveLength(0);
    expect(filterIssues(list, { query: 'rate-banner' })).toHaveLength(1);
    expect(filterIssues(list, { query: 'duo #a' })).toHaveLength(2);
  });

  it('exports markdown and json', () => {
    const mdText = issuesToMarkdown(list);
    expect(mdText).toContain('## Surface Duo · folded — 540×720');
    expect(mdText).toContain('`.rate-banner`');
    const json = JSON.parse(issuesToJson(list, { route: '#/login' }));
    expect(json.route).toBe('#/login');
    expect(json.issues).toHaveLength(4);
  });
});
