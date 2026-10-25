// Dashboard route: greeting, loan summary, quick actions, activity and notice.
import { html, toElement, qs } from '../dom.js';
import { state } from '../store.js';
import { formatDate } from '../format.js';
import { AccountSummary } from './account-summary.js';
import { QuickActions } from './quick-actions.js';
import { RecentActivity } from './recent-activity.js';
import { ImportantNotice } from './important-notice.js';
import { EscrowSnapshot } from './escrow-snapshot.js';

const AS_OF = '2026-10-25';

function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardPage() {
  const firstName = (state.session.displayName ?? 'there').split(' ')[0];
  const root = toElement(html`
    <div class="page dashboard" data-ifdy-component="DashboardPage" data-ifdy-source="demo/src/components/dashboard-page.js:20">
      <header class="page__header">
        <div>
          <p class="page__eyebrow">Account overview</p>
          <h1 class="page__title" id="dashboard-title">${greeting()}, ${firstName}</h1>
          <p class="page__lede">Here's where your home loan stands as of ${formatDate(AS_OF)}.</p>
        </div>
      </header>
      <div class="split">
        <div class="stack" data-slot="primary"></div>
        <div class="stack" data-slot="secondary"></div>
      </div>
      <div data-slot="notice"></div>
    </div>
  `);

  qs(root, '[data-slot="primary"]').append(AccountSummary(), EscrowSnapshot());
  qs(root, '[data-slot="secondary"]').append(QuickActions(), RecentActivity());
  qs(root, '[data-slot="notice"]').replaceWith(ImportantNotice());
  return root;
}
