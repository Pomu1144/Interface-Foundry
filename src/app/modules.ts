import { registerQaSuite } from '@/modules/responsive-audit/register';
import { registerAiDebugger } from '@/modules/ai-debugger/register';
import { registerTesting } from '@/modules/financial-ux-suite/register';
import { registerSourceModules } from '@/modules/export-engine/register';

/**
 * Module bootstrap: each optional module registers its actions, bus handlers
 * and startup work here. Keep one line per module.
 */
export function registerModules() {
  // Module registrations are appended below.
  registerQaSuite(); // responsive audit, accessibility lab, screenshots, responsive diff
  registerAiDebugger(); // AI layout debugger: ai.diagnose (Mod+Shift+D), bus 'ai-diagnose', Debug view
  registerTesting(); // recorder, replayer, timeline, scenarios, financial UX suite: record.toggle, test.runAll, test.stop
  registerSourceModules(); // tokens, assets, components, code editor, export engine (export.open Mod+E), git
}
