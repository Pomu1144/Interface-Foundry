// Shortcut links to the most common borrower tasks.
import { html, toElement } from '../dom.js';
import { icon } from '../icons.js';

const ACTIONS = [
  { route: 'payment', testid: 'qa-make-payment', icon: 'card', label: 'Make a payment', detail: 'One-time payment or extra principal' },
  { route: 'statement', testid: 'qa-view-statement', icon: 'document', label: 'View statement', detail: 'October 2026 statement is ready' },
  { route: 'profile', testid: 'qa-update-profile', icon: 'user', label: 'Update profile', detail: 'Phone, email and mailing address' },
];

export function QuickActions() {
  return toElement(html`
    <section class="card quick-actions" aria-labelledby="quick-actions-title" data-testid="quick-actions" data-ifdy-component="QuickActions" data-ifdy-source="demo/src/components/quick-actions.js:11">
      <h2 class="card__title" id="quick-actions-title">Quick actions</h2>
      <ul class="quick-actions__list">
        ${ACTIONS.map(
          (action) => html`
            <li>
              <a class="quick-action" href="#/${action.route}" data-testid="${action.testid}">
                <span class="quick-action__icon">${icon(action.icon)}</span>
                <span class="quick-action__text">
                  <span class="quick-action__label">${action.label}</span>
                  <span class="quick-action__detail">${action.detail}</span>
                </span>
                ${icon('chevronRight', 'quick-action__chevron')}
              </a>
            </li>
          `,
        )}
      </ul>
    </section>
  `);
}
