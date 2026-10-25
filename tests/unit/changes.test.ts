import { describe, expect, it } from 'vitest';
import type { Change, ViewportContext } from '@shared/types';
import {
  buildOverrideCss,
  buildPatchSet,
  changeSummaryMarkdown,
  commit,
  describeChange,
  effectiveChanges,
  makeChange,
  mediaForViewport,
  redo,
  replaceAll,
  undo,
  type History,
} from '@/modules/change-manager/changes';

const vp: ViewportContext = { deviceId: 'surface-duo', deviceName: 'Surface Duo', posture: 'folded', orientation: 'portrait', width: 540, height: 720 };

const style = (selector: string, property: string, after: string, extra: Partial<Change> = {}) =>
  makeChange({ kind: 'style', target: { selector, label: selector }, property, before: 'x', after, viewport: vp, origin: 'inspector', ...extra });

describe('change sets', () => {
  it('keeps only the latest value per target/property/media', () => {
    const a = style('.a', 'width', '10px');
    const b = style('.a', 'width', '20px');
    const c = style('.a', 'width', '30px', { media: '(max-width: 540px)' });
    const eff = effectiveChanges([a, b, c]);
    expect(eff.map((x) => x.after)).toEqual(['20px', '30px']);
  });

  it('generates override CSS grouped by media query', () => {
    const css = buildOverrideCss([style('.a', 'width', '10px'), style('.a', 'color', 'red'), style('.b', 'gap', '4px', { media: '(max-width: 540px)' })]);
    expect(css).toContain('.a {\n  width: 10px !important;\n  color: red !important;\n}');
    expect(css).toContain('@media (max-width: 540px) {\n  .b {\n    gap: 4px !important;\n  }\n}');
    expect(buildOverrideCss([style('.a', 'width', '10px')], false)).toBe('.a {\n  width: 10px;\n}');
  });

  it('maps visibility changes to display:none and drops "shown"', () => {
    const hide = makeChange({ kind: 'visibility', target: { selector: '#x', label: '#x' }, property: 'display', before: 'visible', after: 'hidden', viewport: vp, origin: 'canvas' });
    expect(buildOverrideCss([hide])).toContain('display: none !important');
    const show = { ...hide, id: 'z', after: 'visible' };
    expect(buildOverrideCss([hide, show])).toBe('');
  });

  it('builds a full patch set (css, cssom, dom, tokens)', () => {
    const rule = makeChange({
      kind: 'rule',
      target: { selector: '.btn', label: '.btn', ruleKey: '0:4', ruleSelector: '.btn' },
      property: 'min-width',
      before: '380px',
      after: null,
      viewport: vp,
      origin: 'styles',
    });
    const text = makeChange({ kind: 'text', target: { selector: 'h1', label: 'h1' }, property: 'textContent', before: 'Hi', after: 'Hello', viewport: vp, origin: 'canvas' });
    const attr = makeChange({ kind: 'asset', target: { selector: 'img', label: 'img' }, property: 'src', before: 'a.png', after: 'data:x', viewport: vp, origin: 'assets' });
    const token = makeChange({ kind: 'token', target: { selector: ':root', label: ':root' }, property: '--brand', before: '#000', after: '#f00', viewport: vp, origin: 'tokens' });
    const set = buildPatchSet([style('.a', 'width', '1px'), rule, text, attr, token]);
    expect(set.css).toContain('.a');
    expect(set.cssom).toEqual([{ id: rule.id, ruleKey: '0:4', ruleSelector: '.btn', property: 'min-width', value: null }]);
    expect(set.dom).toEqual([
      { id: text.id, kind: 'text', selector: 'h1', value: 'Hello' },
      { id: attr.id, kind: 'attr', selector: 'img', name: 'src', value: 'data:x' },
    ]);
    expect(set.tokens).toEqual({ '--brand': '#f00' });
  });

  it('builds media queries for the current viewport', () => {
    expect(mediaForViewport(vp, 'at-most')).toBe('(max-width: 540px)');
    expect(mediaForViewport(vp, 'at-least')).toBe('(min-width: 540px)');
  });

  it('describes and summarises changes', () => {
    expect(describeChange(style('.a', 'width', '10px'))).toBe('.a: width x → 10px');
    expect(changeSummaryMarkdown([])).toBe('_No changes._');
    expect(changeSummaryMarkdown([style('.a', 'width', '10px', { experiment: true })])).toContain('🧪');
  });
});

describe('undo / redo', () => {
  const empty: History = { changes: [], undoStack: [], redoStack: [] };
  it('round-trips through undo and redo', () => {
    const a = style('.a', 'width', '1px');
    const b = style('.b', 'width', '2px');
    let h = commit(empty, a);
    h = commit(h, [b]);
    expect(h.changes).toEqual([a, b]);
    h = undo(h);
    expect(h.changes).toEqual([a]);
    h = undo(h);
    expect(h.changes).toEqual([]);
    expect(undo(h)).toBe(h);
    h = redo(redo(h));
    expect(h.changes).toEqual([a, b]);
  });

  it('clears redo on a new commit and supports reset', () => {
    let h = commit(empty, style('.a', 'width', '1px'));
    h = undo(h);
    h = commit(h, style('.c', 'width', '3px'));
    expect(h.redoStack).toEqual([]);
    h = replaceAll(h, []);
    expect(h.changes).toEqual([]);
    expect(undo(h).changes).toHaveLength(1);
  });

  it('treats a grouped commit as one undo step', () => {
    const group = [style('.a', 'flex-basis', '10px'), style('.a', 'flex-grow', '0')];
    const h = undo(commit(empty, group));
    expect(h.changes).toEqual([]);
  });
});
