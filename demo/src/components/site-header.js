// Global header: brand, primary navigation (collapsible below 1200px) and the
// signed-in borrower's controls. Updated in place on route/session changes.
import { html, toElement, qs, qsa } from '../dom.js';
import { icon } from '../icons.js';
import { initials } from '../format.js';

const NAV_ITEMS = [
  { route: 'dashboard', label: 'Overview', icon: 'home' },
  { route: 'statement', label: 'Statements', icon: 'document' },
  { route: 'payment', label: 'Payments', icon: 'card' },
  { route: 'profile', label: 'Profile', icon: 'user' },
];

export function SiteHeader({ onSignOut }) {
  const root = toElement(html`
    <header class="site-header" data-ifdy-component="SiteHeader" data-ifdy-source="demo/src/components/site-header.js:14">
      <div class="site-header__inner">
        <a class="brand" href="#/login" data-testid="brand-home">
          <img class="brand__mark" src="assets/harborline-mark-64.png" width="36" height="36" alt="">
          <span class="brand__text">
            <span class="brand__name">Harborline</span>
            <span class="brand__sub">Home Loans</span>
          </span>
        </a>

        <nav class="site-nav" id="site-nav" aria-label="Primary" data-open="false" data-testid="primary-nav" hidden>
          <ul class="site-nav__list">
            ${NAV_ITEMS.map(
              (item) => html`
                <li>
                  <a class="site-nav__link" href="#/${item.route}" data-route="${item.route}" data-testid="nav-${item.route}">
                    ${icon(item.icon)}<span>${item.label}</span>
                  </a>
                </li>
              `,
            )}
          </ul>
        </nav>

        <div class="site-header__actions">
          <p class="site-header__help" data-slot="public">
            ${icon('phone')}<span>Questions? <a href="tel:+18005550142">1-800-555-0142</a></span>
          </p>
          <span class="secure-chip" data-slot="public">${icon('lock')}Secure sign-in</span>

          <span class="user-chip" data-slot="private" data-testid="user-chip" hidden>
            <span class="avatar" aria-hidden="true" data-user-initials></span>
            <span class="user-chip__name" data-user-name></span>
          </span>
          <button type="button" class="btn btn--ghost btn--sm" data-slot="private" data-testid="sign-out" hidden>
            ${icon('logout')}<span class="sign-out__label">Sign out</span>
          </button>
          <button
            type="button"
            class="icon-btn site-header__menu"
            data-slot="private"
            aria-expanded="false"
            aria-controls="site-nav"
            aria-label="Menu"
            data-testid="nav-toggle"
            hidden
          >
            ${icon('menu')}
          </button>
        </div>
      </div>
    </header>
  `);

  const nav = qs(root, '#site-nav');
  const toggle = qs(root, '[data-testid="nav-toggle"]');
  const brand = qs(root, '.brand');

  function setMenu(open, { returnFocus = false } = {}) {
    nav.dataset.open = String(open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.innerHTML = String(icon(open ? 'close' : 'menu'));
    if (!open && returnFocus) toggle.focus();
  }

  toggle.addEventListener('click', () => setMenu(nav.dataset.open !== 'true'));
  qs(root, '[data-testid="sign-out"]').addEventListener('click', () => onSignOut());

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && nav.dataset.open === 'true') setMenu(false, { returnFocus: true });
  });
  document.addEventListener('click', (event) => {
    if (nav.dataset.open === 'true' && !root.contains(event.target)) setMenu(false);
  });

  root.update = ({ route, session }) => {
    const signedIn = session.status === 'active';
    for (const el of qsa(root, '[data-slot="public"]')) el.hidden = signedIn;
    for (const el of qsa(root, '[data-slot="private"]')) el.hidden = !signedIn;
    nav.hidden = !signedIn;
    brand.setAttribute('href', signedIn ? '#/dashboard' : '#/login');
    if (signedIn) {
      qs(root, '[data-user-initials]').textContent = initials(session.displayName);
      qs(root, '[data-user-name]').textContent = session.displayName;
    }
    for (const link of qsa(root, '.site-nav__link')) {
      if (link.dataset.route === route) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    setMenu(false);
  };

  return root;
}
