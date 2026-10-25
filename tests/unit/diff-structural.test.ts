import { describe, expect, it } from 'vitest';
import type { LayoutSnapshotEntry } from '@shared/protocol';
import { crossesFold, structuralDiff, type SnapshotSide } from '@/modules/responsive-diff/structural';

const entry = (selector: string, x: number, y: number, width: number, height: number, extra: Partial<LayoutSnapshotEntry> = {}): LayoutSnapshotEntry => ({
  selector,
  label: selector,
  role: 'generic',
  rect: { x, y, width, height },
  visible: true,
  inViewport: true,
  primary: false,
  ...extra,
});

const folded = (entries: LayoutSnapshotEntry[]): SnapshotSide => ({ entries, viewport: { width: 540, height: 720 } });
const expanded = (entries: LayoutSnapshotEntry[]): SnapshotSide => ({
  entries,
  viewport: { width: 1114, height: 720 },
  fold: { axis: 'vertical', offset: 540, maskLength: 34, kind: 'hinge' },
});

describe('structuralDiff', () => {
  it('classifies moves/resizes, appear/disappear and visibility changes', () => {
    const a = folded([
      entry('h1', 20, 20, 500, 40),
      entry('.nav', 0, 0, 540, 60),
      entry('.drawer-toggle', 480, 10, 40, 40, { role: 'button' }),
      entry('.hint', 20, 600, 200, 20, { visible: false }),
    ]);
    const b = expanded([
      entry('h1', 20, 20, 500, 40), // unchanged
      entry('.nav', 0, 0, 1114, 60), // resized
      entry('.hint', 600, 600, 200, 20), // shown
      entry('.sidebar', 0, 60, 300, 600), // appeared
    ]);
    const { rows, summary } = structuralDiff(a, b);
    const bySel = Object.fromEntries(rows.map((r) => [r.selector, r]));
    expect(summary.unchanged).toBe(1);
    expect(bySel['.nav'].kinds).toEqual(['resized']);
    expect(bySel['.nav'].dw).toBe(574);
    expect(bySel['.drawer-toggle'].kinds).toEqual(['disappeared']);
    expect(bySel['.hint'].kinds).toEqual(['shown']);
    expect(bySel['.sidebar'].kinds).toEqual(['appeared']);
    expect(rows.every((r) => r.classification === 'expected')).toBe(true);
    expect(summary).toMatchObject({ resized: 1, disappeared: 1, shown: 1, appeared: 1, total: 4, suspicious: 0 });
  });

  it('flags controls split by the hinge in the expanded posture', () => {
    const a = folded([entry('[data-testid="login-submit"]', 21, 618, 498, 48, { role: 'button', primary: true })]);
    const b = expanded([entry('[data-testid="login-submit"]', 278, 618, 558, 48, { role: 'button', primary: true })]);
    const { rows } = structuralDiff(a, b, { names: ['folded', 'expanded'] });
    expect(rows[0].classification).toBe('suspicious');
    expect(rows[0].reasons.join(' ')).toMatch(/Split by the 34px hinge in expanded/);
  });

  it('treats native controls without an ARIA role (password inputs) as interactive', () => {
    const a = folded([entry('#login-password', 41, 464, 458, 48, { label: 'input#login-password.input' })]);
    const b = expanded([entry('#login-password', 278, 404, 514, 48, { label: 'input#login-password.input' })]);
    expect(structuralDiff(a, b).rows[0].classification).toBe('suspicious');
    const c = expanded([entry('.card', 278, 404, 514, 48, { label: 'div.card' })]);
    expect(structuralDiff(folded([entry('.card', 41, 464, 458, 48, { label: 'div.card' })]), c).rows[0].classification).toBe('expected');
  });

  it('flags hidden primary actions, off-screen elements and controls shrunk below tap size', () => {
    const a = expanded([
      entry('.statement__download', 600, 100, 220, 44, { role: 'button', primary: true }),
      entry('.rate-banner', 600, 200, 400, 60),
      entry('#remember', 600, 300, 28, 28, { role: 'checkbox' }),
    ]);
    const b = folded([
      entry('.statement__download', 20, 100, 220, 44, { role: 'button', primary: true, visible: false }),
      entry('.rate-banner', 16, 200, 560, 60),
      entry('#remember', 20, 300, 14, 14, { role: 'checkbox' }),
    ]);
    const { rows, summary } = structuralDiff(a, b, { names: ['expanded', 'folded'] });
    const bySel = Object.fromEntries(rows.map((r) => [r.selector, r]));
    expect(bySel['.statement__download'].kinds).toEqual(['hidden']);
    expect(bySel['.statement__download'].reasons[0]).toMatch(/Primary action is not rendered in folded/);
    expect(bySel['.rate-banner'].reasons.join()).toMatch(/past the viewport edge in folded \(x 16–576 of 540px\)/);
    expect(bySel['#remember'].reasons.join()).toMatch(/Shrinks below the 24px tap size in folded/);
    expect(summary.suspicious).toBe(3);
    expect(rows.slice(0, 3).every((r) => r.classification === 'suspicious')).toBe(true);
  });

  it('uses snapshot scroll to compare in viewport coordinates and ignores sub-tolerance jitter', () => {
    const a: SnapshotSide = { entries: [entry('.card', 10, 1010, 100, 100)], viewport: { width: 540, height: 720 }, scroll: { x: 0, y: 1000 } };
    const b: SnapshotSide = { entries: [entry('.card', 11, 11, 101, 100)], viewport: { width: 540, height: 720 }, scroll: { x: 0, y: 0 } };
    expect(structuralDiff(a, b).rows).toHaveLength(0);
  });

  it('detects fold crossings for both axes', () => {
    const v = { axis: 'vertical' as const, offset: 540, maskLength: 34, kind: 'hinge' as const };
    expect(crossesFold({ x: 500, y: 0, width: 41, height: 10 }, v)).toBe(true);
    expect(crossesFold({ x: 574, y: 0, width: 100, height: 10 }, v)).toBe(false);
    expect(crossesFold({ x: 0, y: 0, width: 540, height: 10 }, v)).toBe(false);
    const crease = { axis: 'horizontal' as const, offset: 400, maskLength: 0, kind: 'crease' as const };
    expect(crossesFold({ x: 0, y: 390, width: 10, height: 20 }, crease)).toBe(true);
    expect(crossesFold({ x: 0, y: 400, width: 10, height: 20 }, crease)).toBe(false);
  });
});
