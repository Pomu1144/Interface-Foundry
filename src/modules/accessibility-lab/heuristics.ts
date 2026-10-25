import type { A11yIssue, DomSnapshot, NodeId, ResponsiveIssue, ViewportContext } from '@shared/types';

/**
 * IFDY heuristics that complement axe-core for issues its default rules accept:
 *  - placeholder-only labels (axe's `label` rule accepts a placeholder),
 *  - size-only tap targets (axe's `target-size` allows a spacing exception),
 *  - pointer-only controls that the keyboard cannot reach.
 * Pure functions over agent results so they can be unit-tested.
 */

export const HEURISTIC_PREFIX = 'ifdy-';
export const isHeuristic = (i: Pick<A11yIssue, 'ruleId'>) => i.ruleId.startsWith(HEURISTIC_PREFIX);

const NON_TEXT_INPUT = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'checkbox', 'radio', 'range', 'color', 'file']);

export type FieldCandidate = { id: NodeId; tag: string; idAttr?: string; placeholder: string; testId?: string };

/** Form fields that have a placeholder but no label, aria-label, aria-labelledby or title in the DOM snapshot. */
export function placeholderOnlyCandidates(dom: DomSnapshot): FieldCandidate[] {
  const parent = new Map<NodeId, NodeId>();
  const labelFor = new Set<string>();
  for (const n of Object.values(dom.nodes)) {
    for (const c of n.children ?? []) parent.set(c, n.id);
    if (n.tag === 'label') {
      const f = n.attrs?.find(([k]) => k === 'for')?.[1];
      if (f) labelFor.add(f);
    }
  }
  const out: FieldCandidate[] = [];
  for (const n of Object.values(dom.nodes)) {
    if (n.type !== 1 || !n.tag || !/^(input|textarea|select)$/.test(n.tag)) continue;
    const attrs = new Map(n.attrs ?? []);
    const type = (attrs.get('type') ?? 'text').toLowerCase();
    if (n.tag === 'input' && NON_TEXT_INPUT.has(type)) continue;
    const placeholder = attrs.get('placeholder');
    if (!placeholder?.trim()) continue;
    if (attrs.get('aria-label')?.trim() || attrs.get('aria-labelledby')?.trim() || attrs.get('title')?.trim()) continue;
    if (attrs.get('aria-hidden') === 'true' || !n.visible) continue;
    if (n.idAttr && labelFor.has(n.idAttr)) continue;
    let p = parent.get(n.id);
    let wrapped = false;
    while (p !== undefined) {
      if (dom.nodes[p]?.tag === 'label') {
        wrapped = true;
        break;
      }
      p = parent.get(p);
    }
    if (wrapped) continue;
    out.push({ id: n.id, tag: n.tag, idAttr: n.idAttr, placeholder, testId: attrs.get('data-testid') });
  }
  return out;
}

export function candidateSelector(c: FieldCandidate): string {
  if (c.idAttr && /^[A-Za-z][\w-]*$/.test(c.idAttr)) return `#${c.idAttr}`;
  if (c.testId) return `[data-testid="${c.testId}"]`;
  return c.tag;
}

export function placeholderIssue(fields: { selector: string; placeholder: string; nodeId?: NodeId; html?: string }[], viewport?: ViewportContext): A11yIssue | null {
  if (!fields.length) return null;
  return {
    id: 'ifdy-placeholder-label',
    ruleId: 'ifdy-placeholder-label',
    impact: 'serious',
    help: 'Input relies on its placeholder as its only label',
    description:
      'The field has no <label>, aria-label, aria-labelledby or title. A placeholder disappears as soon as the user types and is not reliably announced as a name (WCAG 1.3.1, 3.3.2, 4.1.2). axe-core’s label rule accepts placeholders, so IFDY checks this separately.',
    helpUrl: 'https://www.w3.org/WAI/tutorials/forms/labels/',
    tags: ['ifdy-heuristic', 'wcag131', 'wcag332', 'wcag412'],
    viewport,
    nodes: fields.map((f) => ({
      selector: f.selector,
      html: f.html ?? `<input placeholder="${f.placeholder}">`,
      summary: `Only cue: placeholder “${f.placeholder}”. Add a visible <label for> (or aria-label if a visible label is impossible).`,
      nodeId: f.nodeId,
    })),
  };
}

