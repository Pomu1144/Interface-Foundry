import type { Router } from '../router';
import type { IfdyServices } from '../services';
import { registerFsRoutes } from './fs';
import { registerBrowserRoutes } from './browser';
import { registerAiRoutes } from './ai';

/**
 * Optional module routes. Each module registers its own endpoints here so the
 * core router stays small. Keep one line per module.
 */
export function registerModuleRoutes(_router: Router, _services: IfdyServices) {
  // Module registrations are appended below.
  registerFsRoutes(_router, _services); // fs + git + demo source (routes/fs.ts)
  registerBrowserRoutes(_router, _services); // controlled Chromium: /api/ws/browser, /api/capture (routes/browser.ts)
  registerAiRoutes(_router, _services); // AI debugger: /api/ai/status, /api/ai/diagnose (routes/ai.ts)
}
