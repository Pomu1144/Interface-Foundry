// Recent account activity list (payments, statements, escrow, profile changes).
import { html, toElement, setContent } from '../dom.js';
import { icon } from '../icons.js';
import { loadJSON } from '../api.js';
import { money, formatDateShort } from '../format.js';

const KIND_ICON = { payment: 'card', statement: 'document', escrow: 'umbrella', profile: 'user' };
const STATUS_BADGE = { New: 'badge--gold', Posted: 'badge--teal', Paid: 'badge--navy', Completed: '' };

export function RecentActivity() {
  const root = toElement(html`
    <section class="card activity" aria-labelledby="activity-title" aria-busy="true" data-testid="recent-activity" data-ifdy-component="RecentActivity" data-ifdy-source="demo/src/components/recent-activity.js:10">
      <div class="card__header">
        <h2 class="card__title" id="activity-title">Recent activity</h2>
        <a class="small" href="#/statement" data-testid="activity-view-history">View transaction history</a>
      </div>
      <div data-slot="list">
        <span class="skeleton" style="width: 90%"></span>
      </div>
    </section>
  `);

  loadJSON('activity.json')
    .then(({ items }) => {
      setContent(
        root.querySelector('[data-slot="list"]'),
        html`
          <ul class="activity__list">
            ${items.map(
              (item) => html`
                <li class="activity__item" data-testid="activity-item">
                  <span class="activity__icon activity__icon--${item.kind}">${icon(KIND_ICON[item.kind] ?? 'info')}</span>
                  <span class="activity__main">
                    <span class="activity__title">${item.title}</span>
                    <span class="activity__meta"><time datetime="${item.date}">${formatDateShort(item.date)}</time> · ${item.detail}</span>
                  </span>
                  <span class="activity__side">
                    ${item.amount === null ? '' : html`<span class="activity__amount num">${money(item.amount)}</span>`}
                    <span class="badge ${STATUS_BADGE[item.status] ?? ''}">${item.status}</span>
                  </span>
                </li>
              `,
            )}
          </ul>
        `,
      );
      root.setAttribute('aria-busy', 'false');
    })
    .catch((error) => {
      console.error('[harborline] could not load recent activity', error);
      setContent(root.querySelector('[data-slot="list"]'), html`<p class="muted">Recent activity is unavailable right now.</p>`);
      root.setAttribute('aria-busy', 'false');
    });

  return root;
}
