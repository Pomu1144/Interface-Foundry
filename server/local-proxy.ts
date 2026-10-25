import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { request as httpsRequest } from 'node:https';
import net from 'node:net';
import { injectAgent } from './agent-bundle';
import type { AgentBundle } from './agent-bundle';
import { HttpError, isLoopbackHost } from './http';

/**
 * Authorised local development URL support.
 *
 * For a dev server the user explicitly connects (loopback only), IFDY starts a
 * reverse proxy on its own port. The proxy mirrors the target origin path-for-path
 * (so absolute URLs and HMR websockets keep working) and injects the preview agent
 * into HTML documents. It never strips or alters the target's security headers;
 * it is the user's own application.
 */
type ProxyEntry = { target: URL; server: Server; port: number; createdAt: number };

export class LocalProxyManager {
  private proxies = new Map<string, ProxyEntry>();

  constructor(private agent: AgentBundle) {}

  async open(targetUrl: string): Promise<{ origin: string; port: number; target: string }> {
    let target: URL;
    try {
      target = new URL(targetUrl);
    } catch {
      throw new HttpError(400, 'Invalid URL');
    }
    if (!/^https?:$/.test(target.protocol)) throw new HttpError(400, 'Only http(s) URLs are supported');
    if (!isLoopbackHost(target.hostname)) {
      throw new HttpError(
        403,
        'Only local development servers (localhost / 127.0.0.1) can be connected for full inspection. Use Simulate URL for public websites.',
      );
    }
    const key = target.origin;
    const existing = this.proxies.get(key);
    if (existing) return { origin: `http://localhost:${existing.port}`, port: existing.port, target: key };

    const server = createServer((req, res) => {
      if (req.url === '/__ifdy/agent.js' || req.url === '/__ifdy/axe.js') {
        const code = req.url === '/__ifdy/agent.js' ? this.agent.get() : this.agent.getAxe();
        code.then(
          (text) => {
            res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(text);
          },
          () => {
            res.statusCode = 500;
            res.end();
          },
        );
        return;
      }
      const upstream = new URL(req.url ?? '/', target);
      const headers = { ...req.headers, host: target.host, 'accept-encoding': 'identity' };
      delete headers['origin'];
      const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
      const proxyReq = send(
        upstream,
        { method: req.method, headers, rejectUnauthorized: false },
        (proxyRes: IncomingMessage) => {
          const type = String(proxyRes.headers['content-type'] ?? '');
          const outHeaders = { ...proxyRes.headers };
          if (type.includes('text/html')) {
            const chunks: Buffer[] = [];
            proxyRes.on('data', (c: Buffer) => chunks.push(c));
            proxyRes.on('end', () => {
              const html = injectAgent(Buffer.concat(chunks).toString('utf8'));
              delete outHeaders['content-length'];
              delete outHeaders['content-encoding'];
              res.writeHead(proxyRes.statusCode ?? 200, outHeaders);
              res.end(html);
            });
            return;
          }
          res.writeHead(proxyRes.statusCode ?? 200, outHeaders);
          proxyRes.pipe(res);
        },
      );
      proxyReq.on('error', (err) => {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(
          injectAgent(
            `<!doctype html><html><head><title>Dev server unreachable</title></head><body style="font:14px system-ui;padding:24px">Could not reach ${target.origin}: ${escapeHtml(err.message)}</body></html>`,
          ),
        );
      });
      req.pipe(proxyReq);
    });

    server.on('upgrade', (req, socket, head) => {
      // Forward websocket upgrades (HMR) to the target.
      const port = Number(target.port) || (target.protocol === 'https:' ? 443 : 80);
      const upstream = net.connect(port, target.hostname, () => {
        const lines = [`${req.method} ${req.url} HTTP/1.1`];
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const name = req.rawHeaders[i];
          const value = name.toLowerCase() === 'host' ? target.host : req.rawHeaders[i + 1];
          lines.push(`${name}: ${value}`);
        }
        upstream.write(lines.join('\r\n') + '\r\n\r\n');
        if (head?.length) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });
    this.proxies.set(key, { target, server, port, createdAt: Date.now() });
    return { origin: `http://localhost:${port}`, port, target: key };
  }

  list() {
    return [...this.proxies.values()].map((p) => ({ target: p.target.origin, port: p.port }));
  }

  close() {
    for (const p of this.proxies.values()) p.server.close();
    this.proxies.clear();
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
