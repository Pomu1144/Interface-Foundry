/**
 * Offline heuristic engine ("provider: heuristic").
 *
 * Deterministic rules over the redacted diagnosis context (NodeInfo, matched
 * styles, responsive issues, fold geometry) that produce the same structured
 * result as the model providers, with ready-to-apply CSS. Every rule is a pure
 * function so it can be unit-tested on synthetic fixtures.
 */
import { adjustForContrast, parseColor } from './color';
import type {
  CssEdit,
  CtxAncestor,
  CtxDeclaration,
  CtxFold,
  CtxRule,
  Diagnosis,
  DiagnoseIntent,
  DiagnosisContext,
  InferredCause,
  ObservedFact,
  ProposedFix,
} from './schema';
import { inferIntent } from './schema';

export type Finding = {
  rule: string;
  /** Intents this finding answers; drives ranking. */
  topics: DiagnoseIntent[];
  /** 0..1 — how much the finding matters (severity of the defect). */
  weight: number;
  summary: string;
  facts: ObservedFact[];
  causes: InferredCause[];
  fixes: ProposedFix[];
  assumptions: string[];
  tests: string[];
};

export type HeuristicRule = { id: string; title: string; run: (ctx: DiagnosisContext) => Finding | null };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export const r0 = (n: number) => Math.round(n);

/** Parse a CSS length to px (px, rem/em at 16px, plain 0). Returns null for keywords/percentages. */
export function toPx(value: string | undefined, fontSize = 16): number | null {
  if (!value) return null;
  const m = /^\s*(-?\d*\.?\d+)(px|rem|em)?\s*$/i.exec(value);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!m[2]) return n === 0 ? 0 : null;
  const unit = m[2].toLowerCase();
  return unit === 'px' ? n : unit === 'rem' ? n * 16 : n * fontSize;
}

const COVERS: Record<string, string[]> = {
  width: ['width', 'inline-size'],
  'min-width': ['min-width', 'min-inline-size'],
  'max-width': ['max-width', 'max-inline-size'],
  height: ['height', 'block-size'],
  'min-height': ['min-height', 'min-block-size'],
  'flex-shrink': ['flex-shrink', 'flex'],
  'overflow-x': ['overflow-x', 'overflow'],
  'white-space': ['white-space', 'text-wrap-mode'],
  left: ['left', 'inset', 'inset-inline', 'inset-inline-start'],
  right: ['right', 'inset', 'inset-inline', 'inset-inline-end'],
  'margin-left': ['margin-left', 'margin', 'margin-inline', 'margin-inline-start'],
  'margin-right': ['margin-right', 'margin', 'margin-inline', 'margin-inline-end'],
  transform: ['transform', 'translate'],
  display: ['display'],
  color: ['color'],
  visibility: ['visibility'],
};

export type Winning = { rule: CtxRule; decl: CtxDeclaration };

/** The declaration that wins the cascade for `property` (inline first, then matched rules by priority). */
export function winning(ctx: DiagnosisContext, property: string): Winning | null {
  if (!ctx.styles) return null;
  const props = COVERS[property] ?? [property];
  const rules = [...(ctx.styles.inline ? [ctx.styles.inline] : []), ...ctx.styles.matched];
  const important: Winning[] = [];
  const normal: Winning[] = [];
  for (const rule of rules) {
    for (const decl of rule.declarations) {
      if (!props.includes(decl.property) || decl.overridden || decl.disabled) continue;
      (decl.important ? important : normal).push({ rule, decl });
    }
  }
  return important[0] ?? normal[0] ?? null;
}

/** All (including overridden) declarations for a property, in cascade order. */
export function declarations(ctx: DiagnosisContext, property: string): Winning[] {
  if (!ctx.styles) return [];
  const props = COVERS[property] ?? [property];
  const rules = [...(ctx.styles.inline ? [ctx.styles.inline] : []), ...ctx.styles.matched];
  const out: Winning[] = [];
  for (const rule of rules) for (const decl of rule.declarations) if (props.includes(decl.property) && !decl.disabled) out.push({ rule, decl });
  return out;
}

export function cite(w: Winning): string {
  const media = w.rule.media?.length ? ` @media ${w.rule.media.join(' and ')}` : '';
  return `styles: ${w.rule.selector} { ${w.decl.property}: ${w.decl.value}${w.decl.important ? ' !important' : ''} } — ${w.rule.source}${media}`;
}

/** Selector a fix should target for a declaration: the rule's own selector (inline → the element). */
export function fixSelector(ctx: DiagnosisContext, w: Winning | null): string {
  if (!w || w.rule.origin === 'inline' || w.rule.origin === 'override' || w.rule.origin === 'user-agent') return ctx.element.classSelector || ctx.element.selector;
  return w.rule.selector;
}

/** A media query equivalent to the rule's conditions, '' for none, null when not expressible as one @media. */
export function ruleMedia(rule: CtxRule | undefined): string | null {
  const list = (rule?.media ?? []).filter((m) => !m.startsWith('@container'));
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  if (list.some((m) => /,/.test(m))) return null;
  return list.join(' and ');
}

const edit = (selector: string, property: string, value: string, media?: string | null): CssEdit => (media ? { selector, property, value, media } : { selector, property, value });

const rightOf = (r: { x: number; width: number }) => r.x + r.width;

function rectText(r: { x: number; y: number; width: number; height: number }) {
  return `x ${r0(r.x)}–${r0(r.x + r.width)}, y ${r0(r.y)}–${r0(r.y + r.height)} (${r0(r.width)}×${r0(r.height)})`;
}

function vpText(ctx: DiagnosisContext) {
  const v = ctx.viewport;
  return `${v.deviceName}${v.posture === 'expanded' ? ' expanded' : ''} ${v.width}×${v.height}`;
}

function hasLineNumbers(w: Winning | null) {
  return Boolean(w && /:\d+$/.test(w.rule.source));
}

/** Overlap of a rect with the fold band along the fold axis, in px. */
export function foldOverlap(rect: { x: number; y: number; width: number; height: number }, fold: CtxFold): number {
  const start = fold.offset;
  const end = fold.offset + Math.max(0, fold.maskLength);
  const [a, b] = fold.axis === 'vertical' ? [rect.x, rect.x + rect.width] : [rect.y, rect.y + rect.height];
  if (fold.maskLength <= 0) return a < start && b > start ? 1 : 0;
  return Math.max(0, Math.min(b, end) - Math.max(a, start));
}

export function crossesFold(rect: { x: number; y: number; width: number; height: number }, fold: CtxFold): boolean {
  const start = fold.offset;
  const end = fold.offset + Math.max(0, fold.maskLength);
  const [a, b] = fold.axis === 'vertical' ? [rect.x, rect.x + rect.width] : [rect.y, rect.y + rect.height];
  if (rect.width <= 0 || rect.height <= 0) return false;
  return fold.maskLength > 0 ? a < end && b > start : a < start - 0.5 && b > start + 0.5;
}

function issueFor(ctx: DiagnosisContext, rule: string, relation: 'self' | 'ancestor' | 'descendant' | 'page' | 'any' = 'self') {
  return ctx.issues.find((i) => i.rule === rule && (relation === 'any' || i.relation === relation));
}

function issueCite(i: { rule: string; relation: string; evidence: Record<string, unknown> }) {
  const ev = Object.entries(i.evidence)
    .slice(0, 5)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  return `issues: ${i.rule} (${i.relation})${ev ? ` ${ev}` : ''}`;
}

/** Confidence from evidence strength. */
export function confidence(base: number, signals: { declaration?: boolean; issue?: boolean; measured?: boolean; contradicted?: boolean }): number {
  let c = base;
  if (signals.declaration) c += 0.12;
  if (signals.issue) c += 0.06;
  if (signals.measured) c += 0.04;
  if (signals.contradicted) c -= 0.25;
  return Math.round(Math.min(0.97, Math.max(0.15, c)) * 100) / 100;
}

const INLINE_DISPLAYS = new Set(['inline', 'contents']);

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

