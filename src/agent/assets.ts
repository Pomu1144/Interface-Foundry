import type { PageAsset, TokenUsage } from '@shared/protocol';
import { parseDeclarations } from './css-utils';
import { idOf, isIfdyNode, uniqueSelector } from './nodes';
import { walkRules } from './styles';

/**
 * Page asset inventory (images, CSS backgrounds, video, fonts) and custom
 * property usage, for the Assets and Tokens panels. Read-only.
 */

const MAX_ELEMENTS = 5000;

function abs(url: string, base?: string | null): string {
  try {
    return new URL(url, base ?? location.href).href;
  } catch {
    return url;
  }
}

function fileLabel(url: string): string {
  if (url.startsWith('data:')) {
    const mime = /^data:([^;,]+)/.exec(url)?.[1] ?? 'data';
    return `inline ${mime.split('/').pop()}`;
  }
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? u.host);
  } catch {
    return url.slice(0, 60);
  }
}

const isSvg = (url: string) => /\.svg(\?|#|$)/i.test(url) || url.startsWith('data:image/svg');

function urlsIn(value: string): string[] {
  return [...value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)].map((m) => m[2]).filter((u) => u && !u.startsWith('#'));
}

function fontFaces(): { family: string; url: string; weight: string; style: string }[] {
  const out: { family: string; url: string; weight: string; style: string }[] = [];
  const visit = (rules: CSSRuleList | null, base: string | null) => {
    if (!rules) return;
    for (const r of rules) {
      if (r instanceof CSSFontFaceRule) {
        const family = r.style.getPropertyValue('font-family').replace(/^["']|["']$/g, '').trim();
        const src = r.style.getPropertyValue('src');
        const first = urlsIn(src)[0];
        out.push({ family, url: first ? abs(first, base) : '', weight: r.style.getPropertyValue('font-weight') || '400', style: r.style.getPropertyValue('font-style') || 'normal' });
      } else if ('cssRules' in r) {
        let nested: CSSRuleList | null = null;
        try {
          nested = (r as CSSGroupingRule).cssRules;
        } catch {
          nested = null;
        }
        visit(nested, base);
      }
      if (r instanceof CSSImportRule && r.styleSheet) {
        try {
          visit(r.styleSheet.cssRules, r.styleSheet.href ?? base);
        } catch {
          /* cross-origin */
        }
      }
    }
  };
  for (const sheet of document.styleSheets) {
    if (sheet.ownerNode && isIfdyNode(sheet.ownerNode)) continue;
    try {
      visit(sheet.cssRules, sheet.href);
    } catch {
      /* cross-origin sheet */
    }
  }
  return out;
}

export function scanAssets(): PageAsset[] {
  const map = new Map<string, PageAsset>();
  const add = (key: string, make: () => PageAsset) => {
    const existing = map.get(key);
    if (existing) existing.count++;
    else map.set(key, make());
  };

  // <img> and <picture>
  for (const img of document.images) {
    if (isIfdyNode(img)) continue;
    const url = img.currentSrc || img.src;
    if (!url) continue;
    add(`img|${url}`, () => ({
      kind: isSvg(url) ? 'icon' : 'image',
      url,
      label: fileLabel(url),
      count: 1,
      selector: uniqueSelector(img),
      nodeId: idOf(img),
      width: img.naturalWidth || undefined,
      height: img.naturalHeight || undefined,
      alt: img.getAttribute('alt') ?? undefined,
    }));
  }

  // <video> / poster
  for (const v of document.querySelectorAll('video')) {
    if (isIfdyNode(v)) continue;
    const url = v.currentSrc || v.src || v.querySelector('source')?.src || '';
    if (url) add(`video|${url}`, () => ({ kind: 'video', url, label: fileLabel(url), count: 1, selector: uniqueSelector(v), nodeId: idOf(v), width: v.videoWidth || undefined, height: v.videoHeight || undefined }));
    if (v.poster) add(`img|${v.poster}`, () => ({ kind: 'image', url: v.poster, label: fileLabel(v.poster), count: 1, selector: uniqueSelector(v), nodeId: idOf(v) }));
  }

  // CSS background images + fonts in use (computed styles).
  const familyUse = new Map<string, number>();
  let n = 0;
  for (const el of document.body?.querySelectorAll('*') ?? []) {
    if (n++ > MAX_ELEMENTS) break;
    if (isIfdyNode(el)) continue;
    const cs = getComputedStyle(el);
    const bg = cs.backgroundImage;
    if (bg && bg !== 'none') {
      for (const u of urlsIn(bg)) {
        const url = abs(u);
        add(`bg|${url}`, () => ({ kind: isSvg(url) ? 'icon' : 'background', url, label: fileLabel(url), count: 1, selector: uniqueSelector(el), nodeId: idOf(el) }));
      }
    }
    const hasText = [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent?.trim());
    if (hasText) {
      const first = cs.fontFamily.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
      if (first) familyUse.set(first, (familyUse.get(first) ?? 0) + 1);
    }
  }

  const faces = fontFaces();
  const status = new Map<string, string>();
  try {
    for (const f of document.fonts) status.set(`${f.family.replace(/^["']|["']$/g, '')}|${f.weight}|${f.style}`, f.status);
  } catch {
    /* FontFaceSet not iterable */
  }
  const seenFamilies = new Set<string>();
  for (const f of faces) {
    const key = `font|${f.family}|${f.weight}|${f.style}`;
    if (map.has(key)) continue;
    seenFamilies.add(f.family.toLowerCase());
    const st = status.get(`${f.family}|${f.weight}|${f.style}`) as PageAsset['status'] | undefined;
    map.set(key, {
      kind: 'font',
      url: f.url,
      label: `${f.family} ${f.weight}${f.style !== 'normal' ? ` ${f.style}` : ''}`,
      family: f.family,
      weight: f.weight,
      style: f.style,
      status: st ?? 'unloaded',
      count: familyUse.get(f.family) ?? 0,
    });
  }
  for (const [family, count] of familyUse) {
    if (seenFamilies.has(family.toLowerCase())) continue;
    map.set(`font|${family}|system`, { kind: 'font', url: '', label: family, family, status: 'system', count });
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 600);
}

export function tokenUsage(name: string): TokenUsage[] {
  if (!/^--[\w-]+$/.test(name)) return [];
  const out: TokenUsage[] = [];
  const re = new RegExp(`var\\(\\s*${name.replace(/[-]/g, '\\-')}(?![\\w-])`);
  walkRules((v) => {
    if (out.length >= 300) return;
    const owner = v.sheet.ownerNode;
    if (owner && isIfdyNode(owner)) return;
    for (const d of parseDeclarations(v.rule.style.cssText)) {
      if (!re.test(d.value)) continue;
      let matches = 0;
      try {
        matches = document.querySelectorAll(v.rule.selectorText).length;
      } catch {
        matches = 0;
      }
      const href = v.sheet.href;
      const source = href ? (new URL(href, location.href).pathname.split('/').pop() ?? href) : `<style> #${v.sheetIndex}`;
      out.push({ selector: v.rule.selectorText, property: d.property, value: d.value, source, media: v.media.length ? v.media.join(' and ') : undefined, matches });
    }
  });
  // Inline styles.
  let n = 0;
  for (const el of document.querySelectorAll('[style]')) {
    if (n++ > MAX_ELEMENTS || out.length >= 300) break;
    if (isIfdyNode(el)) continue;
    for (const d of parseDeclarations((el as HTMLElement).style.cssText)) {
      if (re.test(d.value)) out.push({ selector: uniqueSelector(el), property: d.property, value: d.value, source: 'inline style', matches: 1 });
    }
  }
  return out;
}
