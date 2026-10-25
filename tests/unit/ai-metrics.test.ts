import { describe, expect, it } from 'vitest';
import type { NodeInfo, ResponsiveIssue, ViewportContext } from '../../src/shared/types';
import { compareMeasurements, pageOverflowFrom, summarize } from '../../src/modules/ai-debugger/metrics';
import { parseSse } from '../../src/modules/ai-debugger/client';

const vp: ViewportContext = { deviceId: 'surface-duo', deviceName: 'Surface Duo', posture: 'folded', orientation: 'portrait', width: 540, height: 720 };

const issue = (rule: string, evidence: ResponsiveIssue['evidence'], nodeId?: number, selector = '.x'): ResponsiveIssue => ({
  id: rule,
  rule,
  title: rule,
  severity: 'serious',
  message: rule,
  selector,
  nodeId,
  viewport: vp,
  evidence,
  classification: 'suspicious',
});

const info = (x: number, width: number, display = 'flex') => ({ id: 7, rect: { x, y: 0, width, height: 40 }, computed: { display, visibility: 'visible' } }) as unknown as NodeInfo;

describe('measurements', () => {
  it('derives page overflow from audit evidence', () => {
    expect(pageOverflowFrom([issue('horizontal-overflow', { overflowBy: 36 }), issue('horizontal-overflow', { documentWidth: 600, viewportWidth: 540 })])).toBe(60);
    expect(pageOverflowFrom([issue('tap-target', {})])).toBe(0);
  });

  it('reports a fix that removes overflow as improved, with numbers', () => {
    const before = summarize([issue('horizontal-overflow', { overflowBy: 36 }, 7), issue('tap-target', {}, 9)], info(16, 560), vp, null, '.x', 7);
    const after = summarize([issue('tap-target', {}, 9)], info(16, 508), vp, null, '.x', 7);
    expect(before.elementOverflowPx).toBe(36);
    expect(before.hingeOverlapPx).toBeNull();
    const c = compareMeasurements(before, after);
    expect(c.verdict).toBe('improved');
    expect(c.text).toContain('page overflow 36px → 0px');
    expect(c.text).toContain('issues 2 → 1');
  });

  it('detects unchanged and worse results', () => {
    const a = summarize([issue('tap-target', {})], info(0, 100), vp, null, '.x', 7);
    expect(compareMeasurements(a, a).verdict).toBe('unchanged');
    expect(compareMeasurements(a, a).text).toMatch(/no measurable change/);
    const worse = summarize([issue('tap-target', {}), issue('horizontal-overflow', { overflowBy: 12 })], info(0, 100), vp, null, '.x', 7);
    expect(compareMeasurements(a, worse).verdict).toBe('worse');
  });

  it('measures hinge overlap and flags hidden elements', () => {
    const fold = { axis: 'vertical' as const, offset: 540, maskLength: 34, kind: 'hinge' as const };
    const wide = { ...vp, width: 1114, posture: 'expanded' as const };
    const before = summarize([issue('fold-intersection', {}, 7)], info(278, 558), wide, fold, '.x', 7);
    const after = summarize([], info(598, 476), wide, fold, '.x', 7);
    expect(before.hingeOverlapPx).toBe(34);
    const c = compareMeasurements(before, after);
    expect(c.verdict).toBe('improved');
    expect(c.text).toContain('under hinge 34px → 0px');
    const hidden = summarize([], info(0, 0, 'none'), wide, fold, '.x', 7);
    expect(compareMeasurements(after, hidden).deltas.find((d) => d.key === 'visible')?.better).toBe(false);
  });
});

describe('SSE parsing', () => {
  it('parses complete frames and keeps the remainder', () => {
    const { events, rest } = parseSse('event: progress\ndata: {"type":"progress","stage":"queued","message":"ok"}\n\n: ping\n\nevent: result\ndata: {"type":"err');
    expect(events).toEqual([{ type: 'progress', stage: 'queued', message: 'ok' }]);
    expect(rest).toBe('event: result\ndata: {"type":"err');
  });
});