/** Fixed width / min-width wider than the viewport or container. */
export const fixedWidthRule: HeuristicRule = {
  id: 'fixed-width',
  title: 'Fixed width wider than the viewport',
  run(ctx) {
    const el = ctx.element;
    const vw = ctx.viewport.width;
    const parent = ctx.ancestors[0];
    const right = rightOf(el.rect);
    const overVp = right - vw;
    const available = parent ? Math.min(vw, parent.contentRight) - Math.max(0, parent.contentLeft) : vw;
    const overParent = parent ? right - parent.contentRight : overVp;
    const issue = issueFor(ctx, 'horizontal-overflow');
    if (overVp <= 1 && overParent <= 1 && !issue) return null;
    const fs = toPx(el.computed['font-size']) ?? 16;
    const candidates = (['width', 'min-width'] as const)
      .map((p) => winning(ctx, p))
      .filter((w): w is Winning => {
        if (!w) return false;
        const px = toPx(w.decl.value, fs);
        return px !== null && px > available + 0.5;
      });
    const w = candidates[0] ?? null;
    const computedW = toPx(el.computed.width) ?? el.rect.width;
    if (!w && computedW <= available + 0.5) return null;
    const declared = w ? toPx(w.decl.value, fs)! : computedW;
    const sel = fixSelector(ctx, w);
    const media = w ? ruleMedia(w.rule) : '';
    const contentBox = el.computed['box-sizing'] === 'content-box' && (el.box.padding.left + el.box.padding.right + el.box.border.left + el.box.border.right) > 0;
    const facts: ObservedFact[] = [
      {
        text: `Its right edge is at x ${r0(right)}${overVp > 1 ? `, ${r0(overVp)}px past the ${vw}px viewport` : `, ${r0(overParent)}px past its container`}.`,
        evidence: [`element.rect: ${rectText(el.rect)}`, `viewport: ${vpText(ctx)}`],
      },
    ];
    if (parent) facts.push({ text: `Its container ${parent.label} has a ${r0(parent.contentRight - parent.contentLeft)}px content box (x ${r0(parent.contentLeft)}–${r0(parent.contentRight)}).`, evidence: [`ancestors[0] ${parent.label}: content x ${r0(parent.contentLeft)}–${r0(parent.contentRight)}`] });
    if (w) facts.push({ text: `The winning ${w.decl.property} declaration is \`${w.decl.property}: ${w.decl.value}\` in \`${w.rule.selector}\` (${w.rule.source}).`, evidence: [cite(w)] });
    if (ctx.pageOverflowPx > 0) facts.push({ text: `The page scrolls horizontally by ${ctx.pageOverflowPx}px at ${vw}px.`, evidence: [`pageOverflowPx: ${ctx.pageOverflowPx}`, ...(issue ? [issueCite(issue)] : [])] });
    const causes: InferredCause[] = [
      {
        text: w
          ? `\`${w.decl.property}: ${w.decl.value}\` is a fixed length (${r0(declared)}px) that cannot shrink below the ${r0(available)}px available, so ${el.label} overflows at viewports narrower than ≈${r0(declared + Math.max(0, parent ? parent.contentLeft : el.rect.x) * 2)}px.`
          : `${el.label} resolves to ${r0(computedW)}px, wider than the ${r0(available)}px available; no fixed width declaration was found, so the width likely comes from intrinsic content size.`,
        confidence: confidence(w ? 0.72 : 0.42, { declaration: Boolean(w), issue: Boolean(issue), measured: overVp > 1 || overParent > 1 }),
        evidence: [...(w ? [cite(w)] : [`element.computed.width: ${el.computed.width}`]), `element.rect: right ${r0(right)}`, ...(issue ? [issueCite(issue)] : [])],
      },
    ];
    const box = contentBox ? [edit(sel, 'box-sizing', 'border-box', media)] : [];
    const fixes: ProposedFix[] = [
      {
        id: 'cap-width',
        title: `Cap ${sel} at its container width`,
        rationale: w
          ? `Keep the designed ${w.decl.value} on wide containers but never exceed the container: max-width wins over width, so the box becomes min(${w.decl.value}, 100%).${contentBox ? ' box-sizing: border-box keeps padding inside the cap.' : ''}`
          : `Constrain the box to its container so intrinsic content cannot push it wider.${contentBox ? ' box-sizing: border-box keeps padding inside the cap.' : ''}`,
        css: [edit(sel, 'max-width', '100%', media), ...box],
        expectedEffect: `${el.label} becomes ≈${r0(Math.min(declared, available))}px wide at ${vw}px; right edge ≈x ${r0(Math.min(right, parent ? parent.contentRight : vw))}${ctx.pageOverflowPx > 0 ? `; page overflow ${ctx.pageOverflowPx}px → 0px if this is the only culprit` : ''}.`,
        affectedElements: [sel],
        risks: ['Text inside wraps onto more lines; check the element height.', `Every element matching ${sel} is affected.`],
        tests: [`At ${vw}px: document.documentElement.scrollWidth <= innerWidth`, `${el.label} right edge <= its container's right edge`, 'At desktop widths the element keeps its designed width'],
      },
    ];
    if (w && w.decl.property === 'width') {
      fixes.push({
        id: 'fluid-width',
        title: `Make ${sel} fluid`,
        rationale: `Replace the fixed ${w.decl.value} with width: auto so the box always fills its container, capped at 100%.`,
        css: [edit(sel, 'width', 'auto', media), edit(sel, 'max-width', '100%', media), ...box],
        expectedEffect: `${el.label} fills the ${r0(available)}px container at every viewport (also wider on desktop).`,
        affectedElements: [sel],
        risks: ['On wide screens the element is no longer limited to its designed width.'],
        tests: [`At ${vw}px and 344px: no horizontal page scroll`, 'At 1440px: the element still looks intentional'],
      });
    } else if (w && w.decl.property === 'min-width') {
      fixes.push({
        id: 'relax-min-width',
        title: `Let ${sel} shrink below ${w.decl.value}`,
        rationale: `min-width: min(${w.decl.value}, 100%) keeps the minimum on large containers but allows shrinking in narrow ones.`,
        css: [edit(sel, 'min-width', `min(${w.decl.value}, 100%)`, media)],
        expectedEffect: `${el.label} can shrink to the ${r0(available)}px container.`,
        affectedElements: [sel],
        risks: ['Content may wrap or compress at narrow widths.'],
        tests: [`At ${vw}px: no horizontal page scroll`],
      });
    }
    return {
      rule: this.id,
      topics: ['overflow', 'general', 'layout'],
      weight: 0.9,
      summary: `${el.label} is ${r0(el.rect.width)}px wide in a ${r0(available)}px container${w ? `: \`${w.rule.selector} { ${w.decl.property}: ${w.decl.value} }\` (${w.rule.source}) does not shrink` : ' (no fixed width declaration found)'}${ctx.pageOverflowPx > 0 ? `, so the page scrolls ${ctx.pageOverflowPx}px horizontally` : `, so it overflows by ${r0(Math.max(overVp, overParent))}px`}.`,
      facts,
      causes,
      fixes,
      assumptions: hasLineNumbers(w) ? ['Source line numbers are approximate: IFDY locates the selector in the stylesheet text.'] : [],
      tests: [`Re-run responsive checks at ${vw}px: horizontal-overflow should disappear`],
    };
  },
};

/** Flex item that refuses to shrink (flex-shrink: 0, or min-width: auto with long unbreakable content). */
export const flexShrinkRule: HeuristicRule = {
  id: 'flex-no-shrink',
  title: 'Flex item refuses to shrink',
  run(ctx) {
    const el = ctx.element;
    if (!el.layout.isFlexItem) return null;
    const dir = el.layout.flexDirection ?? 'row';
    if (!dir.startsWith('row')) return null;
    const parent = ctx.ancestors[0];
    const right = rightOf(el.rect);
    const over = Math.max(right - ctx.viewport.width, parent ? right - parent.contentRight : 0);
    const clipped = issueFor(ctx, 'clipped-content', 'ancestor') ?? issueFor(ctx, 'horizontal-overflow', 'any');
    if (over <= 1 && !clipped) return null;
    const shrink = el.computed['flex-shrink'];
    const minW = el.computed['min-width'];
    const longest = Math.max(0, ...(el.text ?? '').split(/\s+/).map((t) => t.length));
    const noShrink = shrink === '0';
    const autoMin = minW === 'auto' && (longest >= 20 || /nowrap|pre/.test(el.computed['white-space'] ?? ''));
    if (!noShrink && !autoMin) return null;
    const wShrink = winning(ctx, 'flex-shrink');
    const sel = fixSelector(ctx, wShrink);
    const media = wShrink ? ruleMedia(wShrink.rule) : '';
    const css: CssEdit[] = [edit(sel, 'min-width', '0', media)];
    if (noShrink) css.push(edit(sel, 'flex-shrink', '1', media));
    if (longest >= 20) css.push(edit(sel, 'overflow-wrap', 'anywhere', media));
    return {
      rule: this.id,
      topics: ['overflow', 'general', 'layout'],
      weight: 0.75,
      summary: `${el.label} is a flex item that ${noShrink ? 'has flex-shrink: 0' : 'keeps min-width: auto'} and pushes ${r0(over)}px past its container.`,
      facts: [
        { text: `${el.label} is a flex item in a ${dir} flex container (${el.layout.parentDisplay}).`, evidence: ['element.layout: isFlexItem=true', `element.layout.flexDirection: ${dir}`] },
        { text: `Computed flex-shrink is ${shrink} and min-width is ${minW}.`, evidence: [`element.computed.flex-shrink: ${shrink}`, `element.computed.min-width: ${minW}`, ...(wShrink ? [cite(wShrink)] : [])] },
        ...(longest >= 20 ? [{ text: `Its text contains an unbreakable run of ${longest} characters.`, evidence: ['element.text'] }] : []),
      ],
      causes: [
        {
          text: noShrink
            ? 'flex-shrink: 0 prevents the item from shrinking, so the row grows wider than its container.'
            : 'Flex items default to min-width: auto, which stops them shrinking below their min-content width (the longest unbreakable run).',
          confidence: confidence(noShrink ? 0.66 : 0.5, { declaration: Boolean(wShrink), issue: Boolean(clipped), measured: over > 1 }),
          evidence: [`element.computed.flex-shrink: ${shrink}`, `element.computed.min-width: ${minW}`, ...(wShrink ? [cite(wShrink)] : [])],
        },
      ],
      fixes: [
        {
          id: 'flex-shrink',
          title: `Allow ${sel} to shrink`,
          rationale: `min-width: 0 lets the flex item shrink below its content width${noShrink ? '; flex-shrink: 1 restores shrinking' : ''}${longest >= 20 ? '; overflow-wrap: anywhere breaks the long run' : ''}.`,
          css,
          expectedEffect: `${el.label} shrinks to fit its row; overflow ${r0(over)}px → 0px.`,
          affectedElements: [sel],
          risks: ['Text may wrap at unusual points; check readability.', 'Siblings may shrink or grow differently.'],
          tests: ['No horizontal scroll at the current viewport', `${el.label} stays within its flex container`],
        },
      ],
      assumptions: [],
      tests: [],
    };
  },
};

/** white-space: nowrap (or pre) content running out of its box. */
export const nowrapRule: HeuristicRule = {
  id: 'nowrap-overflow',
  title: 'white-space: nowrap overflow',
  run(ctx) {
    const el = ctx.element;
    const ws = el.computed['white-space'] ?? '';
    if (!/^(nowrap|pre)$/.test(ws)) return null;
    const parent = ctx.ancestors[0];
    const right = rightOf(el.rect);
    const over = Math.max(right - ctx.viewport.width, parent ? right - parent.contentRight : 0);
    const clipped = issueFor(ctx, 'clipped-content', 'self');
    if (over <= 1 && !clipped) return null;
    const ellipsis = el.computed['text-overflow'] === 'ellipsis' && /(hidden|clip)/.test(el.computed['overflow-x'] ?? '');
    const w = winning(ctx, 'white-space');
    const sel = fixSelector(ctx, w);
    const media = w ? ruleMedia(w.rule) : '';
    return {
      rule: this.id,
      topics: ['overflow', 'general'],
      weight: ellipsis ? 0.35 : 0.7,
      summary: ellipsis
        ? `${el.label} truncates its text with an ellipsis (white-space: ${ws}); this looks intentional.`
        : `${el.label} cannot wrap (white-space: ${ws}) and runs ${r0(over)}px out of its box.`,
      facts: [
        { text: `Computed white-space is ${ws}${ellipsis ? ' with text-overflow: ellipsis' : ''}.`, evidence: [`element.computed.white-space: ${ws}`, ...(w ? [cite(w)] : [])] },
        ...(over > 1 ? [{ text: `${el.label} extends ${r0(over)}px beyond ${parent ? parent.label : 'the viewport'}.`, evidence: [`element.rect: ${rectText(el.rect)}`] }] : []),
        ...(clipped ? [{ text: clipped.message, evidence: [issueCite(clipped)] }] : []),
      ],
      causes: [
        {
          text: ellipsis ? 'Truncation is the designed behaviour; the full text may not be available elsewhere.' : `white-space: ${ws} keeps the text on one line, so it cannot fit the available width.`,
          confidence: confidence(ellipsis ? 0.4 : 0.6, { declaration: Boolean(w), issue: Boolean(clipped), measured: over > 1 }),
          evidence: [`element.computed.white-space: ${ws}`, ...(w ? [cite(w)] : [])],
        },
      ],
      fixes: ellipsis
        ? []
        : [
            {
              id: 'allow-wrap',
              title: `Let ${sel} wrap`,
              rationale: 'white-space: normal allows line breaks; overflow-wrap: anywhere breaks long words or numbers if needed.',
              css: [edit(sel, 'white-space', 'normal', media), edit(sel, 'overflow-wrap', 'anywhere', media)],
              expectedEffect: `Text wraps inside ${parent?.label ?? 'its container'}; overflow ${r0(over)}px → 0px.`,
              affectedElements: [sel],
              risks: ['Numbers or codes may break across lines; prefer a scroll container for tabular data.'],
              tests: ['The text is fully visible without horizontal scrolling'],
            },
          ],
      assumptions: ellipsis ? ['Ellipsis truncation is assumed to be intentional; confirm the full text is available (title, tooltip or an expanded view).'] : [],
      tests: [],
    };
  },
};

/** Pick the "card" (centred container) and the page "shell" around an element that crosses the fold. */
export function hingeContainers(ctx: DiagnosisContext, fold: CtxFold, vw: number): { card: CtxAncestor | null; shell: CtxAncestor | null } {
  const full = (a: CtxAncestor) => a.rect.width >= vw - 2 && a.rect.x <= 1;
  let card: CtxAncestor | null = null;
  for (const a of ctx.ancestors) {
    if (full(a)) break;
    if (crossesFold(a.rect, fold) && a.rect.width < vw * 0.92) card = a;
  }
  const startIdx = card ? ctx.ancestors.indexOf(card) + 1 : 0;
  const fulls = ctx.ancestors.slice(startIdx).filter((a) => full(a) && !/^(html|body)$/.test(a.tag));
  // Innermost full-width container that splits into several children; never climb above
  // <main>, so the app shell (header/nav/footer) is not spread across the screens.
  let shell: CtxAncestor | null = null;
  for (const a of fulls) {
    if ((a.childCount ?? 0) >= 2 || a.tag === 'main') {
      shell = a;
      break;
    }
  }
  return { card, shell: shell ?? fulls[0] ?? null };
}

/** Viewport-segment layout + a measured px fallback (IFDY's preview cannot emulate segments). */
export function segmentFix(shellSelector: string, fold: CtxFold, viewport: { width: number; height: number }, label: string): CssEdit[] {
  const vertical = fold.axis === 'vertical';
  const seg = vertical ? '(horizontal-viewport-segments: 2)' : '(vertical-viewport-segments: 2)';
  const fallback = vertical
    ? `(min-width: ${viewport.width}px) and (max-width: ${viewport.width}px)`
    : `(min-height: ${viewport.height}px) and (max-height: ${viewport.height}px)`;
  const total = vertical ? viewport.width : viewport.height;
  const first = r0(fold.offset);
  const second = r0(total - fold.offset - fold.maskLength);
  const gap = `${r0(fold.maskLength)}px`;
  void label;
  return vertical
    ? [
        edit(shellSelector, 'display', 'grid', seg),
        edit(shellSelector, 'grid-template-columns', 'env(viewport-segment-width 0 0) env(viewport-segment-width 1 0)', seg),
        edit(shellSelector, 'column-gap', 'calc(env(viewport-segment-left 1 0) - env(viewport-segment-right 0 0))', seg),
        edit(shellSelector, 'display', 'grid', fallback),
        edit(shellSelector, 'grid-template-columns', `${first}px ${second}px`, fallback),
        edit(shellSelector, 'column-gap', gap, fallback),
      ]
    : [
        edit(shellSelector, 'display', 'grid', seg),
        edit(shellSelector, 'grid-template-rows', 'env(viewport-segment-height 0 0) env(viewport-segment-height 0 1)', seg),
        edit(shellSelector, 'row-gap', 'calc(env(viewport-segment-top 0 1) - env(viewport-segment-bottom 0 0))', seg),
        edit(shellSelector, 'display', 'grid', fallback),
        edit(shellSelector, 'grid-template-rows', `${first}px ${second}px`, fallback),
        edit(shellSelector, 'row-gap', gap, fallback),
      ];
}

function segmentAware(ctx: DiagnosisContext): boolean {
  const all = [...(ctx.styles?.activeMedia ?? []), ...ctx.pageMedia];
  return all.some((m) => /viewport-segments|spanning/.test(m));
}

/** Element crossing the hinge/crease of a foldable. */
export const hingeRule: HeuristicRule = {
  id: 'hinge-crossing',
  title: 'Element crosses the hinge',
  run(ctx) {
    const fold = ctx.fold;
    const el = ctx.element;
    if (!fold) return null;
    const issue = issueFor(ctx, 'fold-intersection');
    if (!issue && !crossesFold(el.rect, fold)) return null;
    const vw = ctx.viewport.width;
    const hinge = fold.kind === 'hinge' && fold.maskLength > 0;
    const overlap = r0(foldOverlap(el.rect, fold));
    const { card, shell } = hingeContainers(ctx, fold, vw);
    const axisX = fold.axis === 'vertical';
    const band = `${axisX ? 'x' : 'y'} ${r0(fold.offset)}–${r0(fold.offset + fold.maskLength)}`;
    const facts: ObservedFact[] = [
      {
        text: `${el.label} spans ${axisX ? `x ${r0(el.rect.x)}–${r0(rightOf(el.rect))}` : `y ${r0(el.rect.y)}–${r0(el.rect.y + el.rect.height)}`} and crosses the ${fold.kind} at ${band}${hinge ? `; ${overlap}px of it is physically not displayed` : ''}.`,
        evidence: [`element.rect: ${rectText(el.rect)}`, `fold: ${fold.axis} ${fold.kind} at ${band} (${fold.maskLength}px)`, ...(issue ? [issueCite(issue)] : [])],
      },
    ];
    if (card) {
      const centred = Math.abs(card.rect.x + card.rect.width / 2 - (fold.offset + fold.maskLength / 2)) < card.rect.width * 0.15;
      facts.push({
        text: `Its container ${card.label} spans x ${r0(card.rect.x)}–${r0(rightOf(card.rect))} (max-width ${card.computed['max-width'] ?? '—'}, margin ${card.computed['margin-left'] ?? '?'} / ${card.computed['margin-right'] ?? '?'})${centred ? ' and is centred on the fold' : ''}.`,
        evidence: [`ancestors ${card.label}: ${rectText(card.rect)}`, `ancestors ${card.label}.computed.max-width: ${card.computed['max-width']}`],
      });
    }
    const aware = segmentAware(ctx);
    facts.push({
      text: aware ? 'A viewport-segments media query exists in the page styles.' : `None of the page's media queries target viewport segments (${ctx.pageMedia.length || ctx.styles?.activeMedia.length || 0} scanned).`,
      evidence: ['styles.activeMedia', 'pageMedia'],
    });
    const causes: InferredCause[] = [];
    if (card) {
      causes.push({
        text: `The layout centres a single ${r0(card.rect.width)}px column (${card.label}) on the full ${vw}px spanned width, so the ${fold.kind} runs through the middle of the content.`,
        confidence: confidence(0.68, { issue: Boolean(issue), measured: true }),
        evidence: [`ancestors ${card.label}: ${rectText(card.rect)}`, `fold: ${band}`],
      });
    } else {
      causes.push({
        text: `${el.label} is laid out across the whole spanned width, so it necessarily crosses the ${fold.kind}.`,
        confidence: confidence(0.55, { issue: Boolean(issue), measured: true }),
        evidence: [`element.rect: ${rectText(el.rect)}`],
      });
    }
    if (!aware)
      causes.push({
        text: 'No posture-aware rule (horizontal-viewport-segments) adapts the layout to the two screen segments.',
        confidence: confidence(0.6, { measured: true, contradicted: (ctx.styles?.inaccessibleSheets ?? 0) > 0 }),
        evidence: ['styles.activeMedia', 'pageMedia'],
      });
    const fixes: ProposedFix[] = [];
    const shellSel = shell?.classSelector || shell?.selector;
    if (shellSel) {
      fixes.push({
        id: 'segments-layout',
        title: `Lay ${shellSel} out per screen segment`,
        rationale: `On dual-screen devices, place content in the two viewport segments with a gap equal to the ${fold.kind}. The env(viewport-segment-*) rule is the standard; the px rule is a fallback scoped to this ${vw}px spanned width for browsers (and IFDY's preview) that do not expose segments.`,
        css: segmentFix(shellSel, fold, ctx.viewport, shell!.label),
        expectedEffect: `Content flows into the ${r0(fold.offset)}px and ${r0((axisX ? vw : ctx.viewport.height) - fold.offset - fold.maskLength)}px segments with the ${r0(fold.maskLength)}px ${fold.kind} as the gap; ${el.label} no longer crosses ${band}.`,
        affectedElements: [shellSel, ...(card ? [card.classSelector || card.selector] : []), el.classSelector || el.selector],
        risks: [
          'Children of the shell become grid items; check their order and that hidden children stay hidden.',
          `The px fallback only applies at exactly ${axisX ? `${vw}px wide` : `${ctx.viewport.height}px tall`}; other foldables rely on the segments query.`,
        ],
        tests: [`At ${vpText(ctx)}: no interactive element intersects ${band}`, 'Folded posture and desktop layouts are unchanged', 'Test on hardware or a browser with Viewport Segments emulation'],
      });
    }
    if (card) {
      const sel = card.classSelector || card.selector;
      const gutter = 24;
      const segStart = r0(fold.offset + fold.maskLength);
      const segWidth = r0((axisX ? vw : ctx.viewport.height) - segStart);
      const parent = ctx.ancestors[ctx.ancestors.indexOf(card) + 1];
      const parentLeft = parent ? parent.contentLeft : 0;
      if (axisX && segWidth > 280) {
        const fallback = `(min-width: ${vw}px) and (max-width: ${vw}px)`;
        fixes.push({
          id: 'card-one-segment',
          title: `Keep ${sel} on one screen`,
          rationale: `Move the centred container entirely onto the second segment (x ≥ ${segStart}) instead of straddling the ${fold.kind}. Smaller change than a two-column layout.`,
          css: [
            edit(sel, 'margin-left', `calc(env(viewport-segment-left 1 0) + ${gutter}px - ${r0(parentLeft)}px)`, '(horizontal-viewport-segments: 2)'),
            edit(sel, 'max-width', `calc(env(viewport-segment-width 1 0) - ${gutter * 2}px)`, '(horizontal-viewport-segments: 2)'),
            edit(sel, 'margin-left', `${r0(segStart + gutter - parentLeft)}px`, fallback),
            edit(sel, 'max-width', `${segWidth - gutter * 2}px`, fallback),
          ],
          expectedEffect: `${card.label} sits at x ${segStart + gutter}–${segStart + segWidth - gutter}; nothing inside it crosses ${band}.`,
          affectedElements: [sel],
          risks: ['The left segment is left empty unless other content moves there.', 'Content inside becomes narrower and may wrap.'],
          tests: [`At ${vpText(ctx)}: ${card.label} left edge >= ${segStart}`, 'Folded posture is unchanged'],
        });
      }
    }
    return {
      rule: this.id,
      topics: ['posture', 'layout', 'general', 'a11y'],
      weight: hinge ? 0.85 : 0.55,
      summary: `${el.label} is split by the ${fold.kind} at ${band}${card ? ` because ${card.label} is centred across both screens` : ''}${hinge ? `; ${overlap}px of it is hidden` : ''}.`,
      facts,
      causes,
      fixes,
      assumptions: [
        `Fold geometry comes from the ${ctx.viewport.deviceName} device profile; confirm it against hardware before relying on exact pixels.`,
        "IFDY's preview cannot emulate the Viewport Segments API, so the px fallback is what you see when previewing.",
      ],
      tests: [`Re-run responsive checks at ${vpText(ctx)}: fold-intersection should disappear`],
    };
  },
};

