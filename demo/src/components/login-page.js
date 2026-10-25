// Login route: coastal-home hero (wide layouts), refinance banner and the
// sign-in card. Layout changes are pure CSS so the form never re-renders.
import { html, toElement, qs } from '../dom.js';
import { icon } from '../icons.js';
import { RateBanner } from './rate-banner.js';
import { LoginForm } from './login-form.js';

export function LoginPage({ onSignedIn }) {
  const root = toElement(html`
    <div class="login" data-ifdy-component="LoginPage" data-ifdy-source="demo/src/components/login-page.js:8">
      <div class="login__hero">
        <img
          class="login__hero-img"
          src="assets/harbor-home.webp"
          srcset="assets/harbor-home-sm.webp 448w, assets/harbor-home.webp 896w"
          sizes="(min-width: 1200px) 56vw, 1px"
          width="896"
          height="1120"
          alt=""
          loading="lazy"
          decoding="async"
        />
        <div class="login__hero-copy">
          <p class="login__hero-title">Your home.<br />Your harbor.</p>
          <p class="login__hero-text">
            Make payments, download statements and keep an eye on escrow — securely, from any device.
          </p>
          <ul class="login__hero-points">
            <li>${icon('check')}Free online payments</li>
            <li>${icon('check')}Paperless statements</li>
            <li>${icon('check')}Escrow tracking</li>
          </ul>
        </div>
      </div>

      <div class="login__panel">
        <div class="login__panel-inner">
          <div class="login__intro">
            <p class="login__intro-eyebrow">Harborline Home Loans</p>
            <p class="login__intro-title">Welcome back</p>
          </div>

          <div data-slot="banner"></div>

          <section class="login-card" aria-labelledby="login-title">
            <h1 class="login-card__title" id="login-title">Sign in</h1>
            <p class="login-card__lede">Manage your home loan, payments and escrow.</p>
            <div data-slot="form"></div>
            <p class="login-card__footer">
              Trouble signing in? Call <a href="tel:+18005550142">1-800-555-0142</a>
            </p>
          </section>

          <aside class="demo-credentials" aria-label="Demo credentials" data-testid="demo-credentials">
            <span>Demo credentials:</span>
            <code data-testid="demo-username">demo.borrower</code>
            <code data-testid="demo-password">Harbor!2026</code>
          </aside>

          <p class="login__trust">
            <span>${icon('lock')}256-bit TLS encryption</span>
            <span>${icon('shield')}We never ask for your password by phone</span>
          </p>
        </div>
      </div>
    </div>
  `);

  qs(root, '[data-slot="banner"]').replaceWith(RateBanner({ legacyRateFeed: true }));
  qs(root, '[data-slot="form"]').replaceWith(LoginForm({ onSuccess: onSignedIn }));
  return root;
}
