/**
 * AI layout debugger: the contract shared by the studio, the companion server
 * and every provider (Anthropic, local OpenAI-compatible, offline heuristics).
 *
 * Keep this file free of runtime imports (the server imports it by relative path).
 */
import type { Insets, Rect, ViewportContext } from '../../shared/types';

/* ------------------------------------------------------------------ */
/* Diagnosis result                                                    */
/* ------------------------------------------------------------------ */

export type ObservedFact = { text: string; evidence: string[] };
export type InferredCause = { text: string; confidence: number; evidence: string[] };
export type CssEdit = { selector: string; property: string; value: string; media?: string };
export type ProposedFix = {
  id: string;
  title: string;
  rationale: string;
  css: CssEdit[];
  expectedEffect: string;
  affectedElements: string[];
  risks: string[];
  tests: string[];
};
export type Diagnosis = {
  summary: string;
  observedFacts: ObservedFact[];
  inferredCauses: InferredCause[];
  proposedFixes: ProposedFix[];
  assumptions: string[];
  followUpTests: string[];
};

/* ------------------------------------------------------------------ */
/* Context (what a provider sees; always redacted first)               */
/* ------------------------------------------------------------------ */

export type CtxDeclaration = { property: string; value: string; important?: boolean; overridden?: boolean; disabled?: boolean };

export type CtxRule = {
  selector: string;
  origin: 'inline' | 'author' | 'override' | 'user-agent';
  /** "login.css:49", "inline", "<style> #2" … line numbers are approximate. */
  source: string;
  media?: string[];
  specificity: [number, number, number];
  declarations: CtxDeclaration[];
};

export type CtxIssue = {
  rule: string;
  title: string;
  severity: string;
  message: string;
  selector: string;
  /** How the issue's element relates to the selected element. */
  relation: 'self' | 'ancestor' | 'descendant' | 'page';
  evidence: Record<string, string | number | boolean>;
  suggestion?: string;
};

export type CtxFold = { axis: 'vertical' | 'horizontal'; offset: number; maskLength: number; kind: 'hinge' | 'crease' };

export type CtxElement = {
  selector: string;
  /** Class-level selector (tag + stable classes) for selector-scoped fixes. */
  classSelector: string;
  label: string;
  tag: string;
  path: string[];
  classes: string[];
  attrs: [string, string][];
  text?: string;
  rect: Rect;
  box: { content: Rect; padding: Insets; border: Insets; margin: Insets; boxSizing: string; position: string };
  layout: {
    display: string;
    parentDisplay?: string;
    flexDirection?: string;
    isFlexItem: boolean;
    isGridItem: boolean;
    isPositioned: boolean;
    overflowAncestors: { label: string; overflow: string }[];
  };
  computed: Record<string, string>;
  a11y: {
    role: string;
    name: string;
    focusable: boolean;
    hidden: boolean;
    states: string[];
    contrast?: { ratio: number; fg: string; bg: string; aa: boolean; aaLarge: boolean; fontSize: number; bold: boolean };
  };
  component?: { name: string; source?: string };
  interactive: boolean;
  primary: boolean;
};

export type CtxAncestor = {
  selector: string;
  classSelector: string;
  label: string;
  tag: string;
  rect: Rect;
  /** Content-box left/right edges, for placing children precisely. */
  contentLeft: number;
  contentRight: number;
  /** Visible element children (from the DOM snapshot), when known. */
  childCount?: number;
  computed: Record<string, string>;
};

export type CtxComparison = {
  viewport: ViewportContext;
  fold: CtxFold | null;
  /** How the measurement was taken. */
  method: 'compare-preview' | 'worker-probe';
  element: { found: boolean; visible: boolean; rect?: Rect; computed?: Record<string, string> } | null;
  issues: CtxIssue[];
  issueCounts: Record<string, number>;
  /** Rules that match the element only at the current viewport / only at the comparison viewport. */
  rulesOnlyHere: CtxRule[];
  rulesOnlyThere: CtxRule[];
};

export type DiagnosisContext = {
  schemaVersion: 1;
  page: { route: string; title: string };
  viewport: ViewportContext;
  fold: CtxFold | null;
  element: CtxElement;
  /** Nearest first. */
  ancestors: CtxAncestor[];
  styles: {
    matched: CtxRule[];
    inline: CtxRule | null;
    inherited: { from: string; rules: CtxRule[] }[];
    activeMedia: string[];
    variables: { name: string; value: string }[];
    inaccessibleSheets: number;
  } | null;
  /** Every @media query found in the page's accessible stylesheets (active or not). */
  pageMedia: string[];
  /** Horizontal page overflow at the current viewport, in px (0 = none). */
  pageOverflowPx: number;
  issues: CtxIssue[];
  issueCounts: Record<string, number>;
  comparison: CtxComparison | null;
  console: { level: string; message: string; source?: string; count: number }[];
  recentChanges: string[];
  /** Where each part of the context came from (scope labels). */
  notes: string[];
};

