import { registerInteractionRecorder } from '@/modules/interaction-recorder';
import { registerFinancialSuite } from './index';

/** Testing: interaction recorder (record.toggle), replay engine, financial UX suite (test.runAll / test.stop). */
export function registerTesting() {
  registerInteractionRecorder();
  registerFinancialSuite();
}
