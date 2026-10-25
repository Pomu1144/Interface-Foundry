import type { AgentBundle } from './agent-bundle';
import type { IfdyServerConfig } from './config';
import type { LocalProxyManager } from './local-proxy';
import type { VirtualFileSystem } from './vfs';

/**
 * Long-lived server services shared by route modules. Optional subsystems
 * (controlled browser, AI, git) register themselves lazily so the core works
 * when they are unavailable.
 */
export type IfdyServices = {
  config: IfdyServerConfig;
  agent: AgentBundle;
  vfs: VirtualFileSystem;
  proxies: LocalProxyManager;
  /** Resolved public origin of the preview host (set once listening). */
  previewOrigin: () => string;
  /** Resolved studio origin seen by the browser, if known. */
  studioPort: () => number;
  /** Disposers run on shutdown. */
  onClose: (fn: () => void | Promise<void>) => void;
  /** Free-form registry for optional subsystems (browser manager, ai, ...). */
  registry: Map<string, unknown>;
};
