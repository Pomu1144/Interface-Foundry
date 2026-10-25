/**
 * Redaction applied to every diagnosis context before it leaves the studio
 * (and before the offline engine sees it, so all providers get the same view).
 *
 *  - no form values (value / checked / selected attributes are removed)
 *  - long or opaque attribute values (tokens, hashes, generated ids) are replaced
 *  - digit runs of 6+ (account / card / phone numbers) are masked
 *  - free text is truncated
 *  - URLs keep their path and hash route only
 */
import type { DiagnosisContext } from './schema';

export type RedactionStats = { masked: number; opaque: number; dropped: number; truncated: number };

export const TEXT_LIMIT = 160;
const ATTR_LIMIT = 80;

/** Digit runs of 6+ digits, allowing single space/dash/dot separators ("1234 5678", "12-345-678"). */
const DIGIT_RUN = /\d(?:[ .-]?\d){5,}/g;

const FORM_VALUE_ATTRS = new Set(['value', 'checked', 'selected', 'defaultvalue', 'data-value']);
const KEEP_VERBATIM_ATTRS = new Set(['class', 'role', 'type', 'for', 'tabindex', 'hidden', 'disabled', 'dir', 'lang', 'inputmode', 'autocomplete', 'loading', 'width', 'height']);
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'poster', 'srcset', 'data-src']);

export function newStats(): RedactionStats {
  return { masked: 0, opaque: 0, dropped: 0, truncated: 0 };
}

/** Mask long digit runs, keeping length information but not the digits. */
export function maskDigits(s: string, stats?: RedactionStats): string {
  return s.replace(DIGIT_RUN, (m) => {
    if (stats) stats.masked++;
    return m.replace(/\d/g, '•');
  });
}

export function truncate(s: string, limit = TEXT_LIMIT, stats?: RedactionStats): string {
  if (s.length <= limit) return s;
  if (stats) stats.truncated++;
  return s.slice(0, limit - 1) + '…';
}

/** A value that looks like a token, hash, JWT, UUID or generated id rather than human text. */
export function isOpaque(value: string): boolean {
  const v = value.trim();
  if (v.length < 16) return false;
  if (/\s/.test(v)) return false;
  if (/^eyJ[\w-]+\.[\w-]+\.[\w-]*$/.test(v)) return true; // JWT
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return true; // UUID
  if (/^[0-9a-f]{16,}$/i.test(v)) return true; // hex
  if (/^[A-Za-z0-9+/_=-]{20,}$/.test(v)) {
    // Mixed case + digits with no word structure looks generated.
    const classes = [/[a-z]/, /[A-Z]/, /\d/].filter((r) => r.test(v)).length;
    const vowels = (v.match(/[aeiou]/gi) ?? []).length / v.length;
    return classes >= 3 || vowels < 0.15;
  }
  return false;
}

/** Keep only path + hash of a URL (drops origin credentials and query strings). */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw, 'http://ifdy.invalid');
    const path = u.pathname + (u.hash ? u.hash.split('?')[0] : '');
    return u.origin === 'http://ifdy.invalid' || u.protocol.startsWith('http') ? path : `${u.protocol}…`;
  } catch {
    return raw.split('?')[0].slice(0, ATTR_LIMIT);
  }
}

export function redactText(s: string | undefined, stats?: RedactionStats, limit = TEXT_LIMIT): string | undefined {
  if (s === undefined) return undefined;
  return truncate(maskDigits(s.replace(/\s+/g, ' ').trim(), stats), limit, stats);
}

