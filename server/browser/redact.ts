/**
 * Redaction for data that leaves the controlled browser (network URLs, console
 * text). Network entries never include headers or bodies; this only scrubs what
 * remains: query/fragment parameters and credentials embedded in URLs.
 */

/** Parameter names that are always redacted. */
const SENSITIVE_EXACT = new Set([
  'code',
  'key',
  'sig',
  'sid',
  'pin',
  'otp',
  'pwd',
  'pass',
  'auth',
  'acct',
  'iban',
  'cvv',
  'cvc',
  'nonce',
  'state',
  'jwt',
]);

/** Parameter names containing any of these fragments are redacted. */
const SENSITIVE_FRAGMENTS = /token|passw|secret|session|ssn|account|apikey|api[_-]key|private[_-]?key|signature|credential|authorization|routing|card/i;

export function isSensitiveParam(name: string): boolean {
  const n = name.trim().toLowerCase();
  return SENSITIVE_EXACT.has(n) || SENSITIVE_FRAGMENTS.test(n);
}

const MAX_URL = 2048;

/** Redact a URL for display. Returns the scrubbed URL and whether anything was removed. */
export function redactUrl(raw: string): { url: string; redacted: boolean } {
  if (raw.startsWith('data:')) {
    const mime = /^data:([^;,]*)/.exec(raw)?.[1] || 'text/plain';
    return { url: `data:${mime};… (${raw.length} chars)`, redacted: false };
  }
  if (raw.startsWith('blob:')) return { url: raw.slice(0, 120), redacted: false };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { url: raw.slice(0, MAX_URL), redacted: false };
  }
  let redacted = false;
  if (u.username || u.password) {
    u.username = '';
    u.password = '';
    redacted = true;
  }
  for (const k of [...new Set(u.searchParams.keys())]) {
    if (isSensitiveParam(k)) {
      u.searchParams.set(k, 'REDACTED');
      redacted = true;
    }
  }
  // OAuth implicit flows and SPA routers put secrets in the fragment ("#access_token=…").
  if (u.hash.includes('=')) {
    const hash = u.hash.slice(1);
    const q = hash.indexOf('?');
    const [prefix, query] = q >= 0 ? [hash.slice(0, q + 1), hash.slice(q + 1)] : /^[\w.-]+=/.test(hash) ? ['', hash] : [hash, ''];
    if (query) {
      const params = new URLSearchParams(query);
      let changed = false;
      for (const k of [...new Set(params.keys())]) {
        if (isSensitiveParam(k)) {
          params.set(k, 'REDACTED');
          changed = true;
        }
      }
      if (changed) {
        u.hash = prefix + params.toString();
        redacted = true;
      }
    }
  }
  const out = u.toString();
  return { url: out.length > MAX_URL ? out.slice(0, MAX_URL) + '…' : out, redacted };
}

const SECRET_KV = /((?:pass(?:word)?|passwd|pwd|token|secret|authorization|api[_-]?key|session(?:id)?|ssn|cvv|bearer)["']?\s*[:= ]\s*["']?)([^\s"',;&}]{3,})/gi;

/** Scrub `password=…`, `token: …`, `Bearer …` style secrets from free text. */
export function redactText(s: string, max = 4000): string {
  const out = s.replace(SECRET_KV, '$1[redacted]');
  return out.length > max ? out.slice(0, max) + '…' : out;
}
