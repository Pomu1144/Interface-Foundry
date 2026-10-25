import { registerQaSuite } from '@/modules/responsive-audit/register';

/**
 * Module bootstrap: each optional module registers its actions, bus handlers
 * and startup work here. Keep one line per module.
 */
export function registerModules() {
  // Module registrations are appended below.
  registerQaSuite(); // responsive audit, accessibility lab, screenshots, responsive diff
}
