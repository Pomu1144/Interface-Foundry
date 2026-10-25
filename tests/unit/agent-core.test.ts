import { beforeEach, describe, expect, it } from 'vitest';
import { contrastRatio, coveredProperties, parseColor, parseDeclarations, specificity, splitSelectorList } from '../../src/agent/css-utils';
import { applyPatchSet } from '../../src/agent/patches';
import { redactText, redactUrl, serialize } from '../../src/agent/capture';
import { classSelector, labelFor, uniqueSelector } from '../../src/agent/nodes';
import { isSensitiveField } from '../../src/agent/recorder';

describe('css-utils', () => {
  it('parses declarations without splitting inside functions or strings', () => {
    const d = parseDeclarations('background: url("a;b.png") no-repeat; width: calc(100% - 2px) !important; --x: 1;');
    expect(d).toEqual([
      { property: 'background', value: 'url("a;b.png") no-repeat', important: false },
      { property: 'width', value: 'calc(100% - 2px)', important: true },
      { property: '--x', value: '1', important: false },
    ]);
  });

  it('computes selector specificity', () => {
    expect(specificity('#a .b > c')).toEqual([1, 1, 1]);
    expect(specificity('button.btn.btn--primary:hover')).toEqual([0, 3, 1]);
    expect(specificity(':where(.a) p')).toEqual([0, 0, 1]);
    expect(specificity(':is(#x, .y) a')).toEqual([1, 0, 1]);
    expect(specificity('a::before')).toEqual([0, 0, 2]);
  });

  it('splits selector lists at top level only', () => {
    expect(splitSelectorList('a, :is(b, c), d')).toEqual(['a', ':is(b, c)', 'd']);
  });

  it('expands shorthands for override detection', () => {
    expect(coveredProperties('margin')).toContain('margin-left');
    expect(coveredProperties('color')).toEqual(['color']);
  });

  it('computes WCAG contrast', () => {
    const black = parseColor('rgb(0, 0, 0)')!;
    const white = parseColor('rgb(255, 255, 255)')!;
    expect(contrastRatio(black, white)).toBeCloseTo(21, 0);
    const grey = parseColor('rgb(154, 165, 177)')!; // #9AA5B1 (demo D3)
    expect(contrastRatio(grey, white)).toBeLessThan(3);
  });
});

describe('patch application', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<h1 id="t">Hello</h1><img id="i" src="a.png">';
  });

  it('injects override css and token sheets idempotently', () => {
    applyPatchSet({ css: '#t { color: red !important; }', cssom: [], dom: [], tokens: { '--brand': '#f00' } });
    applyPatchSet({ css: '#t { color: red !important; }', cssom: [], dom: [], tokens: { '--brand': '#f00' } });
    expect(document.querySelectorAll('#__ifdy-overrides').length).toBe(1);
    expect(document.getElementById('__ifdy-overrides')!.textContent).toContain('color: red');
    expect(document.getElementById('__ifdy-tokens')!.textContent).toContain('--brand:#f00');
  });

  it('applies and reverts DOM patches', () => {
    applyPatchSet({ css: '', cssom: [], dom: [{ id: 'a', kind: 'text', selector: '#t', value: 'Bonjour' }, { id: 'b', kind: 'attr', selector: '#i', name: 'src', value: 'b.png' }], tokens: {} });
    expect(document.getElementById('t')!.textContent).toBe('Bonjour');
    expect(document.getElementById('i')!.getAttribute('src')).toBe('b.png');
    applyPatchSet({ css: '', cssom: [], dom: [], tokens: {} });
    expect(document.getElementById('t')!.textContent).toBe('Hello');
    expect(document.getElementById('i')!.getAttribute('src')).toBe('a.png');
  });

  it('reports patches whose targets are missing', () => {
    const r = applyPatchSet({ css: '', cssom: [], dom: [{ id: 'x', kind: 'text', selector: '#missing', value: 'x' }], tokens: {} });
    expect(r.failed).toEqual(['x']);
  });
});

describe('selectors and labels', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="app"><form class="login-form"><button class="btn btn--primary" data-testid="go">Go</button><button class="btn">B</button></form><div class="css-1x2y3z"><span>a</span><span>b</span></div></main>';
  });
  it('prefers ids and test ids, otherwise builds a unique path', () => {
    expect(uniqueSelector(document.querySelector('[data-testid="go"]')!)).toBe('[data-testid="go"]');
    const span = document.querySelectorAll('span')[1];
    const sel = uniqueSelector(span);
    expect(document.querySelectorAll(sel).length).toBe(1);
    expect(document.querySelector(sel)).toBe(span);
  });
  it('ignores generated class names', () => {
    expect(labelFor(document.querySelector('.css-1x2y3z')!)).toBe('div');
    expect(classSelector(document.querySelectorAll('button')[0])).toBe('button.btn.btn--primary');
  });
});

describe('redaction', () => {
  it('redacts secrets in console text and URLs', () => {
    expect(redactText('login password=hunter2 ok')).toBe('login password=[redacted] ok');
    expect(redactUrl('https://x.test/a?token=abc&page=2').url).toBe('https://x.test/a?token=REDACTED&page=2');
    expect(serialize({ user: 'a', password: 'p' })).toBe('{user: a, password: [redacted]}');
  });
  it('detects sensitive fields for masked recording', () => {
    document.body.innerHTML = '<input type="password" id="p"><input name="username" id="u"><input autocomplete="cc-number" id="c">';
    expect(isSensitiveField(document.getElementById('p')!)).toBe(true);
    expect(isSensitiveField(document.getElementById('u')!)).toBe(false);
    expect(isSensitiveField(document.getElementById('c')!)).toBe(true);
  });
});