/* ------------------------------------------------------------------ */
/* Wire protocol                                                       */
/* ------------------------------------------------------------------ */

export type AiProviderId = 'anthropic' | 'local' | 'heuristic';
export type DiagnoseIntent = 'overflow' | 'posture' | 'a11y' | 'layout' | 'general';

export type HistoryTurn = { question: string; summary: string; fixes: string[] };

export type DiagnoseRequest = {
  provider: 'anthropic' | 'local';
  question: string;
  intent: DiagnoseIntent;
  context: DiagnosisContext;
  history: HistoryTurn[];
};

export type ProgressStage = 'queued' | 'sending' | 'thinking' | 'writing' | 'validating' | 'repairing';

export type DiagnoseEvent =
  | { type: 'progress'; stage: ProgressStage; message: string; chars?: number; thinking?: string }
  | {
      type: 'result';
      diagnosis: Diagnosis;
      provider: AiProviderId;
      model: string;
      /** Model that actually answered (differs when a server-side fallback ran). */
      servedBy?: string;
      repairs: string[];
      durationMs: number;
      usage?: { input: number; output: number };
    }
  | { type: 'error'; message: string; code?: string };

export type AiStatus = {
  providers: {
    heuristic: { available: true };
    anthropic: { configured: boolean; model: string };
    local: { configured: boolean; model: string | null; endpoint: string | null };
  };
  limits: { maxBodyBytes: number; perMinute: number };
};

export const MAX_REQUEST_BYTES = 512 * 1024;
export const MAX_QUESTION_CHARS = 2000;
export const MAX_HISTORY_TURNS = 6;

/* ------------------------------------------------------------------ */
/* JSON Schema (structured outputs)                                    */
/* ------------------------------------------------------------------ */

const str = { type: 'string' } as const;
const strArr = { type: 'array', items: str } as const;

/**
 * Structured-output schema. Every object has `additionalProperties: false` and
 * lists all properties as required (optional values are nullable instead), and
 * numeric ranges are enforced by `validateDiagnosis` because JSON-schema
 * numeric constraints are not supported by structured outputs.
 */
export const DIAGNOSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'observedFacts', 'inferredCauses', 'proposedFixes', 'assumptions', 'followUpTests'],
  properties: {
    summary: str,
    observedFacts: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['text', 'evidence'], properties: { text: str, evidence: strArr } },
    },
    inferredCauses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'confidence', 'evidence'],
        properties: { text: str, confidence: { type: 'number' }, evidence: strArr },
      },
    },
    proposedFixes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'rationale', 'css', 'expectedEffect', 'affectedElements', 'risks', 'tests'],
        properties: {
          id: str,
          title: str,
          rationale: str,
          css: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['selector', 'property', 'value', 'media'],
              properties: { selector: str, property: str, value: str, media: { anyOf: [str, { type: 'null' }] } },
            },
          },
          expectedEffect: str,
          affectedElements: strArr,
          risks: strArr,
          tests: strArr,
        },
      },
    },
    assumptions: strArr,
    followUpTests: strArr,
  },
} as const;

/* ------------------------------------------------------------------ */
/* Validation & repair                                                 */
/* ------------------------------------------------------------------ */

export type ValidationResult = { ok: true; value: Diagnosis; repairs: string[] } | { ok: false; errors: string[] };

const LIMITS = { facts: 40, causes: 20, fixes: 12, css: 24, strings: 30, text: 1500, short: 300 };

/** Pull the first JSON object out of model text (handles ```json fences and prose around it). */
export function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      /* fall through */
    }
  }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const FORBIDDEN_ANY = /[{}<;]|\/\*|\*\//;
