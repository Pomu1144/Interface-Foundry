import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { AgentBundle, injectAgent } from './agent-bundle';
import { DEMO_DIR } from './config';
import { mimeFor, safeJoin, sendJson, type Req, type Res } from './http';
import type { VirtualFileSystem } from './vfs';

/**
 * The preview host runs on its own port so previewed documents get a different
 * origin from the studio. The studio's storage, cookies, token and DOM are
 * therefore unreachable from previewed code by the same-origin policy, and the
 * iframe is additionally sandboxed.
 *
 * Routes:
 *   /__ifdy/agent.js      preview agent bundle
 *   /__ifdy/axe.js        axe-core (loaded on demand for accessibility audits)
 *   /demo/*               synthetic Harborline mortgage demo
 *   /p/:projectId/*       imported static projects (in-memory VFS)
 *   /fs/:root/*           authorised local directories (read-only serving)
 */
export function createPreviewHost(opts: {
  agent: AgentBundle;
  vfs: VirtualFileSystem;
  allowedRoots: string[];
}): Server {
  const { agent, vfs, allowedRoots } = opts;

  const server = createServer(async (req: Req, res: Res) => {
    try {
      // Previewed content is untrusted. Let it be embedded by the studio and
      // loaded from opaque origins (sandboxed iframes), nothing more.
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405;
        res.end();
        return;
      }
      const url = new URL(req.url ?? '/', 'http://preview.local');
      const pathname = url.pathname;

      if (pathname === '/__ifdy/agent.js') {
        return sendText(res, await agent.get(), 'text/javascript; charset=utf-8');
      }
      if (pathname === '/__ifdy/axe.js') {
        return sendText(res, await agent.getAxe(), 'text/javascript; charset=utf-8');
      }
      if (pathname === '/__ifdy/health') {
        return sendJson(res, 200, { ok: true });
      }
      if (pathname === '/' || pathname === '/demo') {
        res.statusCode = 302;
        res.setHeader('Location', '/demo/');
        res.end();
        return;
      }
      if (pathname.startsWith('/demo/')) {
        const file = safeJoin(DEMO_DIR, pathname.slice('/demo/'.length) || 'index.html');
        if (!file) return notFound(res);
        return serveFile(res, file);
      }
      const vfsMatch = pathname.match(/^\/p\/([a-zA-Z0-9_-]{4,64})\/(.*)$/);
      if (vfsMatch) {
        const [, projectId, rest] = vfsMatch;
        const f = vfs.get(projectId, rest || 'index.html');
        if (!f) return notFound(res);
        const type = mimeFor(rest || 'index.html');
        if (type.startsWith('text/html')) {
          return sendText(res, rewriteAbsolute(injectAgent(f.content.toString('utf8')), `/p/${projectId}/`), type);
        }
        if (type.startsWith('text/css')) {
          return sendText(res, rewriteCssAbsolute(f.content.toString('utf8'), `/p/${projectId}/`), type);
        }
        res.setHeader('Content-Type', type);
        res.end(f.content);
        return;
      }
      const fsMatch = pathname.match(/^\/fs\/(\d+)\/(.*)$/);
      if (fsMatch) {
        const root = allowedRoots[Number(fsMatch[1])];
        if (!root) return notFound(res);
        const file = safeJoin(root, fsMatch[2] || 'index.html');
        if (!file) return notFound(res);
        return serveFile(res, file, `/fs/${fsMatch[1]}/`);
      }
      notFound(res);
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err instanceof Error ? err.message : err));
    }
  });
  return server;

  async function serveFile(res: Res, file: string, absolutePrefix?: string) {
    let target = file;
    try {
      const s = await stat(target);
      if (s.isDirectory()) target = path.join(target, 'index.html');
    } catch {
      return notFound(res);
    }
    let data: Buffer;
    try {
      data = await readFile(target);
    } catch {
      return notFound(res);
    }
    const type = mimeFor(target);
    if (type.startsWith('text/html')) {
      let html = injectAgent(data.toString('utf8'));
      if (absolutePrefix) html = rewriteAbsolute(html, absolutePrefix);
      return sendText(res, html, type);
    }
    if (absolutePrefix && type.startsWith('text/css')) {
      return sendText(res, rewriteCssAbsolute(data.toString('utf8'), absolutePrefix), type);
    }
    res.setHeader('Content-Type', type);
    res.end(data);
  }
}

function sendText(res: Res, text: string, type: string) {
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.end(text);
}

function notFound(res: Res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(
    injectAgent(
      '<!doctype html><html><head><title>Not found</title></head><body style="font:14px system-ui;padding:24px;color:#555">404 — this file is not part of the previewed project.</body></html>',
    ),
  );
}

/**
 * Static projects often reference root-absolute URLs ("/styles.css"). They are
 * served under a prefix here, so rewrite src/href/action attributes that start
 * with a single "/" (not "//" protocol-relative, not the agent itself).
 */
export function rewriteAbsolute(html: string, prefix: string): string {
  return html.replace(/(\s(?:src|href|action|poster)=["'])\/(?!\/|__ifdy\/)/gi, `$1${prefix}`);
}

export function rewriteCssAbsolute(css: string, prefix: string): string {
  return css.replace(/url\((['"]?)\/(?!\/)/gi, `url($1${prefix}`);
}
