import { studio } from '@/store';

/**
 * Client for the local IFDY companion. The per-launch token is fetched from the
 * same origin and sent with every request; the companion rejects anything else.
 */
let tokenPromise: Promise<string | null> | null = null;

async function token(): Promise<string | null> {
  if (!tokenPromise) {
    tokenPromise = fetch('/api/bootstrap', { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as { token: string }).token : null))
      .catch(() => null);
  }
  const t = await tokenPromise;
  if (!t) tokenPromise = null;
  return t;
}

export class CompanionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  let body = init.body;
  const headers = new Headers(init.headers);
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const send = async () => {
    const t = await token();
    if (!t) throw new CompanionError(0, 'The IFDY companion is not running. Start the studio with "npm run dev".');
    headers.set('x-ifdy-token', t);
    return fetch(path, { ...init, headers, body });
  };
  let res = await send();
  // The token is per launch: after a companion restart, fetch the new one and retry once.
  if (res.status === 401) {
    tokenPromise = null;
    res = await send();
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* not json */
    }
    throw new CompanionError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

export async function wsUrl(path: string): Promise<string> {
  const t = await token();
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(t ?? '')}`;
}

type ConfigResponse = {
  version: string;
  previewOrigin: string;
  capabilities: NonNullable<ReturnType<typeof studio>['server']['capabilities']>;
};

/** Discover the companion and its capabilities; marks the server offline on failure. */
export async function connectCompanion(): Promise<boolean> {
  try {
    const cfg = await api<ConfigResponse>('/api/config');
    studio().setServer({ status: 'online', token: await token(), previewOrigin: cfg.previewOrigin, capabilities: cfg.capabilities });
    return true;
  } catch {
    studio().setServer({ status: 'offline', previewOrigin: null, capabilities: null });
    return false;
  }
}

export function previewOrigin(): string {
  return studio().server.previewOrigin ?? `${location.protocol}//${location.hostname}:${Number(location.port || 80) + 1}`;
}
