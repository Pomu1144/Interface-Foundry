import type { Server } from 'node:http';
import { AgentBundle } from './agent-bundle';
import type { IfdyServerConfig } from './config';
import { LocalProxyManager } from './local-proxy';
import { createPreviewHost } from './preview-host';
import { Router } from './router';
import { registerCoreRoutes } from './routes/core';
import { registerModuleRoutes } from './routes/index';
import type { IfdyServices } from './services';
import { VirtualFileSystem } from './vfs';

export type IfdyServer = {
  services: IfdyServices;
  middleware: ReturnType<Router['middleware']>;
  upgrade: ReturnType<Router['upgrade']>;
  previewHost: Server;
  listenPreview: () => Promise<number>;
  close: () => Promise<void>;
};

/**
 * Builds the IFDY companion: the studio API (mounted on the studio's own server)
 * and the separate-origin preview host.
 */
export function createIfdyServer(config: IfdyServerConfig, studioPort: () => number): IfdyServer {
  const agent = new AgentBundle({ dev: config.dev });
  const vfs = new VirtualFileSystem();
  const proxies = new LocalProxyManager(agent);
  const disposers: (() => void | Promise<void>)[] = [];
  let previewPort = config.previewPort;

  const services: IfdyServices = {
    config,
    agent,
    vfs,
    proxies,
    previewOrigin: () => config.previewOrigin ?? `http://localhost:${previewPort}`,
    studioPort,
    onClose: (fn) => disposers.push(fn),
    registry: new Map(),
  };

  const router = new Router();
  registerCoreRoutes(router);
  registerModuleRoutes(router, services);

  const previewHost = createPreviewHost({ agent, vfs, allowedRoots: config.allowedRoots });

  return {
    services,
    middleware: router.middleware(services),
    upgrade: router.upgrade(services),
    previewHost,
    listenPreview: () =>
      new Promise<number>((resolve, reject) => {
        const tryListen = (port: number, attempts: number) => {
          previewHost.once('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE' && attempts > 0) tryListen(port + 1, attempts - 1);
            else reject(err);
          });
          previewHost.listen(port, () => {
            previewPort = port;
            resolve(port);
          });
        };
        tryListen(previewPort, 20);
      }),
    close: async () => {
      for (const d of disposers.reverse()) {
        try {
          await d();
        } catch {
          /* ignore */
        }
      }
      proxies.close();
      agent.close();
      await new Promise<void>((r) => previewHost.close(() => r()));
    },
  };
}