/** Tap targets below 24×24 (WCAG 2.5.8 AA) or the 44×44 recommendation. */
export const tapTargetRule: HeuristicRule = {
  id: 'tap-target',
  title: 'Small tap target',
  run(ctx) {
    const el = ctx.element;
    if (!el.interactive || el.rect.width === 0 || el.rect.height === 0) return null;
    const w = el.rect.width;
    const h = el.rect.height;
    const issue = issueFor(ctx, 'tap-target');
    const tiny = w < 24 || h < 24;
    if (!tiny && !(w < 44 || h < 44) && !issue) return null;
    if (!tiny && !issue) {
      // Between 24 and 44: advisory only.
      return null;
    }
    const type = el.attrs.find(([n]) => n === 'type')?.[1] ?? '';
    const box = el.tag === 'input' && /^(checkbox|radio)$/.test(type);
    const wW = winning(ctx, 'width');
    const wH = winning(ctx, 'height');
    const w0 = wW ?? wH;
    const sel = fixSelector(ctx, w0);
    const media = w0 ? ruleMedia(w0.rule) : '';
    const inline = INLINE_DISPLAYS.has(el.layout.display);
    const css: CssEdit[] = box
      ? [edit(sel, 'width', '24px', media), edit(sel, 'height', '24px', media)]
      : inline
        ? [edit(sel, 'display', 'inline-block', media), edit(sel, 'padding-block', `${Math.max(0, r0((44 - h) / 2))}px`, media), edit(sel, 'min-width', '44px', media)]
        : [edit(sel, 'min-width', '44px', media), edit(sel, 'min-height', '44px', media)];
    return {
      rule: this.id,
      topics: ['a11y', 'general'],
      weight: tiny ? 0.65 : 0.4,
      summary: `${el.label} is a ${r0(w)}×${r0(h)}px tap target, below the 24×24px WCAG 2.5.8 minimum${box ? ' (its text is not part of the target)' : ''}.`,
      facts: [
        { text: `${el.label} (${el.a11y.role}) renders at ${r0(w)}×${r0(h)}px.`, evidence: [`element.rect: ${rectText(el.rect)}`, `element.a11y.role: ${el.a11y.role}`] },
        ...(wW || wH ? [{ text: `Its size is declared explicitly${wW ? ` (\`width: ${wW.decl.value}\`)` : ''}${wH ? ` (\`height: ${wH.decl.value}\`)` : ''}.`, evidence: [...(wW ? [cite(wW)] : []), ...(wH ? [cite(wH)] : [])] }] : []),
        ...(issue ? [{ text: issue.message, evidence: [issueCite(issue)] }] : []),
      ],
      causes: [
        {
          text: wW || wH ? `The explicit ${[wW && `width: ${wW.decl.value}`, wH && `height: ${wH.decl.value}`].filter(Boolean).join(' / ')} keeps the hit area small.` : `${el.label} has no minimum size, so its hit area is only as large as its content.`,
          confidence: confidence(wW || wH ? 0.72 : 0.5, { declaration: Boolean(wW || wH), issue: Boolean(issue), measured: true }),
          evidence: [...(wW ? [cite(wW)] : []), ...(wH ? [cite(wH)] : []), `element.rect: ${r0(w)}×${r0(h)}`],
        },
      ],
      fixes: [
        {
          id: 'tap-size',
          title: box ? `Enlarge ${sel} to 24×24px` : `Give ${sel} a 44×44px hit area`,
          rationale: box
            ? 'A 24×24px control meets WCAG 2.5.8 (AA). For a 44px target, also make its text a <label> so the whole row is clickable (markup change).'
            : '44×44px meets WCAG 2.5.5 (AAA) and platform guidelines; min-width/min-height grow the hit area without changing the content.',
          css,
          expectedEffect: `${el.label} becomes at least ${box ? '24×24' : '44×44'}px.`,
          affectedElements: [sel],
          risks: ['Neighbouring content may shift; check alignment with the label.'],
          tests: [`${el.label} bounding box >= ${box ? '24×24' : '44×44'}px`, 'Keyboard focus ring still fits the new size'],
        },
      ],
      assumptions: box ? ['The adjacent text is assumed not to be a <label>; IFDY only sees this element.'] : [],
      tests: [],
    };
  },
};

/** Text contrast below WCAG AA; proposes a colour with the same hue that reaches 4.5:1 (3:1 for large text). */
export const contrastRule: HeuristicRule = {
  id: 'low-contrast',
  title: 'Low text contrast',
  run(ctx) {
    const c = ctx.element.a11y.contrast;
    if (!c) return null;
    const large = c.fontSize >= 24 || (c.bold && c.fontSize >= 18.66);
    const target = large ? 3 : 4.5;
    if (c.ratio >= target) return null;
    const fg = parseColor(c.fg);
    const bg = parseColor(c.bg);
    if (!fg || !bg) return null;
    const adjusted = adjustForContrast(fg, bg, target + 0.1);
    const w = winning(ctx, 'color');
    const sel = fixSelector(ctx, w);
    const media = w ? ruleMedia(w.rule) : '';
    const hardcoded = w && !/var\(/.test(w.decl.value);
    const el = ctx.element;
    return {
      rule: this.id,
      topics: ['a11y', 'general'],
      weight: 0.7,
      summary: `${el.label} has ${c.ratio.toFixed(2)}:1 text contrast (${c.fg} on ${c.bg}), below the ${target}:1 WCAG AA minimum.`,
      facts: [
        { text: `Text contrast is ${c.ratio.toFixed(2)}:1 for ${c.fg} on ${c.bg} at ${c.fontSize}px${c.bold ? ' bold' : ''}.`, evidence: [`element.a11y.contrast: ${c.ratio.toFixed(2)} (${c.fg} / ${c.bg})`] },
        ...(w ? [{ text: `The colour comes from \`${w.rule.selector}\` (${w.rule.source})${hardcoded ? ' as a hard-coded value, not a design token' : ''}.`, evidence: [cite(w)] }] : []),
      ],
      causes: [
        {
          text: `${w ? `\`color: ${w.decl.value}\`` : 'The text colour'} is too light for the ${c.bg} background.`,
          confidence: confidence(0.75, { declaration: Boolean(w), measured: true }),
          evidence: [`element.a11y.contrast: ${c.ratio.toFixed(2)}`, ...(w ? [cite(w)] : [])],
        },
      ],
      fixes: adjusted
        ? [
            {
              id: 'contrast-color',
              title: `Darken ${sel} to ${adjusted.color}`,
              rationale: `${adjusted.color} keeps the hue of ${c.fg} and reaches ${adjusted.ratio}:1 on ${c.bg}.${hardcoded ? ' Prefer an existing design token with sufficient contrast if there is one.' : ''}`,
              css: [edit(sel, 'color', adjusted.color, media)],
              expectedEffect: `Contrast ${c.ratio.toFixed(2)}:1 → ${adjusted.ratio}:1 (AA ${large ? 'large text' : 'normal text'}).`,
              affectedElements: [sel],
              risks: ['Hover/focus rules are not visible in this snapshot and may still use the old colour.', 'Brand colour changes may need design sign-off.'],
              tests: ['axe color-contrast passes for this element', 'Hover and focus states also reach 4.5:1'],
            },
          ]
        : [],
      assumptions: ['Contrast is measured against the computed background colour; background images or gradients are not considered.'],
      tests: [],
    };
  },
};

/** Long line length on wide viewports. */
export const lineLengthRule: HeuristicRule = {
  id: 'line-length',
  title: 'Long line length',
  run(ctx) {
    const el = ctx.element;
    const issue = issueFor(ctx, 'line-length');
    const fs = toPx(el.computed['font-size']) ?? 16;
    const chars = el.box.content.width / (fs * 0.5);
    const lh = toPx(el.computed['line-height']) ?? fs * 1.4;
    const lines = el.box.content.height / lh;
    const textual = /^(p|li|dd|blockquote|div|span|td)$/.test(el.tag) && (el.text?.length ?? 0) > 60;
    if (!issue && !(textual && chars > 90 && lines >= 1.5)) return null;
    const maxW = el.computed['max-width'];
    const w = winning(ctx, 'max-width');
    const base = ctx.styles?.matched.find((r) => r.origin === 'author' && el.classes.some((c) => r.selector.includes(`.${c}`)));
    const sel = base?.selector ?? el.classSelector ?? el.selector;
    return {
      rule: this.id,
      topics: ['a11y', 'layout', 'general', 'posture'],
      weight: 0.45,
      summary: `${el.label} sets ≈${r0(chars)} characters per line; 45–80 is comfortable to read.`,
      facts: [
        { text: `${el.label} is ${r0(el.box.content.width)}px wide at ${fs}px font size (≈${r0(chars)} characters per line, ≈${Math.max(1, r0(lines))} lines).`, evidence: [`element.box.content.width: ${r0(el.box.content.width)}`, `element.computed.font-size: ${el.computed['font-size']}`, ...(issue ? [issueCite(issue)] : [])] },
        { text: `max-width is ${maxW ?? 'none'}.`, evidence: [`element.computed.max-width: ${maxW}`, ...(w ? [cite(w)] : [])] },
      ],
      causes: [{ text: 'The text block takes the full container width with no measure (max-width), so lines get long on wide viewports.', confidence: confidence(0.55, { issue: Boolean(issue), measured: true }), evidence: [`element.computed.max-width: ${maxW}`] }],
      fixes: [
        {
          id: 'measure',
          title: `Limit ${sel} to 68ch`,
          rationale: 'A 68ch measure keeps lines around 60–75 characters at any viewport width.',
          css: [edit(sel, 'max-width', '68ch')],
          expectedEffect: `Lines shorten from ≈${r0(chars)} to ≤ ≈68 characters on wide viewports; no change where the container is narrower.`,
          affectedElements: [sel],
          risks: ['Leaves empty space beside the text in wide containers; align or centre deliberately.'],
          tests: ['At 1440px: longest line ≤ 80 characters'],
        },
      ],
      assumptions: ['Characters per line are estimated as width / (0.5 × font-size).'],
      tests: [],
    };
  },
};

/** Primary action hidden at this breakpoint. */
export const hiddenActionRule: HeuristicRule = {
  id: 'hidden-primary-action',
  title: 'Primary action hidden',
  run(ctx) {
    const el = ctx.element;
    const issue = issueFor(ctx, 'hidden-primary-action');
    const display = el.computed.display;
    const hidden = display === 'none' || el.computed.visibility === 'hidden' || el.rect.width === 0 || el.rect.height === 0;
    if (!hidden || !(el.primary || issue || el.interactive)) return null;
    const w = winning(ctx, display === 'none' ? 'display' : 'visibility');
    const media = w ? ruleMedia(w.rule) : '';
    const sel = fixSelector(ctx, w);
    const other = ctx.comparison?.element;
    const overriddenDisplay = declarations(ctx, 'display').find((d) => d.decl.overridden && d.decl.value !== 'none')?.decl.value;
    const restore = display === 'none' ? (other?.visible && other.computed?.display && other.computed.display !== 'none' ? other.computed.display : overriddenDisplay ?? (/^(button|a)$/.test(el.tag) ? 'inline-flex' : 'block')) : 'visible';
    const prop = display === 'none' ? 'display' : 'visibility';
    return {
      rule: this.id,
      topics: ['a11y', 'posture', 'layout', 'general'],
      weight: el.primary || issue ? 0.85 : 0.5,
      summary: `${el.label} is hidden at ${vpText(ctx)}${w ? ` by \`${w.rule.selector} { ${w.decl.property}: ${w.decl.value} }\`${w.rule.media?.length ? ` inside @media ${w.rule.media.join(' and ')}` : ''}` : ''}${el.primary ? '; users on this viewport cannot reach the primary action' : ''}.`,
      facts: [
        { text: `${el.label} has computed ${prop}: ${prop === 'display' ? display : el.computed.visibility} at ${vpText(ctx)}.`, evidence: [`element.computed.${prop}`, `element.rect: ${rectText(el.rect)}`, ...(issue ? [issueCite(issue)] : [])] },
        ...(w ? [{ text: `The hiding declaration is in \`${w.rule.selector}\` (${w.rule.source})${w.rule.media?.length ? ` under @media ${w.rule.media.join(' and ')}` : ''}.`, evidence: [cite(w)] }] : []),
        ...(other ? [{ text: other.visible ? `At ${ctx.comparison!.viewport.deviceName} ${ctx.comparison!.viewport.width}×${ctx.comparison!.viewport.height} it is visible (display: ${other.computed?.display}).` : `It is also hidden at ${ctx.comparison!.viewport.width}×${ctx.comparison!.viewport.height}.`, evidence: [`comparison.element: visible=${other.visible}`] }] : []),
      ],
      causes: [
        {
          text: w?.rule.media?.length ? `A breakpoint rule hides the action below/above a width instead of re-positioning it, so feature parity breaks on this viewport.` : 'A rule hides the element at this viewport.',
          confidence: confidence(0.66, { declaration: Boolean(w), issue: Boolean(issue), measured: true }),
          evidence: [...(w ? [cite(w)] : []), `element.computed.display: ${display}`],
        },
      ],
      fixes: [
        {
          id: 'show-action',
          title: `Show ${sel}${media ? ` at @media ${media}` : ''}`,
          rationale: `Restore ${prop}: ${restore}${other?.visible ? ` (its value at ${ctx.comparison!.viewport.width}px)` : ''} under the same condition that hid it. Reposition it (e.g. full width) rather than hiding it.`,
          css: [edit(sel, prop, restore, media)],
          expectedEffect: `${el.label} renders and is reachable by tap and keyboard at ${vpText(ctx)}.`,
          affectedElements: [sel],
          risks: ['The action may need a mobile layout (e.g. width: 100%) to fit.'],
          tests: [`At ${ctx.viewport.width}px: getComputedStyle(el).display !== 'none'`, 'The action is in the tab order'],
        },
      ],
      assumptions: restore === 'inline-flex' || restore === 'block' ? [`The restored display value (${restore}) is a guess; IFDY did not see the element's visible display value.`] : [],
      tests: [],
    };
  },
};

