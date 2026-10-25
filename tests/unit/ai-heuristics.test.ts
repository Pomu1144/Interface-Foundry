import { describe, expect, it } from 'vitest';
import {
  clippingAncestorRule,
  confidence,
  contrastRule,
  crossesFold,
  fixedWidthRule,
  flexShrinkRule,
  foldOverlap,
  heuristicDiagnosis,
  hiddenActionRule,
  hingeRule,
  lineLengthRule,
  nowrapRule,
  offscreenRule,
  postureDiffRule,
  tapTargetRule,
  toPx,
  winning,
} from '../../src/modules/ai-debugger/heuristics';
import { adjustForContrast, contrastRatio, parseColor, rgbToHsl } from '../../src/modules/ai-debugger/color';
import { validateDiagnosis } from '../../src/modules/ai-debugger/schema';
import { ancestor, context, element, hingeContext, rateBannerContext, rect, rule } from './ai-fixtures';

describe('helpers', () => {
  it('parses lengths', () => {
    expect(toPx('560px')).toBe(560);
    expect(toPx('2rem')).toBe(32);
    expect(toPx('1.5em', 20)).toBe(30);
    expect(toPx('auto')).toBeNull();
    expect(toPx('100%')).toBeNull();
    expect(toPx('0')).toBe(0);
  });

  it('finds the winning declaration (important > normal, skips overridden)', () => {
    const ctx = context({
      styles: {
        matched: [rule('.a', [['width', '10px', { overridden: true }]]), rule('.b', [['width', '20px']]), rule('.c', [['width', '30px', { important: true }]])],
        inline: null,
        inherited: [],
        activeMedia: [],
        variables: [],
        inaccessibleSheets: 0,
      },
    });
    expect(winning(ctx, 'width')?.decl.value).toBe('30px');
  });

  it('measures fold overlap and crossing', () => {
    const fold = { axis: 'vertical' as const, offset: 540, maskLength: 34, kind: 'hinge' as const };
    expect(foldOverlap(rect(278, 0, 558, 10), fold)).toBe(34);
    expect(crossesFold(rect(278, 0, 558, 10), fold)).toBe(true);
    expect(crossesFold(rect(600, 0, 300, 10), fold)).toBe(false);
    const crease = { axis: 'vertical' as const, offset: 345, maskLength: 0, kind: 'crease' as const };
    expect(crossesFold(rect(300, 0, 100, 10), crease)).toBe(true);
  });

  it('scores confidence from evidence strength', () => {
    expect(confidence(0.7, { declaration: true, issue: true, measured: true })).toBeGreaterThan(confidence(0.7, { measured: true }));
    expect(confidence(0.7, { contradicted: true })).toBeLessThan(0.7);
    expect(confidence(2, {})).toBeLessThanOrEqual(0.97);
  });
});

