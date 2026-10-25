// Global footer: fictional-lender disclosures, customer care, demo controls and
// the persistent "synthetic demo" badge.
import { html, toElement, qs } from '../dom.js';
import { icon } from '../icons.js';
import { DemoControls } from './demo-controls.js';

export function SiteFooter({ onSimulateTimeout }) {
  const root = toElement(html`
    <footer class="site-footer" data-ifdy-component="SiteFooter" data-ifdy-source="demo/src/components/site-footer.js:7">
      <div class="site-footer__inner">
        <div class="site-footer__brand">
          <p class="brand">
            <img class="brand__mark" src="assets/harborline-mark-64.png" width="32" height="32" alt="">
            <span class="brand__text"><span class="brand__name">Harborline</span><span class="brand__sub">Home Loans</span></span>
          </p>
          <p>
            Harborline Home Loans is a fictional mortgage servicer created for the Interface Foundry demo.
            NMLS ID 000000 (synthetic). Equal Housing Opportunity.
          </p>
        </div>
        <div class="site-footer__aside">
          <div class="site-footer__contact">
            <h2 class="site-footer__heading">Customer care</h2>
            <p><a href="tel:+18005550142">1-800-555-0142</a></p>
            <p>Mon–Fri, 8 a.m. – 8 p.m. ET</p>
          </div>
          <div data-slot="demo-controls"></div>
        </div>
      </div>
      <div class="site-footer__bar">
        <p class="synthetic-badge" data-testid="synthetic-badge">
          ${icon('flask')}<span>Synthetic demo — Harborline is fictional. No real customer data.</span>
        </p>
        <p class="site-footer__legal">© 2026 Harborline Home Loans (fictional). All figures are synthetic.</p>
      </div>
    </footer>
  `);

  qs(root, '[data-slot="demo-controls"]').replaceWith(DemoControls({ onSimulateTimeout }));
  return root;
}
