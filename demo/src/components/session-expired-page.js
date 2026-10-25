// Signed-out page shown after a borrower ends an expired session.
import { html, toElement } from '../dom.js';
import { icon } from '../icons.js';

export function SessionExpiredPage() {
  return toElement(html`
    <div class="page session-expired" data-ifdy-component="SessionExpiredPage" data-ifdy-source="demo/src/components/session-expired-page.js:5">
      <div class="split">
        <section class="card session-expired__card" aria-labelledby="session-expired-title" data-testid="session-expired">
          <span class="session-expired__icon">${icon('lock')}</span>
          <h1 class="page__title" id="session-expired-title">You've been signed out</h1>
          <p class="session-expired__text">
            For your security, we end online sessions after a period of inactivity or when you choose to sign out.
            Drafts of payments and profile changes were cleared from this device.
          </p>
          <div class="btn-row">
            <a class="btn btn--primary" href="#/login" data-testid="session-expired-sign-in">Sign in again</a>
          </div>
          <p class="small muted">Didn't sign out? Call <a href="tel:+18005550142">1-800-555-0142</a> right away.</p>
        </section>
        <section class="card session-tips" aria-labelledby="session-tips-title">
          <h2 class="card__title" id="session-tips-title">Keep your account secure</h2>
          <ul class="good-to-know__list">
            <li>${icon('logout')}<span>Always sign out when you use a shared or public device.</span></li>
            <li>${icon('shield')}<span>Harborline will never call, text or email to ask for your password or passcode.</span></li>
            <li>${icon('phone')}<span>Keep your mobile number current so we can send sign-in passcodes.</span></li>
          </ul>
        </section>
      </div>
    </div>
  `);
}
