import { HttpError, readJson } from '../http';
import type { Router } from '../router';
import { getBrowserStatus } from '../browser/status';

export const SERVER_VERSION = '0.1.0';

export function registerCoreRoutes(router: Router) {
  /** Same-origin-only token handshake (see assertTrustedRequest). */
  router.get('/api/bootstrap', ({ services }) => ({
    token: services.config.apiToken,
    version: SERVER_VERSION,
  }));

  router.get('/api/config', async ({ services }) => {
    const { config } = services;
    const browser = await getBrowserStatus(services);
    return {
      version: SERVER_VERSION,
      previewOrigin: services.previewOrigin(),
      capabilities: {
        preview: { available: true },
        browser,
        ai: {
          anthropic: Boolean(config.ai.anthropicKey),
          model: config.ai.model,
          local: Boolean(config.ai.localUrl),
          localModel: config.ai.localModel ?? null,
        },
        fs: {
          available: config.allowedRoots.length > 0,
          roots: config.allowedRoots.map((p, i) => ({ id: String(i), path: p, name: p.split(/[\\/]/).filter(Boolean).pop() ?? p })),
        },
        localProxy: { available: true },
      },
    };
  });

  /** Upload (or replace) files of an imported static project into the preview VFS. */
  router.put('/api/vfs/:projectId', async ({ req, params, services, url }) => {
    const body = await readJson<{ files: { path: string; base64?: string; text?: string }[] }>(req, 96 * 1024 * 1024);
    if (!Array.isArray(body.files)) throw new HttpError(400, 'files[] required');
    const files = body.files.map((f) => ({
      path: String(f.path),
      content: f.base64 !== undefined ? Buffer.from(f.base64, 'base64') : Buffer.from(String(f.text ?? ''), 'utf8'),
    }));
    const replace = url.searchParams.get('replace') !== '0';
    const result = services.vfs.put(params.projectId, files, replace);
    return { ...result, base: `${services.previewOrigin()}/p/${params.projectId}/` };
  });

  router.get('/api/vfs/:projectId', ({ params, services }) => ({
    exists: services.vfs.has(params.projectId),
    files: services.vfs.list(params.projectId),
  }));

  /** Connect an authorised local development server (loopback only). */
  router.post('/api/proxy', async ({ req, services }) => {
    const body = await readJson<{ url: string }>(req);
    return services.proxies.open(String(body.url ?? ''));
  });

  /**
   * Inform the user whether a public URL allows being framed. IFDY never strips
   * these headers; this only decides between direct embedding and the
   * controlled-browser engine.
   */
  router.get('/api/frame-check', async ({ url }) => {
    const target = url.searchParams.get('url') ?? '';
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      throw new HttpError(400, 'Invalid URL');
    }
    if (!/^https?:$/.test(parsed.protocol)) throw new HttpError(400, 'Only http(s) URLs are supported');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const r = await fetch(parsed, { method: 'GET', redirect: 'follow', signal: controller.signal, headers: { 'user-agent': 'IFDY-frame-check/0.1' } });
      const xfo = r.headers.get('x-frame-options');
      const csp = r.headers.get('content-security-policy') ?? '';
      const fa = /frame-ancestors\s+([^;]+)/i.exec(csp)?.[1]?.trim();
      let embeddable = true;
      let reason = 'No framing restrictions detected.';
      if (xfo && /deny|sameorigin/i.test(xfo)) {
        embeddable = false;
        reason = `X-Frame-Options: ${xfo}`;
      }
      if (fa && !/\*/.test(fa)) {
        embeddable = false;
        reason = `Content-Security-Policy frame-ancestors ${fa}`;
      }
      r.body?.cancel().catch(() => {});
      return { url: r.url, status: r.status, embeddable, reason };
    } catch (err) {
      return { url: target, status: null, embeddable: null, reason: `Could not reach the site: ${(err as Error).message}` };
    } finally {
      clearTimeout(timer);
    }
  });
}
