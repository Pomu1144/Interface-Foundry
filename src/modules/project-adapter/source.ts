import type { PreviewSource } from '@/store';
import { previewOrigin } from './server-api';

/** URL loaded into a preview for `source` at `route` (hash route or relative path). */
export function sourceUrl(source: PreviewSource, route: string): string {
  const withRoute = (base: string) => {
    if (!route) return base;
    if (route.startsWith('#')) return base.replace(/#.*$/, '') + route;
    if (/^https?:/.test(route)) return route;
    const u = new URL(route.replace(/^\//, ''), base.replace(/[^/]*$/, ''));
    return u.href;
  };
  switch (source.kind) {
    case 'demo':
      return withRoute(`${previewOrigin()}/demo/${source.entry}`);
    case 'vfs':
      return withRoute(`${previewOrigin()}/p/${source.projectId}/${source.entry}`);
    case 'fs':
      return withRoute(`${previewOrigin()}/fs/${source.rootId}/${source.entry}`);
    case 'proxy':
      return withRoute(`${source.origin.replace(/\/$/, '')}/${source.entry.replace(/^\//, '')}`);
    case 'url':
      return route && /^https?:/.test(route) ? route : source.url;
  }
}

/**
 * Inverse of sourceUrl: the route that a URL loaded in the preview corresponds
 * to, so that sourceUrl(source, routeFromUrl(source, url)) === url. Paths are
 * kept relative to the entry's directory; feeding an absolute pathname back
 * into sourceUrl would nest it under the base again (/fs/0/fs/0/...).
 */
export function routeFromUrl(source: PreviewSource | null, url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return '';
  }
  if (!source || source.kind === 'url') return u.hash || u.pathname;
  const entry = new URL(sourceUrl(source, ''));
  if (u.origin === entry.origin && u.pathname === entry.pathname && u.hash) return u.hash;
  const dir = entry.origin + entry.pathname.replace(/[^/]*$/, '');
  const here = u.origin + u.pathname + u.search;
  if (here.startsWith(dir)) return here.slice(dir.length) + u.hash;
  return u.href;
}

export function sourceSupportsInspection(source: PreviewSource | null): boolean {
  return Boolean(source && (source.kind !== 'url' || source.engine === 'remote'));
}

export function describeSource(source: PreviewSource | null): string {
  if (!source) return 'No project';
  switch (source.kind) {
    case 'demo':
      return 'Synthetic demo';
    case 'vfs':
      return 'Imported static project';
    case 'fs':
      return 'Local directory (companion)';
    case 'proxy':
      return `Local dev server · ${source.target}`;
    case 'url':
      return source.engine === 'remote' ? 'Controlled Chromium' : 'Embedded URL (read-only)';
  }
}