/** Content positioned off-screen (offsets, transforms or negative margins). */
export const offscreenRule: HeuristicRule = {
  id: 'offscreen',
  title: 'Content positioned off-screen',
  run(ctx) {
    const el = ctx.element;
    const vw = ctx.viewport.width;
    const r = el.rect;
    if (r.width === 0 || r.height === 0) return null;
    const outLeft = r.x < -1;
    const outRight = rightOf(r) > vw + 1;
    if (!outLeft && !outRight) return null;
    const srOnly = r.width <= 2 && r.height <= 2;
    if (srOnly) return null;
    const pos = el.computed.position;
    const transform = el.computed.transform ?? 'none';
    const candidates: Winning[] = [];
    for (const p of ['left', 'right', 'margin-left', 'margin-right', 'transform']) {
      const w = winning(ctx, p);
      if (!w) continue;
      const px = toPx(w.decl.value);
      if ((p === 'transform' && /translate/.test(w.decl.value)) || (px !== null && (px < 0 || (p === 'left' && px > vw)))) candidates.push(w);
    }
    if (!candidates.length && pos === 'static' && transform === 'none') return null;
    const w = candidates[0] ?? null;
    const sel = fixSelector(ctx, w);
    const media = w ? ruleMedia(w.rule) : '';
    const resetValue = w ? (w.decl.property === 'transform' || w.decl.property === 'translate' ? 'none' : '0') : '0';
    const outBy = r0(outLeft ? -r.x : rightOf(r) - vw);
    return {
      rule: this.id,
      topics: ['overflow', 'general', 'layout'],
      weight: 0.55,
      summary: `${el.label} is positioned ${outBy}px off the ${outLeft ? 'left' : 'right'} edge of the ${vw}px viewport${w ? ` by \`${w.decl.property}: ${w.decl.value}\`` : ''}.`,
      facts: [
        { text: `${el.label} spans x ${r0(r.x)}–${r0(rightOf(r))} in a ${vw}px viewport (position: ${pos}, transform: ${transform}).`, evidence: [`element.rect: ${rectText(r)}`, `element.computed.position: ${pos}`, `element.computed.transform: ${transform}`] },
        ...(w ? [{ text: `\`${w.decl.property}: ${w.decl.value}\` moves it outside the viewport.`, evidence: [cite(w)] }] : []),
      ],
      causes: [{ text: w ? `The ${w.decl.property} offset places the element outside the visible area at this width.` : 'Positioning places the element outside the visible area at this width.', confidence: confidence(0.45, { declaration: Boolean(w), measured: true }), evidence: [`element.rect: ${rectText(r)}`, ...(w ? [cite(w)] : [])] }],
      fixes: w
        ? [
            {
              id: 'reset-offset',
              title: `Reset ${w.decl.property} on ${sel}`,
              rationale: `Set ${w.decl.property}: ${resetValue} so the element stays within the viewport.`,
              css: [edit(sel, w.decl.property, resetValue, media)],
              expectedEffect: `${el.label} moves back inside the viewport (offset ${outBy}px → 0px).`,
              affectedElements: [sel],
              risks: ['If this is an off-canvas menu or a visually-hidden technique, the offset is intentional.'],
              tests: ['The element is fully visible when it should be', 'Off-canvas/closed states still hide it'],
            },
          ]
        : [],
      assumptions: ['Off-canvas drawers and visually-hidden (screen-reader only) patterns position content off-screen on purpose.'],
      tests: [],
    };
  },
};

