import { describe, expect, it } from 'vitest';
import type { MatchedRule, NodeInfo, ResponsiveIssue, StylesPayload } from '../../src/shared/types';
import { classSelectorOf, relateIssues, ruleDiff, toCtxRule } from '../../src/modules/ai-debugger/context';

const matched = (selector: string, media?: string[]): MatchedRule => ({
  key: `0:${selector}`,
  selector,
  origin: 'author',
  media,
  specificity: [0, 1, 0],
  source: { label: 'login.css', line: 45, sheetIndex: 0 },
  declarations: [{ property: 'max-width', value: '640px', important: false, overridden: false, modified: true }],
  order: 1,
});
const styles = (rules: MatchedRule[]) => ({ nodeId: 1, inline: null, matched: rules, inherited: [], variables: [], activeMedia: [], inaccessibleSheets: [] }) as StylesPayload;

describe('context builder helpers', () => {
  it('derives stable class selectors', () => {
    expect(classSelectorOf({ tag: 'button', classes: ['btn', 'btn--primary', 'is-loading', 'css-1a2b3c4d'], selector: '#x' })).toBe('button.btn.btn--primary');
    expect(classSelectorOf({ tag: 'div', classes: [], selector: '[data-testid="x"]' })).toBe('[data-testid="x"]');
  });

  it('maps matched rules with file:line and drops internal flags', () => {
    const r = toCtxRule(matched('.login__panel-inner', ['(min-width: 700px) and (max-width: 1199px)']));
    expect(r).toEqual({ selector: '.login__panel-inner', origin: 'author', source: 'login.css:45', media: ['(min-width: 700px) and (max-width: 1199px)'], specificity: [0, 1, 0], declarations: [{ property: 'max-width', value: '640px' }] });
  });

  it('diffs rules between postures', () => {
    const d = ruleDiff(styles([matched('.a'), matched('.b', ['(min-width: 700px)'])]), styles([matched('.a'), matched('.c', ['(max-width: 699px)'])]));
    expect(d.onlyHere.map((r) => r.selector)).toEqual(['.b']);
    expect(d.onlyThere.map((r) => r.selector)).toEqual(['.c']);
  });

  it('relates audit issues to the selected element', () => {
    const info = { id: 5, selector: '.card', path: [{ id: 1, label: 'body' }, { id: 3, label: 'main' }, { id: 5, label: 'div.card' }] } as unknown as NodeInfo;
    const parents = new Map([[9, 7], [7, 5]]);
    const mk = (rule: string, nodeId: number | undefined, selector: string) => ({ id: rule, rule, title: rule, severity: 'serious', message: rule, selector, nodeId, viewport: {} as never, evidence: {}, classification: 'suspicious' }) as ResponsiveIssue;
    const out = relateIssues([mk('page', undefined, 'document'), mk('desc', 9, '.inner'), mk('anc', 3, 'main'), mk('self', 5, '.card'), mk('other', 42, '.x')], info, parents);
    expect(out.map((i) => `${i.rule}:${i.relation}`)).toEqual(['self:self', 'anc:ancestor', 'desc:descendant', 'page:page']);
  });
});
