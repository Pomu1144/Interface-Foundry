import { describe, expect, it } from 'vitest';
import { routeFromUrl, sourceUrl } from '@/modules/project-adapter/source';
import { studio } from '@/store';
import type { PreviewSource } from '@/store';

const origin = 'http://localhost:5174';
studio().setServer({ previewOrigin: origin });

describe('routeFromUrl', () => {
  const fs = { kind: 'fs', rootId: '0', entry: 'index.html' } as PreviewSource;
  const demo = { kind: 'demo', entry: 'index.html' } as PreviewSource;
  const proxy = { kind: 'proxy', origin: 'http://127.0.0.1:3000', entry: '' } as PreviewSource;

  it('keeps file routes relative so they do not nest under the base again', () => {
    const base = sourceUrl(fs, '');
    expect(base).toBe(`${origin}/fs/0/index.html`);
    const r = routeFromUrl(fs, base);
    expect(r).toBe('index.html');
    expect(sourceUrl(fs, r)).toBe(base);
    const about = base.replace('index.html', 'pages/about.html');
    expect(routeFromUrl(fs, about)).toBe('pages/about.html');
    expect(sourceUrl(fs, routeFromUrl(fs, about))).toBe(about);
  });

  it('returns hash routes for the entry document', () => {
    const url = sourceUrl(demo, '#/login');
    expect(routeFromUrl(demo, url)).toBe('#/login');
    expect(sourceUrl(demo, routeFromUrl(demo, url))).toBe(url);
  });

  it('round-trips proxied dev-server paths', () => {
    const url = 'http://127.0.0.1:3000/settings?tab=2';
    const r = routeFromUrl(proxy, url);
    expect(r).toBe('settings?tab=2');
    expect(sourceUrl(proxy, r)).toBe(url);
  });

  it('keeps URLs outside the source as absolute hrefs', () => {
    expect(routeFromUrl(fs, 'https://example.com/x')).toBe('https://example.com/x');
  });
});