/** Surface the responsive audit's size-only tap-target findings as an a11y issue (WCAG 2.5.8). */
export function targetSizeIssue(tapIssues: ResponsiveIssue[], viewport?: ViewportContext): A11yIssue | null {
  const list = tapIssues.filter((i) => i.rule === 'tap-target');
  if (!list.length) return null;
  return {
    id: 'ifdy-target-size',
    ruleId: 'ifdy-target-size',
    impact: list.some((i) => i.severity === 'moderate') ? 'serious' : 'moderate',
    help: 'Touch targets are smaller than 24 × 24 CSS px',
    description:
      'Measured on the rendered page without axe-core’s spacing exception. WCAG 2.5.8 (AA) asks for at least 24 × 24 px; 44 × 44 px (2.5.5 AAA and platform guidelines) is the comfortable size on touch devices. A label that wraps or is associated with the control counts toward its hit area.',
    helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html',
    tags: ['ifdy-heuristic', 'wcag258'],
    viewport,
    nodes: list.map((i) => ({
      selector: i.selector,
      html: i.selector,
      summary: `${i.evidence.width}×${i.evidence.height}px (minimum ${i.evidence.minimum}px). ${i.suggestion ?? ''}`.trim(),
      nodeId: i.nodeId,
    })),
  };
}

/** Parse keyboardAudit trap strings ("div.fake-button looks interactive (…) but is not keyboard focusable"). */
export function parseTrap(trap: string): { label: string; reason: string } {
  const m = /^(\S+)\s+looks interactive \(([^)]+)\)/.exec(trap);
  return m ? { label: m[1], reason: m[2] } : { label: trap.split(' ')[0] ?? trap, reason: 'interactive styling' };
}

/** A label such as `div#save.fake-button.primary` is also a valid CSS selector. */
export function labelToSelector(label: string): string {
  return /^[a-z][a-z0-9-]*([#.][A-Za-z_][\w-]*)*$/i.test(label) ? label : label.replace(/[^\w#.-]/g, '');
}

export function keyboardTrapIssue(traps: { selector: string; reason: string; nodeId?: NodeId }[], viewport?: ViewportContext): A11yIssue | null {
  if (!traps.length) return null;
  return {
    id: 'ifdy-keyboard-unreachable',
    ruleId: 'ifdy-keyboard-unreachable',
    impact: 'serious',
    help: 'Pointer-only control cannot be reached with the keyboard',
    description:
      'The element looks or behaves like a control (click handler or pointer cursor) but is not focusable and has no interactive role, so Tab skips it and Enter/Space cannot activate it (WCAG 2.1.1, 4.1.2). Detected heuristically; listeners added with addEventListener are only visible when “Instrument event listeners” is enabled in Settings.',
    helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html',
    tags: ['ifdy-heuristic', 'wcag211', 'wcag412'],
    viewport,
    nodes: traps.map((t) => ({
      selector: t.selector,
      html: t.selector,
      summary: `Detected via ${t.reason}. Use a <button> (or role="button" + tabindex="0" + Enter/Space handling).`,
      nodeId: t.nodeId,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Remediation guidance for common axe rules                           */
/* ------------------------------------------------------------------ */

export const REMEDIATION: Record<string, string> = {
  'color-contrast': 'Darken (or lighten) the text or background until normal text reaches 4.5:1 and large text 3:1. Prefer a design token over a one-off colour.',
  label: 'Give every form field a programmatic name: a <label for>, a wrapping <label>, or aria-labelledby pointing at visible text.',
  'image-alt': 'Add alt text that conveys the image’s purpose, or alt="" if it is decorative.',
  'button-name': 'Give the button discernible text, or an aria-label when it only shows an icon.',
  'link-name': 'Make the link text describe its destination; icon-only links need an aria-label.',
  'aria-allowed-attr': 'Remove ARIA attributes that the element’s role does not support.',
  'aria-required-attr': 'Add the ARIA attributes the role requires (e.g. aria-checked for role="checkbox").',
  'heading-order': 'Do not skip heading levels; nest headings by document structure, not by size.',
  'landmark-one-main': 'Wrap the primary content in a single <main> landmark.',
  region: 'Place all content inside landmarks (header, nav, main, footer) so screen-reader users can navigate by region.',
  'target-size': 'Make the target at least 24 × 24 CSS px, or space it so a 24px circle around it does not overlap other targets.',
  'ifdy-placeholder-label': 'Add a visible <label for="…"> (it can include “(optional)”), then drop or shorten the placeholder.',
  'ifdy-target-size': 'Increase the control or its label hit area (min-width/min-height or padding), e.g. wrap a checkbox and its text in a <label>.',
  'ifdy-keyboard-unreachable': 'Use a native <button type="button">; if impossible add role="button", tabindex="0" and handle Enter and Space.',
};

export function remediationFor(ruleId: string): string | undefined {
  return REMEDIATION[ruleId];
}

/** WCAG success criteria from axe tags, e.g. wcag143 → 1.4.3. */
export function wcagRefs(tags: string[]): string[] {
  return tags
    .map((t) => /^wcag(\d)(\d)(\d+)$/.exec(t))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => `${m[1]}.${m[2]}.${m[3]}`);
}