/** Media queries may use range syntax (`width < 600px`), so only `<` before `/` is forbidden there. */
const FORBIDDEN_MEDIA = /[{};]|\/\*|\*\/|<\/|@|\\/;
const FORBIDDEN_VALUE = /\\|url\s*\(|image-set\s*\(|expression\s*\(|@import|javascript:/i;

/** Check one CSS edit before it can reach an override stylesheet. Returns the cleaned edit or an error. */
export function checkCssEdit(raw: unknown): { ok: true; value: CssEdit; repaired: boolean } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'css entry is not an object' };
  const r = raw as Record<string, unknown>;
  let repaired = false;
  const selector = typeof r.selector === 'string' ? r.selector.trim() : '';
  let property = typeof r.property === 'string' ? r.property.trim() : '';
  let value = typeof r.value === 'string' ? r.value.trim() : typeof r.value === 'number' ? String(r.value) : '';
  let media = typeof r.media === 'string' ? r.media.trim() : undefined;
  if (!selector || selector.length > LIMITS.short) return { ok: false, error: `invalid selector "${String(r.selector).slice(0, 60)}"` };
  if (FORBIDDEN_ANY.test(selector) || selector.includes('@')) return { ok: false, error: `unsafe selector "${selector.slice(0, 60)}"` };
  if (property !== property.toLowerCase() && !property.startsWith('--')) {
    property = property.toLowerCase();
    repaired = true;
  }
  if (!/^(--[A-Za-z0-9_-]{1,62}|-?[a-z][a-z0-9-]{0,62})$/.test(property)) return { ok: false, error: `invalid property "${property.slice(0, 60)}"` };
  if (/!\s*important\s*$/i.test(value)) {
    value = value.replace(/!\s*important\s*$/i, '').trim();
    repaired = true;
  }
  if (!value || value.length > LIMITS.short) return { ok: false, error: `invalid value for ${property}` };
  if (FORBIDDEN_ANY.test(value) || FORBIDDEN_VALUE.test(value)) return { ok: false, error: `unsafe value for ${property}` };
  if (media !== undefined) {
    if (/^@media\s+/i.test(media)) {
      media = media.replace(/^@media\s+/i, '').trim();
      repaired = true;
    }
    if (!media || media === 'all') media = undefined;
    else if (media.length > LIMITS.short || FORBIDDEN_MEDIA.test(media)) return { ok: false, error: `unsafe media query "${media.slice(0, 60)}"` };
  }
  return { ok: true, value: media ? { selector, property, value, media } : { selector, property, value }, repaired };
}

const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function stringList(v: unknown, field: string, repairs: string[], limit = LIMITS.strings): string[] {
  if (v === undefined || v === null) {
    repairs.push(`${field}: missing, defaulted to []`);
    return [];
  }
  if (typeof v === 'string') {
    repairs.push(`${field}: string wrapped in a list`);
    return v.trim() ? [cap(v.trim(), LIMITS.text)] : [];
  }
  if (!Array.isArray(v)) {
    repairs.push(`${field}: not a list, dropped`);
    return [];
  }
  const out = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => cap(x.trim(), LIMITS.text));
  if (out.length !== v.length) repairs.push(`${field}: dropped ${v.length - out.length} non-text entr${v.length - out.length === 1 ? 'y' : 'ies'}`);
  if (out.length > limit) {
    repairs.push(`${field}: truncated to ${limit}`);
    return out.slice(0, limit);
  }
  return out;
}

function list(v: unknown, field: string, repairs: string[]): unknown[] {
  if (v === undefined || v === null) {
    repairs.push(`${field}: missing, defaulted to []`);
    return [];
  }
  if (!Array.isArray(v)) {
    repairs.push(`${field}: not a list, dropped`);
    return [];
  }
  return v;
}

function textOf(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Normalise a confidence value into [0, 1]; percentages and numeric strings are accepted. */
export function normaliseConfidence(v: unknown): { value: number; repaired: boolean } | null {
  let n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace('%', '')) : NaN;
  let repaired = typeof v !== 'number';
  if (!Number.isFinite(n)) return null;
  if (n > 1 && n <= 100) {
    n = n / 100;
    repaired = true;
  }
  if (n < 0 || n > 1) {
    n = Math.min(1, Math.max(0, n));
    repaired = true;
  }
  return { value: Math.round(n * 100) / 100, repaired };
}

/**
 * Validate (and conservatively repair) a model's diagnosis. Anything that could
 * reach the preview as CSS is checked strictly; malformed entries are dropped and
 * every repair is reported so the UI can say what changed.
 */
