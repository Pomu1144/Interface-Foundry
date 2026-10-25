import type { AddressInfo } from 'node:net';
import type { Plugin } from 'vite';
import { createIfdyServer, type IfdyServer } from './app';
import { loadConfig } from './config';

/**
 * Runs the IFDY companion inside the Vite dev server: mounts /api, handles
 * websocket upgrades for /api/ws/*, and starts the separate-origin preview host.
 */
export function ifdyCompanion(): Plugin {
  let ifdy: IfdyServer | null = null;
  return {
    name: 'ifdy-companion',
    apply: 'serve',
    configureServer(server) {
      let port = Number(server.config.server.port) || 5173;
      const config = loadConfig({ dev: true, studioPort: port });
      ifdy = createIfdyServer(config, () => port);
      server.middlewares.use(ifdy.middleware);

      const httpServer = server.httpServer;
      if (httpServer) {
        httpServer.on('upgrade', (req, socket, head) => {
          if (req.url?.startsWith('/api/ws/')) ifdy?.upgrade(req, socket, head);
        });
        httpServer.once('listening', async () => {
          const addr = httpServer.address() as AddressInfo | null;
          if (addr?.port) port = addr.port;
          if (!process.env.IFDY_PREVIEW_PORT) config.previewPort = port + 1;
          const previewPort = await ifdy!.listenPreview();
          server.config.logger.info(`  \x1b[38;5;209m➜\x1b[0m  IFDY preview origin: http://localhost:${previewPort}/ (isolated)`);
        });
        httpServer.once('close', () => {
          void ifdy?.close();
        });
      }
    },
  };
}
