import { decodeWindowName, ENVELOPE_TAG, isEnvelope, PROTOCOL_VERSION, type Envelope } from '@shared/protocol';

/**
 * Transport between the agent and the studio.
 *  - frame:  postMessage to window.parent, restricted to the studio origin + session nonce
 *  - remote: Playwright binding (`__ifdyBridgeSend`) for server-controlled Chromium pages
 */
export type Transport = {
  mode: 'frame' | 'remote';
  session: string;
  flags: Set<string>;
  send(env: Omit<Envelope, typeof ENVELOPE_TAG | 'session'>): void;
  onMessage(handler: (env: Envelope) => void): void;
};

type RemoteConfig = { session: string; flags?: string[] };

declare global {
  interface Window {
    __IFDY_REMOTE__?: RemoteConfig;
    __ifdyBridgeSend?: (json: string) => void;
    __ifdyReceive?: (env: unknown) => void;
    __IFDY_AGENT__?: { version: number };
  }
}

export function createTransport(): Transport | null {
  const remote = window.__IFDY_REMOTE__;
  if (remote && typeof window.__ifdyBridgeSend === 'function') {
    const handlers: ((env: Envelope) => void)[] = [];
    window.__ifdyReceive = (env: unknown) => {
      if (isEnvelope(env) && env.session === remote.session) handlers.forEach((h) => h(env));
    };
    return {
      mode: 'remote',
      session: remote.session,
      flags: new Set(remote.flags ?? []),
      send(env) {
        try {
          window.__ifdyBridgeSend!(JSON.stringify({ [ENVELOPE_TAG]: PROTOCOL_VERSION, session: remote.session, ...env }));
        } catch {
          /* page navigating */
        }
      },
      onMessage(h) {
        handlers.push(h);
      },
    };
  }

  if (window.parent === window) return null;
  // window.name is "ifdy:<session>|<studioOrigin>|<flags>", set on the iframe by the studio.
  const raw = window.name || '';
  const parts = raw.split('|');
  const decoded = decodeWindowName(parts.slice(0, 2).join('|'));
  if (!decoded) return null;
  const flags = new Set((parts[2] ?? '').split(',').filter(Boolean));
  const { session, studioOrigin } = decoded;
  return {
    mode: 'frame',
    session,
    flags,
    send(env) {
      try {
        window.parent.postMessage({ [ENVELOPE_TAG]: PROTOCOL_VERSION, session, ...env }, studioOrigin);
      } catch {
        /* ignore */
      }
    },
    onMessage(handler) {
      window.addEventListener('message', (e) => {
        if (e.source !== window.parent) return;
        if (e.origin !== studioOrigin) return;
        if (!isEnvelope(e.data) || e.data.session !== session) return;
        handler(e.data);
      });
    },
  };
}