export function validateDiagnosis(input: unknown): ValidationResult {
  const repairs: string[] = [];
  let raw = input;
  if (typeof raw === 'string') {
    raw = extractJson(raw);
    repairs.push('parsed JSON from text');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['output is not a JSON object'] };
  const o = raw as Record<string, unknown>;
  const known = new Set(['summary', 'observedFacts', 'inferredCauses', 'proposedFixes', 'assumptions', 'followUpTests']);
  for (const k of Object.keys(o)) if (!known.has(k)) repairs.push(`ignored unknown field "${cap(k, 40)}"`);

  const observedFacts: ObservedFact[] = [];
  for (const [i, f] of list(o.observedFacts, 'observedFacts', repairs).entries()) {
    const text = typeof f === 'string' ? f.trim() : textOf((f as Record<string, unknown> | null)?.text);
    if (!text) {
      repairs.push(`observedFacts[${i}]: no text, dropped`);
      continue;
    }
    const evidence = typeof f === 'object' && f ? stringList((f as Record<string, unknown>).evidence, `observedFacts[${i}].evidence`, repairs, 12) : [];
    observedFacts.push({ text: cap(text, LIMITS.text), evidence });
  }

  const inferredCauses: InferredCause[] = [];
  for (const [i, c] of list(o.inferredCauses, 'inferredCauses', repairs).entries()) {
    const rec = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
    const text = textOf(rec.text);
    if (!text) {
      repairs.push(`inferredCauses[${i}]: no text, dropped`);
      continue;
    }
    const conf = normaliseConfidence(rec.confidence);
    if (!conf) repairs.push(`inferredCauses[${i}]: confidence missing, set to 0.5`);
    else if (conf.repaired) repairs.push(`inferredCauses[${i}]: confidence normalised to ${conf.value}`);
    inferredCauses.push({ text: cap(text, LIMITS.text), confidence: conf ? conf.value : 0.5, evidence: stringList(rec.evidence, `inferredCauses[${i}].evidence`, repairs, 12) });
  }

  const proposedFixes: ProposedFix[] = [];
  const ids = new Set<string>();
  for (const [i, f] of list(o.proposedFixes, 'proposedFixes', repairs).entries()) {
    const rec = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
    const title = textOf(rec.title);
    if (!title) {
      repairs.push(`proposedFixes[${i}]: no title, dropped`);
      continue;
    }
    const rawCss = list(rec.css, `proposedFixes[${i}].css`, repairs);
    const css: CssEdit[] = [];
    let unsafe = 0;
    for (const [j, e] of rawCss.entries()) {
      const r = checkCssEdit(e);
      if (r.ok) {
        css.push(r.value);
        if (r.repaired) repairs.push(`proposedFixes[${i}].css[${j}]: normalised`);
      } else {
        unsafe++;
        repairs.push(`proposedFixes[${i}].css[${j}]: ${r.error}, dropped`);
      }
    }
    if (rawCss.length > 0 && css.length === 0) {
      repairs.push(`proposedFixes[${i}]: every CSS edit was rejected (${unsafe}), fix dropped`);
      continue;
    }
    let id = textOf(rec.id).replace(/[^\w-]/g, '-').slice(0, 48) || `fix-${i + 1}`;
    if (!textOf(rec.id)) repairs.push(`proposedFixes[${i}]: missing id, set to ${id}`);
    while (ids.has(id)) id = `${id}-${i + 1}`;
    ids.add(id);
    proposedFixes.push({
      id,
      title: cap(title, 160),
      rationale: cap(textOf(rec.rationale), LIMITS.text),
      css: css.slice(0, LIMITS.css),
      expectedEffect: cap(textOf(rec.expectedEffect), LIMITS.text),
      affectedElements: stringList(rec.affectedElements, `proposedFixes[${i}].affectedElements`, repairs, 12),
      risks: stringList(rec.risks, `proposedFixes[${i}].risks`, repairs, 12),
      tests: stringList(rec.tests, `proposedFixes[${i}].tests`, repairs, 12),
    });
  }

  const assumptions = stringList(o.assumptions, 'assumptions', repairs);
  const followUpTests = stringList(o.followUpTests, 'followUpTests', repairs);
  let summary = textOf(o.summary);
  if (!summary) {
    const fallback = inferredCauses[0]?.text ?? observedFacts[0]?.text;
    if (!fallback) return { ok: false, errors: ['summary is missing and the output contains no facts or causes'] };
    summary = fallback;
    repairs.push('summary: missing, used the first cause/fact');
  }
  inferredCauses.sort((a, b) => b.confidence - a.confidence);
  return {
    ok: true,
    value: {
      summary: cap(summary, LIMITS.text),
      observedFacts: observedFacts.slice(0, LIMITS.facts),
      inferredCauses: inferredCauses.slice(0, LIMITS.causes),
      proposedFixes: proposedFixes.slice(0, LIMITS.fixes),
      assumptions,
      followUpTests,
    },
    repairs,
  };
}

/** Infer the intent of a free-text question (used for routing and prompt hints). */
export function inferIntent(question: string): DiagnoseIntent {
  const q = question.toLowerCase();
  if (/(propose|suggest|design).*(layout|posture)|layout for|use (the )?(both|two) (screens|segments)/.test(q)) return 'layout';
  if (/(expanded|unfold|posture|spanned|hinge|fold|different|compare|other (screen|device|viewport))/.test(q)) return 'posture';
  if (/(accessib|a11y|contrast|tap target|touch target|screen ?reader|keyboard|focus|wcag|label)/.test(q)) return 'a11y';
  if (/(overflow|scroll|wide|cut off|clipp|spill|horizontal|too big|off.?screen|bleed)/.test(q)) return 'overflow';
  return 'general';
}
