import { registerAccessibilityLab } from '@/modules/accessibility-lab';
import { registerResponsiveDiff } from '@/modules/responsive-diff';
import { registerScreenshots } from '@/modules/screenshots';
import { registerResponsiveAudit } from './index';

/** QA suite: responsive audit, accessibility lab, screenshots and responsive diff. */
export function registerQaSuite() {
  registerResponsiveAudit();
  registerAccessibilityLab();
  registerScreenshots();
  registerResponsiveDiff();
}
