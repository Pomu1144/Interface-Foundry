import type { Router } from '../router';
import type { IfdyServices } from '../services';
import { registerFsRoutes } from './fs';

/**
 * Optional module routes. Each module registers its own endpoints here so the
 * core router stays small. Keep one line per module.
 */
export function registerModuleRoutes(_router: Router, _services: IfdyServices) {
  // Module registrations are appended below.
  registerFsRoutes(_router, _services); // fs + git + demo source (routes/fs.ts)
}
