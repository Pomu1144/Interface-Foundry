import { ENVELOPE_TAG, PROTOCOL_VERSION, type Envelope } from '@shared/protocol';
import type { StudioTransport } from '../connection';
import { browserSocket } from './socket';

export type RemoteTransport = StudioTransport & {
  /** Deliver an agent -> studio envelope (relayed by the companion or synthesised from Chromium data). */
  deliver(env: Envelope): void;
  /** Build an agent-style event envelope for this session. */
  event(name: string, payload: unknown): Envelope;
};

/**
 * StudioTransport over the shared browser websocket, so the regular
 * PreviewConnection (RPC, events, wireConnection) works unchanged for pages
 * running in the companion's Chromium.
 */
export function createRemoteTransport(pageId: string, session: string, socket = browserSocket): RemoteTransport {
  let handler: ((env: Envelope) => void) | null = null;
  return {
    send(env) {
      socket.send({ t: 'agent', pageId, env });
    },
    listen(h) {
      handler = h;
      return () => {
        if (handler === h) handler = null;
      };
    },
    dispose() {
      handler = null;
    },
    deliver(env) {
      handler?.(env);
    },
    event(name, payload) {
      return { [ENVELOPE_TAG]: PROTOCOL_VERSION, session, kind: 'event', event: name, payload };
    },
  };
}
