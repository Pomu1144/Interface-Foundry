import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { HttpError, isLoopbackHost, sendError, sendJson, type Req, type Res } from './http';
import type { IfdyServices } from './services';

export type RouteContext = {
  req: Req;
  res: Res;
  url: URL;
  params: Record<string, string>;
  services: IfdyServices;
};

/** Return a value to send it as JSON, or `undefined` after writing to `res` yourself. */
export type RouteHandler = (ctx: RouteContext) => unknown | Promise<unknown>;

export type WsHandler = (ctx: { req: IncomingMessage; socket: Duplex; head: Buffer; url: URL; services: IfdyServices }) => void;

type Route = { method: string; pattern: RegExp; keys: string[]; handler: RouteHandler };

export class Router {
  private routes: Route[] = [];
  private wsRoutes = new Map<string, WsHandler>();

  add(method: string, path: string, handler: RouteHandler) {
    const keys: string[] = [];
    const pattern = new RegExp(
      '^' +
        path.replace(/\//g, '\\/').replace(/:(\w+)(\*)?/g, (_m, key: string, star?: string) => {
          keys.push(key);
          return star ? '(.*)' : '([^/]+)';
        }) +
        '$',
    );
    this.routes.push({ method: method.toUpperCase(), pattern, keys, handler });
    return this;
  }

  get(path: string, h: RouteHandler) {
    return this.add('GET', path, h);
  }
  post(path: string, h: RouteHandler) {
    return this.add('POST', path, h);
  }
  put(path: string, h: RouteHandler) {
    return this.add('PUT', path, h);
  }
  delete(path: string, h: RouteHandler) {
    return this.add('DELETE', path, h);
  }

  ws(path: string, handler: WsHandler) {
    this.wsRoutes.set(path, handler);
  }

  /** Connect-style middleware for /api routes. */
  middleware(services: IfdyServices) {
    return async (req: Req, res: Res, next: (err?: unknown) => void) => {
      const url = new URL(req.url ?? '/', 'http://studio.local');
      if (!url.pathname.startsWith('/api/')) return next();
      try {
        assertTrustedRequest(req, services, url.pathname !== '/api/bootstrap');
        const method = (req.method ?? 'GET').toUpperCase();
        for (const route of this.routes) {
          if (route.method !== method) continue;
          const m = url.pathname.match(route.pattern);
          if (!m) continue;
          const params: Record<string, string> = {};
          route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? '')));
          const result = await route.handler({ req, res, url, params, services });
          if (result !== undefined && !res.writableEnded) sendJson(res, 200, result);
          else if (!res.writableEnded && !res.headersSent) sendJson(res, 204, null);
          return;
        }
        throw new HttpError(404, `No route for ${method} ${url.pathname}`);
      } catch (err) {
        if (!res.headersSent) sendError(res, err);
        else res.end();
      }
    };
  }

  upgrade(services: IfdyServices) {
    return (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? '/', 'http://studio.local');
      const handler = this.wsRoutes.get(url.pathname);
      if (!handler) return false;
      try {
        assertTrustedRequest(req, services, false);
        if (url.searchParams.get('token') !== services.config.apiToken) throw new HttpError(401, 'Bad token');
      } catch {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return true;
      }
      handler({ req, socket, head, url, services });
      return true;
    };
  }
}

/**
 * The companion only serves the studio running on the same loopback origin.
 *  - Host must be a loopback name (defeats DNS rebinding) unless explicitly allowed.
 *  - Origin, when present, must equal the request's own origin (defeats cross-site requests).
 *  - Every call except /api/bootstrap needs the per-launch token, which can only be
 *    read by same-origin script because no CORS headers are ever sent.
 */
export function assertTrustedRequest(req: IncomingMessage, services: IfdyServices, requireToken: boolean) {
  const host = req.headers.host ?? '';
  const hostname = host.replace(/:\d+$/, '');
  const allowedHosts = (process.env.IFDY_ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!isLoopbackHost(hostname) && !allowedHosts.includes(hostname)) {
    throw new HttpError(403, 'Host not allowed');
  }
  const origin = req.headers.origin;
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new HttpError(403, 'Bad origin');
    }
    if (originHost !== host) throw new HttpError(403, 'Cross-origin request rejected');
  }
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'Cross-site request rejected');
  if (requireToken && req.headers['x-ifdy-token'] !== services.config.apiToken) {
    throw new HttpError(401, 'Missing or invalid IFDY token');
  }
}
