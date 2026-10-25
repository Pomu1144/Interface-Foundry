import { describe, expect, it } from 'vitest';
import { checkCssEdit, DIAGNOSIS_JSON_SCHEMA, extractJson, inferIntent, normaliseConfidence, validateDiagnosis } from '../../src/modules/ai-debugger/schema';

const valid = {
  summary: 'The banner overflows because of width: 560px.',
  observedFacts: [{ text: 'Banner is 560px wide', evidence: ['element.rect.width = 560'] }],
  inferredCauses: [{ text: 'Fixed width', confidence: 0.9, evidence: ['styles.matched: .rate-banner { width: 560px } — login.css:49'] }],
  proposedFixes: [
    {
      id: 'cap',
      title: 'Cap the width',
      rationale: 'max-width wins over width',
      css: [{ selector: '.rate-banner', property: 'max-width', value: '100%', media: null }],
      expectedEffect: 'No overflow',
      affectedElements: ['.rate-banner'],
      risks: [],
      tests: ['scrollWidth <= innerWidth'],
    },
  ],
  assumptions: ['Line numbers are approximate'],
  followUpTests: [],
};

describe('diagnosis schema', () => {
  it('is structured-output compatible (closed objects, everything required)', () => {
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as Record<string, unknown>;
      if (n.type === 'object') {
        expect(n.additionalProperties).toBe(false);
        expect(Object.keys(n.properties as object).sort()).toEqual([...(n.required as string[])].sort());
      }
      for (const v of Object.values(n)) walk(v);
    };
    walk(DIAGNOSIS_JSON_SCHEMA);
    expect(JSON.stringify(DIAGNOSIS_JSON_SCHEMA)).not.toMatch(/minimum|maximum|minLength|maxLength/);
  });

  it('accepts a valid diagnosis unchanged and normalises null media', () => {
    const r = validateDiagnosis(valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.repairs).toEqual([]);
    expect(r.value.proposedFixes[0].css[0]).toEqual({ selector: '.rate-banner', property: 'max-width', value: '100%' });
  });

  it('repairs common model mistakes and reports them', () => {
    const r = validateDiagnosis({
      ...valid,
      observedFacts: [{ text: 'x', evidence: 'single string' }, { evidence: [] }],
      inferredCauses: [{ text: 'a', confidence: '85%', evidence: [] }, { text: 'b', confidence: 140, evidence: [] }, { text: 'c' }],
      proposedFixes: [{ title: 'No id', css: [{ selector: '.a', property: 'Width', value: 'auto !important', media: '@media (max-width: 600px)' }] }],
      assumptions: undefined,
      extra: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.observedFacts).toEqual([{ text: 'x', evidence: ['single string'] }]);
    expect(r.value.inferredCauses.map((c) => c.confidence)).toEqual([1, 0.85, 0.5]);
    expect(r.value.proposedFixes[0].id).toBe('fix-1');
    expect(r.value.proposedFixes[0].css[0]).toEqual({ selector: '.a', property: 'width', value: 'auto', media: '(max-width: 600px)' });
    expect(r.value.assumptions).toEqual([]);
    expect(r.repairs.some((x) => x.includes('unknown field'))).toBe(true);
    expect(r.repairs.length).toBeGreaterThan(5);
  });

  it('rejects CSS that could escape the override stylesheet or load resources', () => {
    expect(checkCssEdit({ selector: '.a', property: 'color', value: 'red; } body { display: none' }).ok).toBe(false);
    expect(checkCssEdit({ selector: '.a { }', property: 'color', value: 'red' }).ok).toBe(false);
    expect(checkCssEdit({ selector: '.a', property: 'background', value: 'url(https://evil.example/?leak)' }).ok).toBe(false);
    expect(checkCssEdit({ selector: '.a', property: 'color', value: 'r\\65 d' }).ok).toBe(false);
    expect(checkCssEdit({ selector: '.a', property: 'color', value: 'red', media: 'screen { .b' }).ok).toBe(false);
    expect(checkCssEdit({ selector: '.a', property: 'x;y', value: 'red' }).ok).toBe(false);
    expect(checkCssEdit({ selector: '.a', property: 'width', value: 'calc(100% - 2rem)', media: '(400px <= width <= 700px)' }).ok).toBe(true);
    expect(checkCssEdit({ selector: '.a > .b:not(.c)', property: '--gap', value: 'env(viewport-segment-width 0 0)' }).ok).toBe(true);
  });

  it('drops fixes whose CSS is entirely unsafe but keeps markup-only fixes', () => {
    const r = validateDiagnosis({
      ...valid,
      proposedFixes: [
        { id: 'bad', title: 'Bad', css: [{ selector: '.a', property: 'background', value: 'url(x)' }] },
        { id: 'markup', title: 'Add a label', css: [] },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.proposedFixes.map((f) => f.id)).toEqual(['markup']);
  });

  it('rejects output that is not a diagnosis', () => {
    expect(validateDiagnosis('not json').ok).toBe(false);
    expect(validateDiagnosis([1, 2]).ok).toBe(false);
    expect(validateDiagnosis({}).ok).toBe(false);
  });

  it('extracts JSON from fences and prose', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":2} hope it helps')).toEqual({ a: 2 });
    expect(extractJson('nothing')).toBeUndefined();
    const r = validateDiagnosis('```json\n' + JSON.stringify(valid) + '\n```');
    expect(r.ok).toBe(true);
  });

  it('normalises confidence values', () => {
    expect(normaliseConfidence(0.42)).toEqual({ value: 0.42, repaired: false });
    expect(normaliseConfidence('70')).toEqual({ value: 0.7, repaired: true });
    expect(normaliseConfidence(-1)).toEqual({ value: 0, repaired: true });
    expect(normaliseConfidence('high')).toBeNull();
  });

  it('infers intents for the suggested prompts', () => {
    expect(inferIntent('Why is this overflowing?')).toBe('overflow');
    expect(inferIntent('Why does it look different expanded?')).toBe('posture');
    expect(inferIntent('Suggest an accessible fix')).toBe('a11y');
    expect(inferIntent('Propose a layout for the expanded posture')).toBe('layout');
    expect(inferIntent('What is this?')).toBe('general');
  });
});
