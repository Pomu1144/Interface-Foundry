import { WebSocketServer } from 'ws';
import { BROWSER_WS_PATH } from '../../src/modules/preview-runtime/remote/protocol';
import { getBrowserManager } from '../browser/manager';
import { validateCaptureRequest } from '../browser/capture';
import { getBrowserStatus } from '../browser/status';
import { HttpError, readJson } from '../http';
import type { Router } from '../router';
import type { IfdyServices } from '../services';

/**
 * Controlled Chromium:
 *   WS   /api/ws/browser       live pages (emulation, screencast, input, agent relay)
 *   POST /api/capture          deterministic PNG capture
 *   GET  /api/browser/status   availability + running state
 * Host/origin checks and the per-launch token are enforced by the router.
 */
export function registerBrowserRoutes(router: Router, services: IfdyServices) {
  const manager = getBrowserManager(services);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024, perMessageDeflate: false });
  services.onClose(() => new Promise<void>((r) => wss.close(() => r())));

  router.ws(BROWSER_WS_PATH, ({ req, socket, head }) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.binaryType = 'nodebuffer';
      manager.attach(ws);
    });
  });

  router.post('/api/capture', async ({ req }) => {
    const status = await getBrowserStatus(services);
    if (!status.available) throw new HttpError(503, `Controlled Chromium is unavailable: ${status.reason}`);
    const body = validateCaptureRequest(await readJson(req, 64 * 1024 * 1024));
    try {
      return await manager.capture(body);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(500, `Capture failed: ${(err as Error).message.split('\n')[0]}`);
    }
  });

  router.get('/api/browser/status', async () => {
    const status = await getBrowserStatus(services);
    const df = manager.isRunning() ? await manager.displayFeatureSupport() : null;
    return { available: status.available, reason: status.reason, ...manager.status(), displayFeatures: df };
  });
}
