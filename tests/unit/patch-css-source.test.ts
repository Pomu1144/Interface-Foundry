import { describe, expect, it } from 'vitest';
import {
  appendEdit,
  applyEdits,
  disableDeclaration,
  editDeclaration,
  findRules,
  insertDeclaration,
  insertIntoAtRule,
  normalizeSelector,
  parseCss,
  ruleBlock,
} from '@/modules/export-engine/css-source';

const CSS = `/* Harborline */
:root {
  --brand: #0b2545; /* navy */
  --icon: url(data:image/svg+xml;utf8,<svg xmlns="x"/>);
}

.btn {
  color: red;
  padding: 4px 8px !important;
}

@media (max-width: 640px) {
  .btn > .icon { margin: 0 }

  @supports (display: grid) {
    .grid { display: grid; }
  }
}

.card {
  padding: 4px;
  &:hover { color: blue; }
  @media (min-width: 900px) { padding: 8px; }
}

a[href='x']:before { content: "a;b}"; }
@font-face { font-family: X; src: url(x.woff2) }
@keyframes spin { from { transform: rotate(0) } }
`;

describe('parseCss', () => {
  const sheet = parseCss(CSS);

  it('finds rules, declarations and offsets', () => {
    const [btn] = findRules(sheet, '.btn');
    expect(btn.declarations.map((d) => [d.property, d.value, d.important])).toEqual([
      ['color', 'red', false],
      ['padding', '4px 8px', true],
    ]);
    expect(CSS.slice(btn.declarations[1].start, btn.declarations[1].end)).toBe('padding: 4px 8px !important;');
    expect(btn.line).toBe(7);
  });

  it('keeps url(...) with semicolons and strings with braces intact', () => {
    const [root] = findRules(sheet, ':root');
    expect(root.declarations.map((d) => d.property)).toEqual(['--brand', '--icon']);
    expect(root.declarations[1].value).toBe('url(data:image/svg+xml;utf8,<svg xmlns="x"/>)');
    const [a] = findRules(sheet, 'a[href="x"]::before');
    expect(a.declarations[0].value).toBe('"a;b}"');
  });

  it('tracks @media / @supports context and nesting', () => {
    expect(findRules(sheet, '.btn>.icon', ['(max-width:640px)'])).toHaveLength(1);
    expect(findRules(sheet, '.btn > .icon')).toHaveLength(0); // media must match
    const [grid] = findRules(sheet, '.grid', ['(max-width: 640px)']);
    expect(grid.supports).toEqual(['(display: grid)']);
    expect(findRules(sheet, '.card:hover')).toHaveLength(1);
    expect(findRules(sheet, '.card', ['(min-width: 900px)'])[0].declarations[0].value).toBe('8px');
  });

  it('ignores @font-face and keyframe blocks for selector lookups', () => {
    expect(findRules(sheet, 'from')).toHaveLength(0);
    expect(sheet.rules.some((r) => r.atBlock === 'font-face')).toBe(true);
  });

  it('survives broken input', () => {
    const broken = parseCss('.a { color: red; .b { color: blue');
    expect(broken.rules.map((r) => r.selector)).toEqual(['.a', '.a .b']);
    expect(parseCss('}}} .x { y: z }').rules[0].selector).toBe('.x');
  });

  it('normalises selectors like the CSSOM', () => {
    expect(normalizeSelector('ul>li  +  li')).toBe('ul > li + li');
    expect(normalizeSelector("input[type=text]")).toBe('input[type="text"]');
    expect(normalizeSelector('p:first-line,a:after')).toBe('p::first-line, a::after');
  });
});

describe('source edits', () => {
  const sheet = parseCss(CSS);

  it('edits a declaration value and keeps !important', () => {
    const [btn] = findRules(sheet, '.btn');
    const out = applyEdits(CSS, [editDeclaration(CSS, btn.declarations[0], 'blue'), editDeclaration(CSS, btn.declarations[1], '6px')]);
    expect(out).toContain('.btn {\n  color: blue;\n  padding: 6px !important;\n}');
  });

  it('disables a declaration by commenting it out', () => {
    const [icon] = findRules(sheet, '.btn > .icon', ['(max-width: 640px)']);
    const out = applyEdits(CSS, [disableDeclaration(CSS, icon.declarations[0])]);
    expect(out).toContain('.btn > .icon { /* margin: 0; */ }');
  });

  it('edits a rule nested inside @media', () => {
    const [nested] = findRules(sheet, '.card', ['(min-width: 900px)']);
    const out = applyEdits(CSS, [editDeclaration(CSS, nested.declarations[0], '12px')]);
    expect(out).toContain('@media (min-width: 900px) { padding: 12px; }');
    expect(out).toContain('.card {\n  padding: 4px;');
  });

  it('inserts declarations into multi-line and single-line rules', () => {
    const [btn] = findRules(sheet, '.btn');
    const [grid] = findRules(sheet, '.grid', ['(max-width: 640px)']);
    const out = applyEdits(CSS, [insertDeclaration(CSS, btn, 'gap', '4px'), insertDeclaration(CSS, grid, 'gap', '2px')]);
    expect(out).toContain('.btn {\n  color: red;\n  padding: 4px 8px !important;\n  gap: 4px;\n}');
    expect(out).toContain('.grid { display: grid; gap: 2px; }');
  });

  it('adds a missing semicolon before inserting', () => {
    const src = '.a {\n  color: red\n}\n';
    const [a] = findRules(parseCss(src), '.a');
    expect(applyEdits(src, [insertDeclaration(src, a, 'gap', '1px')])).toBe('.a {\n  color: red;\n  gap: 1px;\n}\n');
  });

  it('appends rules at the end or into an existing @media block', () => {
    const block = ruleBlock('.new', [['color', 'red']]);
    expect(applyEdits('.a{}\n', [appendEdit('.a{}\n', block)])).toBe('.a{}\n\n.new {\n  color: red;\n}\n');
    const media = sheet.atRules.find((a) => a.name === 'media' && a.prelude === '(max-width: 640px)')!;
    const out = applyEdits(CSS, [insertIntoAtRule(CSS, media, block)!]);
    expect(out).toMatch(/\.grid \{ display: grid; \}\n {2}\}\n\n {2}\.new \{\n {4}color: red;\n {2}\}\n\}/);
    expect(ruleBlock('.x', [['gap', '1px']], { media: '(max-width: 10px)' })).toBe('@media (max-width: 10px) {\n  .x {\n    gap: 1px;\n  }\n}');
  });

  it('rejects overlapping edits', () => {
    expect(() => applyEdits('abcdef', [{ start: 0, end: 3, text: 'x' }, { start: 2, end: 4, text: 'y' }])).toThrow();
  });
});
