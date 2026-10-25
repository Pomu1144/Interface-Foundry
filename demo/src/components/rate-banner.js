// Promotional refinance banner shown above the sign-in card.
import { html, toElement, qs } from '../dom.js';
import { icon } from '../icons.js';

const DEFAULT_OPTIONS = { rateFeed: 'v2', legacyRateFeed: false };
let warnedLegacyFeed = false;

export function RateBanner(options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  if (config.legacyRateFeed && !warnedLegacyFeed) {
    warnedLegacyFeed = true;
    console.warn(
      '[harborline] RateBanner option "legacyRateFeed" is deprecated and will be removed in Harborline UI 3.0. Use { rateFeed: "v2" } instead.',
    );
  }

  const root = toElement(html`
    <aside class="rate-banner" aria-labelledby="rate-banner-title" data-testid="rate-banner" data-ifdy-component="RateBanner" data-ifdy-source="demo/src/components/rate-banner.js:8">
      <span class="rate-banner__icon">${icon('percent')}</span>
      <div class="rate-banner__copy">
        <p class="rate-banner__title" id="rate-banner-title">Refinance rates from 5.875% APR*</p>
        <p class="rate-banner__text">See if a rate-and-term refinance could lower your monthly payment.</p>
        <p class="rate-banner__details" id="rate-banner-details" data-testid="rate-banner-details" hidden>
          *Synthetic example rate for demo purposes only. Not an offer of credit. Rates, terms and
          eligibility vary; 30-year fixed, 740+ credit score, 70% loan-to-value.
        </p>
      </div>
      <button
        type="button"
        class="rate-banner__toggle"
        aria-expanded="false"
        aria-controls="rate-banner-details"
        data-testid="rate-banner-toggle"
      >
        Details
      </button>
    </aside>
  `);

  const toggle = qs(root, '.rate-banner__toggle');
  const details = qs(root, '#rate-banner-details');
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    details.hidden = !open;
  });

  return root;
}