/** Redact attribute pairs: form values removed, URLs reduced, opaque values replaced, digits masked. */
export function redactAttrs(attrs: [string, string][], stats?: RedactionStats): [string, string][] {
  const out: [string, string][] = [];
  for (const [rawName, rawValue] of attrs) {
    const name = rawName.toLowerCase();
    if (FORM_VALUE_ATTRS.has(name)) {
      if (stats) stats.dropped++;
      continue;
    }
    if (name === 'style') {
      out.push([name, truncate(maskDigits(rawValue, stats), ATTR_LIMIT, stats)]);
      continue;
    }
    if (URL_ATTRS.has(name)) {
      out.push([name, truncate(maskDigits(redactUrl(rawValue), stats), ATTR_LIMIT, stats)]);
      continue;
    }
    if (KEEP_VERBATIM_ATTRS.has(name)) {
      out.push([name, truncate(rawValue, ATTR_LIMIT, stats)]);
      continue;
    }
    if (isOpaque(rawValue)) {
      if (stats) stats.opaque++;
      out.push([name, '[opaque]']);
      continue;
    }
    out.push([name, truncate(maskDigits(rawValue, stats), ATTR_LIMIT, stats)]);
  }
  return out;
}

/** Mask digit runs inside a selector (e.g. `#acct-12345678`) — the original is kept locally for re-mapping fixes. */
export function redactSelector(selector: string, map: Record<string, string>, stats?: RedactionStats): string {
  const masked = maskDigits(selector, stats);
  if (masked !== selector) map[masked] = selector;
  return masked;
}

/**
 * Final pass over an assembled context. Selectors and attribute values are
 * redacted in place; returns the stats and the masked → original selector map.
 */
export function redactContext(ctx: DiagnosisContext): { context: DiagnosisContext; stats: RedactionStats; selectorMap: Record<string, string> } {
  const stats = newStats();
  const map: Record<string, string> = {};
  const sel = (s: string) => redactSelector(s, map, stats);
  const c: DiagnosisContext = structuredCloneSafe(ctx);
  c.page = { route: truncate(maskDigits(redactUrl(c.page.route), stats), 120, stats), title: redactText(c.page.title, stats, 120) ?? '' };
  const el = c.element;
  el.selector = sel(el.selector);
  el.classSelector = sel(el.classSelector);
  el.label = maskDigits(el.label, stats);
  el.path = el.path.map((p) => maskDigits(p, stats));
  el.attrs = redactAttrs(el.attrs, stats);
  el.text = redactText(el.text, stats);
  el.a11y = { ...el.a11y, name: redactText(el.a11y.name, stats, 120) ?? '' };
  el.layout.overflowAncestors = el.layout.overflowAncestors.map((a) => ({ ...a, label: maskDigits(a.label, stats) }));
  for (const a of c.ancestors) {
    a.selector = sel(a.selector);
    a.classSelector = sel(a.classSelector);
    a.label = maskDigits(a.label, stats);
  }
  const issue = (i: DiagnosisContext['issues'][number]) => {
    i.selector = sel(i.selector);
    i.message = redactText(i.message, stats, 300) ?? '';
    for (const [k, v] of Object.entries(i.evidence)) if (typeof v === 'string') i.evidence[k] = truncate(maskDigits(v, stats), ATTR_LIMIT, stats);
  };
  c.issues.forEach(issue);
  if (c.comparison) c.comparison.issues.forEach(issue);
  c.console = c.console.map((e) => ({ ...e, message: redactText(e.message, stats, 300) ?? '', source: e.source ? maskDigits(redactUrl(e.source), stats) : undefined }));
  c.recentChanges = c.recentChanges.map((s) => truncate(maskDigits(s, stats), 200, stats));
  if (c.styles) {
    c.styles.variables = c.styles.variables.map((v) => ({ name: v.name, value: isOpaque(v.value) ? '[opaque]' : truncate(v.value, ATTR_LIMIT, stats) }));
  }
  return { context: c, stats, selectorMap: map };
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Undo selector masking in fixes returned by a provider (only exact masked selectors we produced). */
export function restoreSelector(selector: string, map: Record<string, string>): string {
  if (map[selector]) return map[selector];
  let out = selector;
  for (const [masked, original] of Object.entries(map)) if (out.includes(masked)) out = out.split(masked).join(original);
  return out;
}
