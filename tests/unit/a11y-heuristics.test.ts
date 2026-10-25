import { describe, expect, it } from 'vitest';
import type { DomNode, DomSnapshot, ResponsiveIssue } from '@shared/types';
import { adjustForContrast, contrastRatio, parseHex, requiredRatio } from '@/modules/accessibility-lab/contrast';
import { candidateSelector, keyboardTrapIssue, labelToSelector, parseTrap, placeholderIssue, placeholderOnlyCandidates, targetSizeIssue, wcagRefs } from '@/modules/accessibility-lab/heuristics';
import { CHECKLIST, checklistProgress } from '@/modules/accessibility-lab/checklist';

function snapshot(nodes: DomNode[]): DomSnapshot {
  return { rootId: nodes[0].id, nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), nodeCount: nodes.length, truncated: false, url: 'x', title: 'x' };
}
const el = (id: number, tag: string, attrs: [string, string][] = [], children: number[] = [], idAttr?: string): DomNode => ({ id, type: 1, tag, attrs, children, childCount: children.length, visible: true, idAttr });

describe('placeholder-only label heuristic (D4)', () => {
  const dom = snapshot([
    el(1, 'form', [], [2, 3, 4, 5, 6, 8, 10, 11]),
    el(2, 'label', [['for', 'login-username']]),
    el(3, 'input', [['type', 'text'], ['placeholder', 'Username']], [], 'login-username'),
    el(4, 'input', [['type', 'text'], ['placeholder', 'Loan number (optional)'], ['data-testid', 'login-loan-number']], [], 'login-loan-number'),
    el(5, 'input', [['placeholder', 'Search'], ['aria-label', 'Search loans']]),
    el(6, 'label', [], [7]),
    el(7, 'input', [['placeholder', 'Wrapped']]),
    el(8, 'input', [['type', 'checkbox'], ['placeholder', 'x']]),
    el(10, 'textarea', [['placeholder', 'Notes'], ['data-testid', 'notes']]),
    el(11, 'input', [['type', 'email']]),
  ]);

  it('finds fields whose only cue is a placeholder', () => {
    const c = placeholderOnlyCandidates(dom);
    expect(c.map((x) => x.id)).toEqual([4, 10]);
    expect(candidateSelector(c[0])).toBe('#login-loan-number');
    expect(candidateSelector(c[1])).toBe('[data-testid="notes"]');
  });

  it('builds a serious issue that cites WCAG 1.3.1/3.3.2', () => {
    const issue = placeholderIssue([{ selector: '#login-loan-number', placeholder: 'Loan number (optional)', nodeId: 4 }])!;
    expect(issue.impact).toBe('serious');
    expect(issue.help).toMatch(/placeholder as its only label/);
    expect(wcagRefs(issue.tags)).toEqual(['1.3.1', '3.3.2', '4.1.2']);
    expect(placeholderIssue([])).toBeNull();
  });
});

describe('target size (D5) and keyboard traps (D8)', () => {
  it('surfaces responsive tap-target findings as a WCAG 2.5.8 issue', () => {
    const tap: ResponsiveIssue = {
      id: 't',
      rule: 'tap-target',
      title: 'Tap target is too small',
      severity: 'moderate',
      message: '',
      selector: '#login-remember',
      viewport: { deviceId: 'surface-duo', deviceName: 'Surface Duo', posture: 'folded', orientation: 'portrait', width: 540, height: 720 },
      evidence: { width: 14, height: 14, minimum: 24 },
      classification: 'suspicious',
    };
    const issue = targetSizeIssue([tap, { ...tap, rule: 'small-text' }])!;
    expect(issue.nodes).toHaveLength(1);
    expect(issue.nodes[0].summary).toMatch(/^14×14px \(minimum 24px\)/);
    expect(issue.impact).toBe('serious');
  });

  it('parses keyboard trap descriptions into selectors', () => {
    const t = parseTrap('div.fake-button looks interactive (pointer cursor) but is not keyboard focusable');
    expect(t).toEqual({ label: 'div.fake-button', reason: 'pointer cursor' });
    expect(labelToSelector(t.label)).toBe('div.fake-button');
    expect(labelToSelector('div#save.primary')).toBe('div#save.primary');
    const issue = keyboardTrapIssue([{ selector: 'div.fake-button', reason: t.reason }])!;
    expect(issue.ruleId).toBe('ifdy-keyboard-unreachable');
    expect(keyboardTrapIssue([])).toBeNull();
  });
});

describe('contrast quick fix (D3)', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio(parseHex('#000')!, parseHex('#fff')!)).toBeCloseTo(21, 5);
    expect(contrastRatio(parseHex('#9aa5b1')!, parseHex('#ffffff')!)).toBeCloseTo(2.5, 1);
    expect(requiredRatio('AA', 14, false)).toBe(4.5);
    expect(requiredRatio('AA', 24, false)).toBe(3);
    expect(requiredRatio('AAA', 19, true)).toBe(4.5);
  });

  it('finds the nearest darker colour that reaches 4.5:1 on white', () => {
    const fix = adjustForContrast('#9aa5b1', '#ffffff', 4.5)!;
    expect(fix.direction).toBe('darker');
    expect(fix.ratio).toBeGreaterThanOrEqual(4.5);
    expect(fix.ratio).toBeLessThan(4.75);
  });

  it('lightens text on dark backgrounds and returns null when impossible', () => {
    const fix = adjustForContrast('#333333', '#111111', 4.5)!;
    expect(fix.direction).toBe('lighter');
    expect(fix.ratio).toBeGreaterThanOrEqual(4.5);
    expect(adjustForContrast('#777777', '#777777', 25)).toBeNull();
  });
});

describe('manual checklist', () => {
  it('covers the required manual checks and reports progress', () => {
    const ids = CHECKLIST.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['keyboard-only', 'screen-reader', 'zoom-200', 'reduced-motion', 'color-independent', 'focus-order']));
    expect(checklistProgress({ 'keyboard-only': { status: 'pass' }, 'zoom-200': { status: 'fail' } })).toEqual({ done: 2, total: CHECKLIST.length, failed: 1 });
  });
});