/** Content clipped by an overflow: hidden/clip ancestor. */
export const clippingAncestorRule: HeuristicRule = {
  id: 'clipping-ancestor',
  title: 'Clipped by an ancestor',
  run(ctx) {
    const el = ctx.element;
    if (!el.layout.overflowAncestors.length) return null;
    for (const oa of el.layout.overflowAncestors) {
      if (!/(hidden|clip)/.test(oa.overflow)) continue;
      const anc = ctx.ancestors.find((a) => a.label === oa.label);
      if (!anc) continue;
      const clipsRight = rightOf(el.rect) - rightOf(anc.rect);
      const clipsLeft = anc.rect.x - el.rect.x;
      const clipsBottom = el.rect.y + el.rect.height - (anc.rect.y + anc.rect.height);
      const by = Math.max(clipsRight, clipsLeft, /hidden.*hidden|clip.*clip|\/ (hidden|clip)/.test(oa.overflow) ? clipsBottom : 0);
      if (by <= 1) continue;
      const sel = anc.classSelector || anc.selector;
      const horizontal = Math.max(clipsRight, clipsLeft) > 1;
      return {
        rule: this.id,
        topics: ['overflow', 'general'],
        weight: 0.6,
        summary: `${el.label} extends ${r0(by)}px beyond ${anc.label}, which clips its overflow (${oa.overflow}); the cut-off part is invisible.`,
        facts: [
          { text: `${anc.label} has overflow ${oa.overflow} and spans ${rectText(anc.rect)}.`, evidence: [`element.layout.overflowAncestors: ${oa.label} ${oa.overflow}`, `ancestors ${anc.label}: ${rectText(anc.rect)}`] },
          { text: `${el.label} spans ${rectText(el.rect)}, ${r0(by)}px outside it.`, evidence: [`element.rect: ${rectText(el.rect)}`] },
        ],
        causes: [{ text: `${el.label} is larger than ${anc.label} and the overflow is clipped instead of wrapped or scrolled.`, confidence: confidence(0.5, { measured: true }), evidence: [`element.layout.overflowAncestors: ${oa.label}`] }],
        fixes: [
          {
            id: 'scroll-instead',
            title: horizontal ? `Let ${sel} scroll horizontally` : `Let ${sel} show its overflow`,
            rationale: horizontal ? 'overflow-x: auto keeps containment but lets users reach the clipped content.' : 'overflow: visible stops cutting off the content.',
            css: horizontal ? [edit(sel, 'overflow-x', 'auto')] : [edit(sel, 'overflow', 'visible')],
            expectedEffect: `The clipped ${r0(by)}px of ${el.label} becomes reachable.`,
            affectedElements: [sel],
            risks: ['Rounded corners or animations may rely on the clipping.'],
            tests: ['The full content is visible or scrollable'],
          },
          {
            id: 'fit-child',
            title: `Fit ${el.classSelector || el.selector} inside ${anc.label}`,
            rationale: 'Constrain the child instead of changing the container.',
            css: [edit(el.classSelector || el.selector, 'max-width', '100%')],
            expectedEffect: `${el.label} fits within ${anc.label}.`,
            affectedElements: [el.classSelector || el.selector],
            risks: ['Content inside may wrap.'],
            tests: ['No clipped content'],
          },
        ],
        assumptions: [],
        tests: [],
      };
    }
    return null;
  },
};

