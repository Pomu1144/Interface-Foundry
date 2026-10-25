import { createRoot, type Root } from 'react-dom/client';
import { AuditWorkerHost } from './worker';
import { TabOrderOverlay } from '@/modules/accessibility-lab/TabOrderOverlay';

/**
 * QA hosts that live outside the panel tree: the hidden background preview and
 * the canvas tab-order overlay. Rendered into their own root so they persist
 * while panels and documents switch.
 */
let root: Root | null = null;

export function mountQaHosts() {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('ifdy-qa-hosts');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ifdy-qa-hosts';
    document.body.appendChild(el);
  }
  if (!root) root = createRoot(el);
  root.render(
    <>
      <AuditWorkerHost />
      <TabOrderOverlay />
    </>,
  );
}
