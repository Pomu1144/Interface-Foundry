import type { EmulationParams, OpenMessage, RemoteInput, ScreencastOptions } from '../../src/modules/preview-runtime/remote/protocol';
import type { PageHost } from './remote-page';

/**
 * A page shown in the studio through the browser websocket, whatever engine
 * renders it. The session talks to every engine through this interface; each
 * engine reports status, frames, metrics, agent envelopes, console and network
 * back through the `PageHost` it was created with.
 */
export interface LivePage {
  readonly id: string;
  readonly isStreaming: boolean;
  lastFrameAt: number;
  lastActivity: number;
  /** Start the page (load `open.url`, apply emulation, start streaming if asked). */
  start(): Promise<void>;
  /** Re-emulate in place without reloading where the engine allows it. */
  emulate(e: Partial<EmulationParams>): void;
  setScreencast(o: ScreencastOptions): Promise<void>;
  navigate(url: string): Promise<void>;
  reload(): Promise<void>;
  history(direction: 'back' | 'forward'): Promise<void>;
  input(ev: RemoteInput): void;
  /** Studio -> agent envelope. */
  toAgent(env: unknown): void;
  close(): Promise<void>;
}

export type LivePageFactory = (id: string, host: PageHost, open: OpenMessage) => LivePage;