describe('fixed width wider than the viewport (D1)', () => {
  it('cites the exact declaration, rule and source line', () => {
    const f = fixedWidthRule.run(rateBannerContext())!;
    expect(f).not.toBeNull();
    expect(f.summary).toContain('.rate-banner { width: 560px }');
    expect(f.summary).toContain('login.css:49');
    expect(f.causes[0].evidence[0]).toBe('styles: .rate-banner { width: 560px } — login.css:49');
    expect(f.causes[0].confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('proposes max-width: 100% (keeps the design width) and a fluid alternative', () => {
    const f = fixedWidthRule.run(rateBannerContext())!;
    expect(f.fixes[0].css).toEqual([{ selector: '.rate-banner', property: 'max-width', value: '100%' }]);
    expect(f.fixes[1].css).toEqual([
      { selector: '.rate-banner', property: 'width', value: 'auto' },
      { selector: '.rate-banner', property: 'max-width', value: '100%' },
    ]);
  });

  it('adds box-sizing for content-box elements with padding', () => {
    const ctx = rateBannerContext();
    ctx.element.computed['box-sizing'] = 'content-box';
    const f = fixedWidthRule.run(ctx)!;
    expect(f.fixes[0].css).toContainEqual({ selector: '.rate-banner', property: 'box-sizing', value: 'border-box' });
  });

  it('scopes the fix to the media query of the causing rule', () => {
    const ctx = rateBannerContext();
    ctx.styles!.matched[0].media = ['(max-width: 699px)'];
    const f = fixedWidthRule.run(ctx)!;
    expect(f.fixes[0].css[0].media).toBe('(max-width: 699px)');
  });

  it('does not fire when the element fits', () => {
    const ctx = context({ element: element({ rect: rect(16, 0, 300, 40) }), ancestors: [ancestor('div.wrap', rect(0, 0, 540, 100))] });
    expect(fixedWidthRule.run(ctx)).toBeNull();
  });

  it('falls back to a lower-confidence cause without a fixed declaration', () => {
    const ctx = rateBannerContext();
    ctx.styles!.matched = [];
    const f = fixedWidthRule.run(ctx)!;
    expect(f.causes[0].confidence).toBeLessThan(0.7);
    expect(f.fixes).toHaveLength(1);
  });
});

describe('flex item refusing to shrink', () => {
  const base = () =>
    context({
      element: element({
        rect: rect(200, 0, 420, 30),
        layout: { display: 'block', parentDisplay: 'flex', flexDirection: 'row', isFlexItem: true, isGridItem: false, isPositioned: false, overflowAncestors: [] },
        computed: { ...element().computed, 'flex-shrink': '0', 'min-width': 'auto' },
        text: 'ACCOUNT-REFERENCE-NUMBER-WITHOUT-BREAKS',
      }),
      ancestors: [ancestor('div.row', rect(0, 0, 540, 30))],
      styles: { matched: [rule('.thing', [['flex-shrink', '0']])], inline: null, inherited: [], activeMedia: [], variables: [], inaccessibleSheets: 0 },
    });

  it('proposes min-width: 0, flex-shrink: 1 and overflow-wrap', () => {
    const f = flexShrinkRule.run(base())!;
    expect(f.fixes[0].css).toEqual([
      { selector: '.thing', property: 'min-width', value: '0' },
      { selector: '.thing', property: 'flex-shrink', value: '1' },
      { selector: '.thing', property: 'overflow-wrap', value: 'anywhere' },
    ]);
    expect(f.causes[0].confidence).toBeGreaterThan(0.8);
  });

  it('handles min-width: auto with long unbreakable content', () => {
    const ctx = base();
    ctx.element.computed['flex-shrink'] = '1';
    ctx.styles!.matched = [];
    const f = flexShrinkRule.run(ctx)!;
    expect(f.fixes[0].css.map((c) => c.property)).toEqual(['min-width', 'overflow-wrap']);
  });

  it('ignores column flex containers', () => {
    const ctx = base();
    ctx.element.layout.flexDirection = 'column';
    expect(flexShrinkRule.run(ctx)).toBeNull();
  });
});

describe('white-space: nowrap', () => {
  it('lets the text wrap', () => {
    const ctx = context({ element: element({ rect: rect(16, 0, 700, 20), computed: { ...element().computed, 'white-space': 'nowrap' } }), ancestors: [ancestor('p.wrap', rect(16, 0, 508, 20))] });
    const f = nowrapRule.run(ctx)!;
    expect(f.fixes[0].css.map((c) => `${c.property}: ${c.value}`)).toEqual(['white-space: normal', 'overflow-wrap: anywhere']);
  });

  it('treats ellipsis truncation as intentional', () => {
    const ctx = context({ element: element({ rect: rect(16, 0, 700, 20), computed: { ...element().computed, 'white-space': 'nowrap', 'text-overflow': 'ellipsis', 'overflow-x': 'hidden' } }), ancestors: [ancestor('p.wrap', rect(16, 0, 508, 20))] });
    const f = nowrapRule.run(ctx)!;
    expect(f.fixes).toHaveLength(0);
    expect(f.assumptions[0]).toMatch(/intentional/);
  });
});

describe('element crossing the hinge (D2)', () => {
  it('reports the measured overlap and the centred container', () => {
    const f = hingeRule.run(hingeContext())!;
    expect(f.facts[0].text).toContain('x 278–836');
    expect(f.facts[0].text).toContain('34px of it is physically not displayed');
    expect(f.facts[1].text).toContain('div.login__panel-inner');
    expect(f.summary).toContain('div.login__panel-inner');
  });

  it('proposes a viewport-segments layout on the page shell with a measured fallback', () => {
    const f = hingeRule.run(hingeContext())!;
    const fix = f.fixes.find((x) => x.id === 'segments-layout')!;
    expect(fix.css).toContainEqual({ selector: 'main.login', property: 'grid-template-columns', value: 'env(viewport-segment-width 0 0) env(viewport-segment-width 1 0)', media: '(horizontal-viewport-segments: 2)' });
    expect(fix.css).toContainEqual({ selector: 'main.login', property: 'column-gap', value: 'calc(env(viewport-segment-left 1 0) - env(viewport-segment-right 0 0))', media: '(horizontal-viewport-segments: 2)' });
    const fallback = '(min-width: 1114px) and (max-width: 1114px)';
    expect(fix.css).toContainEqual({ selector: 'main.login', property: 'grid-template-columns', value: '540px 540px', media: fallback });
    expect(fix.css).toContainEqual({ selector: 'main.login', property: 'column-gap', value: '34px', media: fallback });
  });

  it('offers moving the card onto one segment', () => {
    const f = hingeRule.run(hingeContext())!;
    const fix = f.fixes.find((x) => x.id === 'card-one-segment')!;
    expect(fix.css).toContainEqual({ selector: 'div.login__panel-inner', property: 'margin-left', value: '598px', media: '(min-width: 1114px) and (max-width: 1114px)' });
  });

  it('does not fire without a fold or when the element sits on one screen', () => {
    const ctx = hingeContext();
    ctx.fold = null;
    expect(hingeRule.run(ctx)).toBeNull();
    const ctx2 = hingeContext();
    ctx2.element.rect = rect(600, 600, 400, 48);
    ctx2.issues = [];
    expect(hingeRule.run(ctx2)).toBeNull();
  });

  it('knows when the page already has a segments query', () => {
    const ctx = hingeContext();
    ctx.pageMedia.push('(horizontal-viewport-segments: 2)');
    const f = hingeRule.run(ctx)!;
    expect(f.facts.some((x) => /viewport-segments media query exists/.test(x.text))).toBe(true);
    expect(f.causes.some((c) => /No posture-aware rule/.test(c.text))).toBe(false);
  });
});

describe('accessibility rules', () => {
  it('enlarges a 14×14 checkbox to 24×24 (D5)', () => {
    const ctx = context({
      element: element({ tag: 'input', attrs: [['type', 'checkbox']], rect: rect(40, 400, 14, 14), interactive: true, a11y: { role: 'checkbox', name: 'Remember this device', focusable: true, hidden: false, states: [] } }),
      styles: { matched: [rule('.login-form__remember input', [['width', '14px'], ['height', '14px']], { source: 'login.css:174' })], inline: null, inherited: [], activeMedia: [], variables: [], inaccessibleSheets: 0 },
    });
    const f = tapTargetRule.run(ctx)!;
    expect(f.fixes[0].css).toEqual([
      { selector: '.login-form__remember input', property: 'width', value: '24px' },
      { selector: '.login-form__remember input', property: 'height', value: '24px' },
    ]);
    expect(f.causes[0].evidence[0]).toContain('login.css:174');
  });

  it('gives small buttons a 44px hit area', () => {
    const ctx = context({ element: element({ tag: 'button', rect: rect(0, 0, 20, 20), interactive: true, layout: { ...element().layout, display: 'inline-block' }, a11y: { role: 'button', name: 'x', focusable: true, hidden: false, states: [] } }) });
    expect(tapTargetRule.run(ctx)!.fixes[0].css.map((c) => `${c.property}: ${c.value}`)).toEqual(['min-width: 44px', 'min-height: 44px']);
  });

  it('computes a darker colour with the same hue that reaches 4.5:1 (D3)', () => {
    const ctx = context({
      element: element({ a11y: { role: 'link', name: 'Forgot password?', focusable: true, hidden: false, states: [], contrast: { ratio: 2.5, fg: '#9aa5b1', bg: '#ffffff', aa: false, aaLarge: false, fontSize: 14, bold: false } } }),
      styles: { matched: [rule('.login-form__forgot', [['color', '#9aa5b1']], { source: 'login.css:181' })], inline: null, inherited: [], activeMedia: [], variables: [], inaccessibleSheets: 0 },
    });
    const f = contrastRule.run(ctx)!;
    const css = f.fixes[0].css[0];
    expect(css.selector).toBe('.login-form__forgot');
    expect(css.property).toBe('color');
    const fixed = parseColor(css.value)!;
    expect(contrastRatio(fixed, parseColor('#ffffff')!)).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(rgbToHsl(fixed).h - rgbToHsl(parseColor('#9aa5b1')!).h)).toBeLessThan(6);
    expect(f.facts[1].text).toMatch(/hard-coded/);
  });

  it('limits long lines to 68ch (D7)', () => {
    const r = rect(80, 0, 1300, 72);
    const ctx = context({ viewport: { ...context().viewport, width: 1440, height: 900 }, element: element({ tag: 'p', classes: ['notice__body'], text: 'x'.repeat(400), rect: r, box: { ...element().box, content: r } }), styles: { matched: [rule('.notice__body', [['margin', '0']])], inline: null, inherited: [], activeMedia: [], variables: [], inaccessibleSheets: 0 } });
    const f = lineLengthRule.run(ctx)!;
    expect(f.fixes[0].css).toEqual([{ selector: '.notice__body', property: 'max-width', value: '68ch' }]);
  });
});

describe('visibility and positioning', () => {
  it('shows a primary action hidden by a breakpoint, restoring its display (D6)', () => {
    const ctx = context({
      element: element({ tag: 'button', primary: true, interactive: true, rect: rect(0, 0, 0, 0), computed: { ...element().computed, display: 'none' } }),
      styles: {
        matched: [rule('.statement__download', [['display', 'none']], { media: ['(max-width: 599px)'], source: 'statement.css:8' }), rule('.btn', [['display', 'inline-flex', { overridden: true }]], { source: 'base.css:120' })],
        inline: null,
        inherited: [],
        activeMedia: [],
        variables: [],
        inaccessibleSheets: 0,
      },
    });
    const f = hiddenActionRule.run(ctx)!;
    expect(f.fixes[0].css).toEqual([{ selector: '.statement__download', property: 'display', value: 'inline-flex', media: '(max-width: 599px)' }]);
    expect(f.summary).toContain('@media (max-width: 599px)');
  });

  it('resets an off-screen offset', () => {
    const ctx = context({ element: element({ rect: rect(-400, 0, 300, 40), computed: { ...element().computed, position: 'absolute' } }), styles: { matched: [rule('.drawer', [['left', '-400px']])], inline: null, inherited: [], activeMedia: [], variables: [], inaccessibleSheets: 0 } });
    expect(offscreenRule.run(ctx)!.fixes[0].css).toEqual([{ selector: '.drawer', property: 'left', value: '0' }]);
  });

  it('ignores visually-hidden 1×1 elements', () => {
    const ctx = context({ element: element({ rect: rect(-9999, 0, 1, 1), computed: { ...element().computed, position: 'absolute' } }) });
    expect(offscreenRule.run(ctx)).toBeNull();
  });

  it('finds content clipped by an overflow: hidden ancestor', () => {
    const ctx = context({
      element: element({ rect: rect(10, 0, 600, 40), layout: { ...element().layout, overflowAncestors: [{ label: 'div.card', overflow: 'hidden / hidden' }] } }),
      ancestors: [ancestor('div.card', rect(0, 0, 500, 200))],
    });
    const f = clippingAncestorRule.run(ctx)!;
    expect(f.fixes[0].css).toEqual([{ selector: 'div.card', property: 'overflow-x', value: 'auto' }]);
  });
});

describe('posture comparison', () => {
  it('lists the media-query rules that differ between postures', () => {
    const ctx = hingeContext();
    ctx.comparison = {
      viewport: { ...ctx.viewport, posture: 'folded', width: 540 },
      fold: null,
      method: 'worker-probe',
      element: { found: true, visible: true, rect: rect(32, 600, 476, 48), computed: { display: 'inline-flex', width: '476px' } },
      issues: [],
      issueCounts: { 'horizontal-overflow': 1 },
      rulesOnlyHere: [rule('.login__panel-inner', [['max-width', '640px']], { media: ['(min-width: 700px) and (max-width: 1199px)'], source: 'login.css:244' })],
      rulesOnlyThere: [],
    };
    const f = postureDiffRule.run(ctx)!;
    expect(f.facts.some((x) => x.text.includes('Only here: `.login__panel-inner`'))).toBe(true);
    expect(f.causes[0].text).toContain('@media (min-width: 700px) and (max-width: 1199px)');
  });
});

describe('heuristicDiagnosis', () => {
  it('produces a schema-valid, deterministic result', () => {
    const a = heuristicDiagnosis(rateBannerContext(), 'Why is this overflowing?');
    const b = heuristicDiagnosis(rateBannerContext(), 'Why is this overflowing?');
    expect(a).toEqual(b);
    const v = validateDiagnosis(a);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.repairs).toEqual([]);
    expect(a.proposedFixes[0].id).toBe('fixed-width:cap-width');
    expect(a.inferredCauses[0].confidence).toBeGreaterThanOrEqual(a.inferredCauses.at(-1)!.confidence);
  });

  it('ranks findings by intent', () => {
    const ctx = rateBannerContext();
    ctx.element.a11y = { role: 'note', name: 'Refinance', focusable: false, hidden: false, states: [], contrast: { ratio: 2.1, fg: '#aaaaaa', bg: '#ffffff', aa: false, aaLarge: false, fontSize: 14, bold: false } };
    expect(heuristicDiagnosis(ctx, 'Why is this overflowing?').summary).toMatch(/overflows/);
    expect(heuristicDiagnosis(ctx, 'Suggest an accessible fix').summary).toMatch(/contrast/);
  });

  it('answers the hinge question for the Sign in button', () => {
    const d = heuristicDiagnosis(hingeContext(), 'Why does it look different expanded?');
    expect(d.summary).toMatch(/hinge/);
    expect(d.proposedFixes.some((f) => f.css.some((c) => c.media === '(horizontal-viewport-segments: 2)'))).toBe(true);
    expect(validateDiagnosis(d).ok).toBe(true);
  });

  it('says so honestly when nothing matches', () => {
    const d = heuristicDiagnosis(context(), 'Why is this overflowing?');
    expect(d.summary).toMatch(/No layout or accessibility problem/);
    expect(d.proposedFixes).toHaveLength(0);
    expect(d.assumptions[0]).toMatch(/offline engine/);
  });
});

describe('colour maths', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio(parseColor('#000')!, parseColor('#fff')!)).toBeCloseTo(21, 0);
    expect(contrastRatio(parseColor('rgb(154, 165, 177)')!, parseColor('white')!)).toBeCloseTo(2.5, 1);
  });

  it('lightens on dark backgrounds', () => {
    const r = adjustForContrast(parseColor('#333355')!, parseColor('#101114')!, 4.5)!;
    expect(contrastRatio(parseColor(r.color)!, parseColor('#101114')!)).toBeGreaterThanOrEqual(4.5);
  });
});
