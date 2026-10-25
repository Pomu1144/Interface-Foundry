// Placeholder rendered behind the session dialog so account details are not
// left on screen while the session is expired.
import { html, toElement } from '../dom.js';
import { icon } from '../icons.js';

export function SessionPaused() {
  return toElement(html`
    <div class="page session-expired" data-testid="session-paused" data-ifdy-component="SessionPaused" data-ifdy-source="demo/src/components/session-paused.js:6">
      <div class="split">
        <section class="card session-expired__card" aria-labelledby="session-paused-title">
          <span class="session-expired__icon">${icon('shield')}</span>
          <h1 class="page__title" id="session-paused-title">Session paused</h1>
          <p class="session-expired__text">Your account details are hidden until you confirm it's you.</p>
        </section>
      </div>
    </div>
  `);
}
