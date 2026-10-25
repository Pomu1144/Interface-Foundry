import type { CtxAncestor, CtxElement, CtxRule, DiagnosisContext } from '../../src/modules/ai-debugger/schema';

/** Synthetic diagnosis contexts modelled on the Harborline demo defects. */

export const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const zero = { top: 0, right: 0, bottom: 0, left: 0 };

export function element(over: Partial<CtxElement> = {}): CtxElement {
  const r = over.rect ?? rect(16, 100, 300, 40);
  return {
    selector: '[data-testid="thing"]',
    classSelector: 'div.thing',
    label: 'div.thing',
    tag: 'div',
    path: ['body', 'main', 'div.thing'],
    classes: ['thing'],
    attrs: [['class', 'thing']],
    text: 'Hello',
    rect: r,
    box: { content: r, padding: zero, border: zero, margin: zero, boxSizing: 'border-box', position: 'static' },
    layout: { display: 'block', parentDisplay: 'block', isFlexItem: false, isGridItem: false, isPositioned: false, overflowAncestors: [] },
    computed: { display: 'block', width: `${r.width}px`, 'min-width': 'auto', 'max-width': 'none', 'box-sizing': 'border-box', 'font-size': '16px', 'line-height': '24px', 'white-space': 'normal', position: 'static', transform: 'none', 'flex-shrink': '1', 'overflow-x': 'visible', visibility: 'visible', color: 'rgb(0, 0, 0)' },
    a11y: { role: 'generic', name: '', focusable: false, hidden: false, states: [] },
    interactive: false,
    primary: false,
    ...over,
  };
}

export function ancestor(label: string, r: { x: number; y: number; width: number; height: number }, over: Partial<CtxAncestor> = {}): CtxAncestor {
  return { selector: label, classSelector: label, label, tag: label.split('.')[0] || 'div', rect: r, contentLeft: r.x, contentRight: r.x + r.width, computed: { display: 'block' }, ...over };
}

export function rule(selector: string, decls: [string, string, { overridden?: boolean; important?: boolean }?][], over: Partial<CtxRule> = {}): CtxRule {
  return { selector, origin: 'author', source: 'login.css:49', specificity: [0, 1, 0], declarations: decls.map(([property, value, o]) => ({ property, value, ...(o ?? {}) })), ...over };
}

export function context(over: Partial<DiagnosisContext> = {}): DiagnosisContext {
  return {
    schemaVersion: 1,
    page: { route: '#/login', title: 'Harborline' },
    viewport: { deviceId: 'surface-duo', deviceName: 'Surface Duo', posture: 'folded', orientation: 'portrait', width: 540, height: 720 },
    fold: null,
    element: element(),
    ancestors: [],
    styles: { matched: [], inline: null, inherited: [], activeMedia: [], variables: [], inaccessibleSheets: 0 },
    pageMedia: [],
    pageOverflowPx: 0,
    issues: [],
    issueCounts: {},
    comparison: null,
    console: [],
    recentChanges: [],
    notes: [],
    ...over,
  };
}

/** D1: `.rate-banner { width: 560px }` overflowing the 540px folded Duo. */
export function rateBannerContext(): DiagnosisContext {
  const r = rect(16, 120, 560, 86);
  return context({
    element: element({
      selector: '[data-testid="rate-banner"]',
      classSelector: 'aside.rate-banner',
      label: 'aside.rate-banner',
      tag: 'aside',
      classes: ['rate-banner'],
      rect: r,
      box: { content: rect(33, 133, 526, 60), padding: { top: 12, right: 16, bottom: 12, left: 16 }, border: { top: 1, right: 1, bottom: 1, left: 1 }, margin: zero, boxSizing: 'border-box', position: 'static' },
      layout: { display: 'flex', parentDisplay: 'block', isFlexItem: false, isGridItem: false, isPositioned: false, overflowAncestors: [] },
      computed: { ...element().computed, display: 'flex', width: '560px' },
    }),
    ancestors: [ancestor('div.login__panel-inner', rect(16, 80, 508, 600)), ancestor('section.login__panel', rect(0, 56, 540, 700)), ancestor('main.login', rect(0, 56, 540, 700))],
    styles: {
      matched: [rule('.rate-banner', [['display', 'flex'], ['align-items', 'center'], ['width', '560px'], ['margin-inline', 'auto']])],
      inline: null,
      inherited: [],
      activeMedia: ['(max-width: 699px)'],
      variables: [],
      inaccessibleSheets: 0,
    },
    pageOverflowPx: 36,
    issues: [{ rule: 'horizontal-overflow', title: 'Element overflows the viewport', severity: 'serious', message: 'aside.rate-banner extends 36px past the right edge', selector: '[data-testid="rate-banner"]', relation: 'self', evidence: { right: 576, viewportWidth: 540, overflowBy: 36, width: '560px' } }],
    issueCounts: { 'horizontal-overflow': 1 },
  });
}

/** D2: Sign in button split by the 34px Surface Duo hinge at 1114px. */
export function hingeContext(): DiagnosisContext {
  return context({
    viewport: { deviceId: 'surface-duo', deviceName: 'Surface Duo', posture: 'expanded', orientation: 'portrait', width: 1114, height: 720 },
    fold: { axis: 'vertical', offset: 540, maskLength: 34, kind: 'hinge' },
    element: element({
      selector: '[data-testid="login-submit"]',
      classSelector: 'button.btn.btn--primary',
      label: 'button.btn.btn--primary',
      tag: 'button',
      classes: ['btn', 'btn--primary'],
      rect: rect(278, 618, 558, 48),
      interactive: true,
      primary: true,
      a11y: { role: 'button', name: 'Sign in', focusable: true, hidden: false, states: [] },
    }),
    ancestors: [
      ancestor('form.login-form', rect(278, 300, 558, 400)),
      ancestor('div.login-card', rect(237, 260, 640, 480)),
      ancestor('div.login__panel-inner', rect(237, 260, 640, 480), { computed: { 'max-width': '640px', 'margin-left': '237px', 'margin-right': '237px' } }),
      ancestor('section.login__panel', rect(0, 56, 1114, 700), { childCount: 1 }),
      ancestor('main.login', rect(0, 56, 1114, 700), { childCount: 2 }),
    ],
    pageMedia: ['(min-width: 700px) and (max-width: 1199px)', '(min-width: 1200px)'],
    issues: [{ rule: 'fold-intersection', title: 'Control is split by the hinge', severity: 'serious', message: 'button crosses the hinge', selector: '[data-testid="login-submit"]', relation: 'self', evidence: { foldStart: 540, foldEnd: 574, left: 278, right: 836 } }],
    issueCounts: { 'fold-intersection': 4 },
  });
}
