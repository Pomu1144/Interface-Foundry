import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { injectAgent } from '../../server/agent-bundle';
import { isLoopbackHost, safeJoin } from '../../server/http';
import { rewriteAbsolute, rewriteCssAbsolute } from '../../server/preview-host';
import { normalizePath, VirtualFileSystem } from '../../server/vfs';
import { assertTrustedRequest } from '../../server/router';
import type { IfdyServices } from '../../server/services';

describe('preview host helpers', () => {
  it('injects the agent as the first head script exactly once', () => {
    const html = injectAgent('<html><head><title>x</title></head><body></body></html>');
    expect(html).toMatch(/<head><script src="\/__ifdy\/agent\.js" data-ifdy-agent><\/script><title>/);
    expect(injectAgent(html)).toBe(html);
    expect(injectAgent('<p>fragment</p>')).toMatch(/^<script/);
  });
  it('rewrites root-absolute URLs for prefixed static projects', () => {
    expect(rewriteAbsolute('<link href="/a.css"><script src="//cdn.x/y.js"></script><img src="/__ifdy/agent.js">', '/p/x/')).toBe(
      '<link href="/p/x/a.css"><script src="//cdn.x/y.js"></script><img src="/__ifdy/agent.js">',
    );
    expect(rewriteCssAbsolute('a{background:url(/img.png)} b{background:url("//x")}', '/p/x/')).toBe('a{background:url(/p/x/img.png)} b{background:url("//x")}');
  });
});

describe('path safety', () => {
  it('refuses traversal outside the root', () => {
    const root = path.resolve('/srv/project');
    expect(safeJoin(root, 'a/b.css')).toBe(path.join(root, 'a/b.css'));
    expect(safeJoin(root, '../etc/passwd')).toBe(path.join(root, 'etc/passwd'));
    expect(safeJoin(root, '%2e%2e/%2e%2e/etc/passwd')!.startsWith(root)).toBe(true);
    expect(normalizePath('../x')).toBeNull();
    expect(normalizePath('a//b/./c')).toBe('a/b/c');
  });
  it('recognises loopback hosts only', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.2')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('evil.com')).toBe(false);
    expect(isLoopbackHost('localhost.evil.com')).toBe(false);
  });
});

describe('virtual file system', () => {
  it('stores, serves index files and enforces ids', () => {
    const vfs = new VirtualFileSystem();
    vfs.put('proj1', [{ path: 'index.html', content: Buffer.from('<p>hi</p>') }, { path: 'docs/index.html', content: Buffer.from('d') }], true);
    expect(vfs.get('proj1', '')?.content.toString()).toBe('<p>hi</p>');
    expect(vfs.get('proj1', 'docs')?.content.toString()).toBe('d');
    expect(() => vfs.put('../x', [], true)).toThrow();
    expect(() => vfs.put('proj1', [{ path: '../evil', content: Buffer.from('') }], false)).toThrow();
  });
});

describe('companion request trust', () => {
  const services = { config: { apiToken: 'secret' } } as unknown as IfdyServices;
  const req = (headers: Record<string, string>) => ({ headers }) as never;
  it('requires loopback host, same origin and the token', () => {
    expect(() => assertTrustedRequest(req({ host: 'localhost:5173', 'x-ifdy-token': 'secret' }), services, true)).not.toThrow();
    expect(() => assertTrustedRequest(req({ host: 'evil.test', 'x-ifdy-token': 'secret' }), services, true)).toThrow(/Host/);
    expect(() => assertTrustedRequest(req({ host: 'localhost:5173', origin: 'http://localhost:5174', 'x-ifdy-token': 'secret' }), services, true)).toThrow(/Cross-origin/);
    expect(() => assertTrustedRequest(req({ host: 'localhost:5173', 'sec-fetch-site': 'cross-site', 'x-ifdy-token': 'secret' }), services, true)).toThrow(/Cross-site/);
    expect(() => assertTrustedRequest(req({ host: 'localhost:5173' }), services, true)).toThrow(/token/);
    expect(() => assertTrustedRequest(req({ host: 'localhost:5173' }), services, false)).not.toThrow();
  });
});