const DIFF_PROPS = ['display', 'width', 'max-width', 'min-width', 'margin-left', 'margin-right', 'grid-template-columns', 'flex-direction', 'position', 'font-size'];

/** What changes between the current viewport and the comparison (other posture). */
export const postureDiffRule: HeuristicRule = {
  id: 'posture-difference',
  title: 'Difference between postures',
  run(ctx) {
    const cmp = ctx.comparison;
    if (!cmp) return null;
    const el = ctx.element;
    const other = cmp.element;
    const facts: ObservedFact[] = [];
    const here = vpText(ctx);
    const there = `${cmp.viewport.deviceName}${cmp.viewport.posture === 'expanded' ? ' expanded' : ''} ${cmp.viewport.width}×${cmp.viewport.height}`;
    if (!other?.found) facts.push({ text: `The element was not found at ${there}.`, evidence: ['comparison.element: not found'] });
    else {
      if (other.rect) facts.push({ text: `${el.label} is ${r0(el.rect.width)}×${r0(el.rect.height)} at x ${r0(el.rect.x)} here (${here}) and ${r0(other.rect.width)}×${r0(other.rect.height)} at x ${r0(other.rect.x)} at ${there}.`, evidence: [`element.rect: ${rectText(el.rect)}`, `comparison.element.rect: ${rectText(other.rect)}`] });
      for (const p of DIFF_PROPS) {
        const a = el.computed[p];
        const b = other.computed?.[p];
        if (a !== undefined && b !== undefined && a !== b) facts.push({ text: `${p}: ${a} here vs ${b} at ${there}.`, evidence: [`element.computed.${p}: ${a}`, `comparison.element.computed.${p}: ${b}`] });
      }
    }
    const ruleLine = (r: CtxRule) => `${r.selector} — ${r.source}${r.media?.length ? ` @media ${r.media.join(' and ')}` : ''}`;
    for (const r of cmp.rulesOnlyHere.slice(0, 4)) facts.push({ text: `Only here: \`${r.selector}\` (${r.source}${r.media?.length ? `, @media ${r.media.join(' and ')}` : ''}) sets ${r.declarations.map((d) => `${d.property}: ${d.value}`).slice(0, 3).join('; ')}.`, evidence: [`comparison.rulesOnlyHere: ${ruleLine(r)}`] });
    for (const r of cmp.rulesOnlyThere.slice(0, 4)) facts.push({ text: `Only at ${there}: \`${r.selector}\` (${r.source}${r.media?.length ? `, @media ${r.media.join(' and ')}` : ''}) sets ${r.declarations.map((d) => `${d.property}: ${d.value}`).slice(0, 3).join('; ')}.`, evidence: [`comparison.rulesOnlyThere: ${ruleLine(r)}`] });
    const countHere = Object.values(ctx.issueCounts).reduce((a, b) => a + b, 0);
    const countThere = Object.values(cmp.issueCounts).reduce((a, b) => a + b, 0);
    facts.push({ text: `Responsive checks: ${countHere} issue${countHere === 1 ? '' : 's'} here, ${countThere} at ${there}.`, evidence: ['issueCounts', 'comparison.issueCounts'] });
    const diffRules = cmp.rulesOnlyHere.length + cmp.rulesOnlyThere.length;
    const causes: InferredCause[] = diffRules
      ? [
          {
            text: `The difference is driven by ${diffRules} media-query rule${diffRules === 1 ? '' : 's'} that match only one posture${cmp.rulesOnlyHere[0]?.media?.length ? `, e.g. @media ${cmp.rulesOnlyHere[0].media!.join(' and ')}` : cmp.rulesOnlyThere[0]?.media?.length ? `, e.g. @media ${cmp.rulesOnlyThere[0].media!.join(' and ')}` : ''}.`,
            confidence: confidence(0.72, { declaration: true, measured: true }),
            evidence: ['comparison.rulesOnlyHere', 'comparison.rulesOnlyThere'],
          },
        ]
      : [{ text: 'No rule on this element differs between postures; the change comes from its containers (available width) or inherited styles.', confidence: confidence(0.45, { measured: true }), evidence: ['comparison.rulesOnlyHere: []', 'comparison.rulesOnlyThere: []'] }];
    return {
      rule: this.id,
      topics: ['posture', 'layout'],
      weight: 0.5,
      summary: `Between ${here} and ${there}, ${el.label} ${diffRules ? `is styled by ${diffRules} posture-specific rule${diffRules === 1 ? '' : 's'}` : 'only changes through its container'}; issues ${countHere} here vs ${countThere} there.`,
      facts,
      causes,
      fixes: [],
      assumptions: [`The ${there} measurement comes from a ${cmp.method === 'compare-preview' ? 'live compare preview' : 'hidden worker preview'} with your current edits applied.`],
      tests: [],
    };
  },
};

