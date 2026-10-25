import { describe, expect, it } from 'vitest';
import type { DesignToken } from '@shared/types';
import { cssVarFromName, fromDtcg, inferTokenType, parseCssVariables, toCssVariables, toDtcg } from '@/modules/design-tokens/dtcg';

const tok = (name: string, type: DesignToken['type'], value: string, cssVar = cssVarFromName(name), description?: string): DesignToken => ({ id: name, name, type, value, cssVar, description });

const strip = (ts: DesignToken[]) => ts.map(({ id: _id, ...rest }) => rest).sort((a, b) => a.cssVar.localeCompare(b.cssVar));

describe('DTCG export/import', () => {
  const tokens: DesignToken[] = [
    tok('brand', 'color', '#0B2545', '--color-brand', 'Primary navy'),
    tok('color.accent.teal', 'color', '#13a89e'),
    tok('space-4', 'spacing', '16px', '--hl-space-4'),
    tok('radius.md', 'radius', '8px'),
    tok('shadow.card', 'shadow', '0 1px 2px rgba(15, 27, 45, 0.08), 0 8px 24px -8px rgba(15, 27, 45, 0.16)'),
    tok('font.family.body', 'typography', '"Inter", system-ui, sans-serif'),
    tok('font.weight.bold', 'typography', '700'),
    tok('bp.tablet', 'breakpoint', '48rem'),
    tok('z.modal', 'z-index', '1000'),
    tok('link', 'color', 'var(--color-brand)', '--color-link'),
  ];

  it('produces the W3C group structure with $type/$value', () => {
    const doc = toDtcg(tokens) as Record<string, any>;
    expect(doc.color.brand.$type).toBe('color');
    expect(doc.color.brand.$value).toBe('#0B2545');
    expect(doc.color.brand.$description).toBe('Primary navy');
    expect(doc.color.accent.teal.$value).toBe('#13a89e');
    expect(doc.spacing['space-4'].$type).toBe('dimension');
    expect(doc.z.modal.$type).toBe('number');
    expect(doc.z.modal.$value).toBe(1000);
    expect(doc.font.family.body.$type).toBe('fontFamily');
    expect(doc.font.family.body.$value).toEqual(['Inter', 'system-ui', 'sans-serif']);
    expect(Array.isArray(doc.shadow.card.$value)).toBe(true);
    expect(doc.shadow.card.$value[0]).toMatchObject({ offsetX: '0px', offsetY: '1px', blur: '2px', color: 'rgba(15, 27, 45, 0.08)' });
    // var() reference to another token becomes a DTCG alias
    expect(doc.color.link.$value).toBe('{color.brand}');
  });

  it('round-trips losslessly through $extensions', () => {
    const json = JSON.parse(JSON.stringify(toDtcg(tokens)));
    const { tokens: back, warnings } = fromDtcg(json);
    expect(warnings).toEqual([]);
    expect(strip(back)).toEqual(strip(tokens));
  });

  it('applies live value overrides on export', () => {
    const doc = toDtcg(tokens, { '--color-brand': '#112233' }) as Record<string, any>;
    expect(doc.color.brand.$value).toBe('#112233');
  });

  it('imports third-party DTCG with group $type, objects and aliases', () => {
    const { tokens: out, warnings } = fromDtcg({
      color: {
        $type: 'color',
        navy: { $value: '#0b2545' },
        primary: { $value: '{color.navy}' },
        teal: { $value: { colorSpace: 'srgb', components: [0, 0.5, 0.5] } },
      },
      size: { gap: { $type: 'dimension', $value: { value: 1.5, unit: 'rem' } }, radius: { sm: { $type: 'dimension', $value: '4px' } } },
      elevation: { raised: { $type: 'shadow', $value: { color: '#00000033', offsetX: '0px', offsetY: '2px', blur: '6px', spread: '0px' } } },
      layer: { modal: { $type: 'number', $value: 1000 } },
    });
    expect(warnings).toEqual([]);
    const by = Object.fromEntries(out.map((t) => [t.name, t]));
    expect(by['color.navy']).toMatchObject({ type: 'color', value: '#0b2545', cssVar: '--color-navy' });
    expect(by['color.primary'].value).toBe('var(--color-navy)');
    expect(by['color.teal'].value).toBe('#008080');
    expect(by['size.gap']).toMatchObject({ type: 'spacing', value: '1.5rem' });
    expect(by['size.radius.sm'].type).toBe('radius');
    expect(by['elevation.raised']).toMatchObject({ type: 'shadow', value: '0px 2px 6px 0px #00000033' });
    expect(by['layer.modal']).toMatchObject({ type: 'z-index', value: '1000' });
  });

  it('accepts legacy Style Dictionary documents and reports bad input', () => {
    const { tokens: out } = fromDtcg({ color: { base: { red: { value: '#f00', type: 'color' } } } });
    expect(out[0]).toMatchObject({ name: 'color.base.red', value: '#f00', type: 'color' });
    expect(fromDtcg([1, 2]).warnings.length).toBe(1);
    expect(fromDtcg({ a: { $value: '{missing.ref}' } }).warnings[0]).toMatch(/Unresolved alias/);
  });
});

describe('CSS variables export', () => {
  it('writes a grouped :root block', () => {
    const css = toCssVariables([tok('brand', 'color', '#0b2545', '--brand'), tok('gap', 'spacing', '8px', '--gap', 'Base gap')], { '--gap': '12px' });
    expect(css).toContain(':root {');
    expect(css).toContain('  /* Color */\n  --brand: #0b2545;');
    expect(css).toContain('  --gap: 12px; /* Base gap */');
    expect(parseCssVariables(css)).toEqual([
      { name: '--brand', value: '#0b2545' },
      { name: '--gap', value: '12px' },
    ]);
  });
});

describe('type inference', () => {
  it.each([
    ['--hl-color-navy', '#0b2545', 'color'],
    ['--hl-text', 'rgb(15, 27, 45)', 'color'],
    ['--hl-space-4', '16px', 'spacing'],
    ['--hl-radius-md', '8px', 'radius'],
    ['--hl-shadow-card', '0 1px 2px rgba(0,0,0,.1)', 'shadow'],
    ['--hl-font-sans', '"Inter", system-ui, sans-serif', 'typography'],
    ['--hl-font-size-lg', '1.125rem', 'typography'],
    ['--hl-z-modal', '1000', 'z-index'],
    ['--hl-bp-tablet', '48rem', 'breakpoint'],
    ['--hl-ease', 'cubic-bezier(.2,.8,.2,1)', 'other'],
  ])('%s: %s -> %s', (name, value, type) => {
    expect(inferTokenType(name, value)).toBe(type);
  });
});
