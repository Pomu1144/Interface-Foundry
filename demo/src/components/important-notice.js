// Servicing notice shown at the bottom of the dashboard.
import { html, toElement } from '../dom.js';
import { icon } from '../icons.js';

export function ImportantNotice() {
  return toElement(html`
    <section class="notice" aria-labelledby="important-notice-title" data-testid="important-notice" data-ifdy-component="ImportantNotice" data-ifdy-source="demo/src/components/important-notice.js:5">
      <h2 class="notice__title" id="important-notice-title">${icon('info')}Important notice</h2>
      <p class="notice__body">
        Beginning with your December 1, 2026 payment, Harborline Home Loans will process payments on a new servicing
        platform. Your loan number, payment amount and due date will not change, and any payments you have already
        scheduled will move over automatically. If you pay through your bank's online bill-pay service, update the payee
        address to Harborline Home Loans, P.O. Box 4821, Port Harbor, ME 04999 (synthetic) by November 20, 2026; payments
        sent to the previous address will be forwarded for 90 days. Your escrow account, insurance coverage and property
        tax payments are not affected. Questions? Call Customer Care at 1-800-555-0142 (synthetic), Monday through Friday,
        8:00 a.m. to 8:00 p.m. Eastern time.
      </p>
    </section>
  `);
}