/** Proposal for the expanded posture even when nothing crosses the fold right now. */
export const expandedProposalRule: HeuristicRule = {
  id: 'expanded-layout',
  title: 'Layout proposal for the expanded posture',
  run(ctx) {
    const useCmp = !ctx.fold && ctx.comparison?.fold;
    const fold = ctx.fold ?? ctx.comparison?.fold ?? null;
    if (!fold) return null;
    const viewport = useCmp ? ctx.comparison!.viewport : ctx.viewport;
    if (!useCmp && crossesFold(ctx.element.rect, fold)) return null; // hingeRule covers it
    const shell = hingeContainers(ctx, fold, ctx.viewport.width).shell;
    const target = shell?.classSelector || shell?.selector || ctx.element.classSelector;
    if (!target) return null;
    const band = `${fold.axis === 'vertical' ? 'x' : 'y'} ${r0(fold.offset)}–${r0(fold.offset + fold.maskLength)}`;
    return {
      rule: this.id,
      topics: ['layout'],
      weight: 0.8,
      summary: `For ${viewport.deviceName} expanded (${viewport.width}×${viewport.height}), lay ${target} out as two segments around the ${fold.kind} at ${band}.`,
      facts: [{ text: `At ${viewport.width}×${viewport.height} the ${fold.kind} occupies ${band} (${fold.maskLength}px).`, evidence: [`${useCmp ? 'comparison.fold' : 'fold'}: ${fold.axis} ${fold.kind} ${band}`] }],
      causes: [],
      fixes: [
        {
          id: 'expanded-segments',
          title: `Two-segment layout for ${target}`,
          rationale: 'Use the second screen instead of stretching one column across the hinge: one segment per column, the hinge as the gap. Includes a px fallback for this device.',
          css: segmentFix(target, fold, viewport, target),
          expectedEffect: `Content splits into ${r0(fold.offset)}px | ${r0((fold.axis === 'vertical' ? viewport.width : viewport.height) - fold.offset - fold.maskLength)}px columns with nothing under the ${fold.kind}.`,
          affectedElements: [target],
          risks: ['Children become grid items; decide which content goes to which segment (grid-column / order).', 'Verify the folded posture is unchanged.'],
          tests: [`At ${viewport.width}×${viewport.height}: no interactive element intersects ${band}`, 'Folded layout unchanged'],
        },
      ],
      assumptions: ['The proposal is structural; content placement per segment needs a design decision.'],
      tests: [],
    };
  },
};

/** Interactive element without an accessible name (markup fix, no CSS). */
export const accessibleNameRule: HeuristicRule = {
  id: 'accessible-name',
  title: 'Missing accessible name',
  run(ctx) {
    const el = ctx.element;
    if (!el.interactive || el.a11y.hidden || el.a11y.name.trim()) return null;
    return {
      rule: this.id,
      topics: ['a11y'],
      weight: 0.6,
      summary: `${el.label} (${el.a11y.role}) has no accessible name.`,
      facts: [{ text: `${el.label} has role ${el.a11y.role} and an empty accessible name.`, evidence: [`element.a11y.role: ${el.a11y.role}`, 'element.a11y.name: ""'] }],
      causes: [{ text: 'No <label>, aria-label, aria-labelledby or text content names the control.', confidence: confidence(0.6, { measured: true }), evidence: ['element.attrs', 'element.a11y.name'] }],
      fixes: [
        {
          id: 'name-control',
          title: 'Name the control in markup',
          rationale: 'Add a visible <label for> (preferred) or aria-label. This is a markup change; there is no CSS to preview.',
          css: [],
          expectedEffect: 'Screen readers announce the control with a meaningful name.',
          affectedElements: [el.selector],
          risks: [],
          tests: ['Accessible name is non-empty and matches the visible label'],
        },
      ],
      assumptions: [],
      tests: [],
    };
  },
};

/** Overflow that originates elsewhere (descendant or ancestor) than the selected element. */
export const overflowElsewhereRule: HeuristicRule = {
  id: 'overflow-elsewhere',
  title: 'Overflow caused by another element',
  run(ctx) {
    const el = ctx.element;
    if (rightOf(el.rect) - ctx.viewport.width > 1) return null;
    const related = ctx.issues.filter((i) => i.rule === 'horizontal-overflow' && i.relation !== 'self');
    if (!related.length) return null;
    const top = related[0];
    return {
      rule: this.id,
      topics: ['overflow', 'general'],
      weight: 0.5,
      summary: `${el.label} itself fits, but ${top.relation === 'descendant' ? 'a descendant' : top.relation === 'ancestor' ? 'an ancestor' : 'another element'} (${top.selector}) overflows the viewport.`,
      facts: related.slice(0, 3).map((i) => ({ text: i.message, evidence: [issueCite(i)] })),
      causes: [{ text: `The horizontal overflow comes from ${top.selector}, not from ${el.label}.`, confidence: confidence(0.6, { issue: true }), evidence: [issueCite(top)] }],
      fixes: [],
      assumptions: [],
      tests: [`Select ${top.selector} and diagnose it`],
    };
  },
};

export const RULES: HeuristicRule[] = [
  fixedWidthRule,
  flexShrinkRule,
  nowrapRule,
  hingeRule,
  hiddenActionRule,
  offscreenRule,
  clippingAncestorRule,
  overflowElsewhereRule,
  tapTargetRule,
  contrastRule,
  lineLengthRule,
  accessibleNameRule,
  postureDiffRule,
  expandedProposalRule,
];

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

export function runRules(ctx: DiagnosisContext, rules = RULES): Finding[] {
  const out: Finding[] = [];
  for (const r of rules) {
    try {
      const f = r.run(ctx);
      if (f) out.push(f);
    } catch {
      /* a rule must never break the diagnosis */
    }
  }
  return out;
}

function relevance(f: Finding, intent: DiagnoseIntent): number {
  if (f.topics[0] === intent) return 1;
  if (f.topics.includes(intent)) return 0.8;
  return intent === 'general' ? 0.7 : 0.35;
}

const uniq = <T,>(xs: T[], key: (x: T) => string) => {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/** Run every rule and merge the findings into one structured diagnosis (deterministic). */
export function heuristicDiagnosis(ctx: DiagnosisContext, question: string, intent: DiagnoseIntent = inferIntent(question)): Diagnosis {
  const ranked = runRules(ctx)
    .map((f) => ({ f, score: f.weight * relevance(f, intent) }))
    .sort((a, b) => b.score - a.score || a.f.rule.localeCompare(b.f.rule));
  // Posture/layout questions focus on posture findings; others drop pure-proposal findings.
  const focus = ranked.filter(({ f, score }) => score >= 0.2 && (intent === 'layout' || f.rule !== 'expanded-layout') && (intent === 'posture' || intent === 'layout' || f.rule !== 'posture-difference'));
  const findings = (focus.length ? focus : ranked).map((x) => x.f);
  const el = ctx.element;
  const measured: ObservedFact = {
    text: `${el.label} measures ${r0(el.rect.width)}×${r0(el.rect.height)}px at x ${r0(el.rect.x)}, y ${r0(el.rect.y)} in ${vpText(ctx)} (display: ${el.layout.display}${el.layout.parentDisplay ? `, parent ${el.layout.parentDisplay}` : ''}).`,
    evidence: [`element.rect: ${rectText(el.rect)}`, `viewport: ${vpText(ctx)}`, 'element.layout'],
  };
  if (!findings.length) {
    return {
      summary: `No layout or accessibility problem matched the offline rules for ${el.label} at ${vpText(ctx)}.`,
      observedFacts: [measured, ...(ctx.pageOverflowPx > 0 ? [{ text: `The page overflows horizontally by ${ctx.pageOverflowPx}px (caused elsewhere).`, evidence: [`pageOverflowPx: ${ctx.pageOverflowPx}`] }] : [])],
      inferredCauses: [],
      proposedFixes: [],
      assumptions: [`The offline engine checks ${RULES.length} known patterns (fixed widths, flex shrink, nowrap, hinge crossing, tap targets, contrast, line length, hidden actions, off-screen and clipped content); it does not read source files or interpret free-form questions.`],
      followUpTests: ['Try another posture or viewport', 'Ask an Anthropic or local model for an open-ended analysis'],
    };
  }
  const top = findings[0];
  const others = findings.length - 1;
  const facts = uniq([measured, ...findings.flatMap((f) => f.facts)], (f) => f.text);
  const causes = uniq(findings.flatMap((f) => f.causes), (c) => c.text).sort((a, b) => b.confidence - a.confidence);
  const fixes = uniq(
    findings.flatMap((f) => f.fixes.map((x) => ({ ...x, id: `${f.rule}:${x.id}` }))),
    (x) => JSON.stringify(x.css) + (x.css.length ? '' : x.title),
  );
  const assumptions = uniq(
    [
      ...findings.flatMap((f) => f.assumptions),
      'Offline heuristic engine: deterministic rules over the measured DOM, styles and audits of this preview; it does not read source files.',
      ...(intent === 'general' && question.trim() && !/^why is this overflowing|^why does it look different|^suggest an accessible fix|^propose a layout/i.test(question.trim())
        ? ['The offline engine does not interpret free-form questions; it reports its rule results. Ask an Anthropic or local model for open questions.']
        : []),
    ],
    (s) => s,
  );
  const tests = uniq([...findings.flatMap((f) => f.tests), ...fixes.flatMap((x) => x.tests.slice(0, 1)), 'Re-run checks at both postures after applying a fix'], (s) => s).slice(0, 8);
  return {
    summary: others ? `${top.summary} (${others} more finding${others === 1 ? '' : 's'} below.)` : top.summary,
    observedFacts: facts.slice(0, 16),
    inferredCauses: causes.slice(0, 8),
    proposedFixes: fixes.slice(0, 6),
    assumptions,
    followUpTests: tests,
  };
}
