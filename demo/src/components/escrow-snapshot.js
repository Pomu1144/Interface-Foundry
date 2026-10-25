// Escrow at a glance: balance, monthly deposit and the next disbursement.
import { html, toElement, setContent } from '../dom.js';
import { icon } from '../icons.js';
import { loadJSON } from '../api.js';
import { money, formatDate } from '../format.js';

export function EscrowSnapshot() {
  const root = toElement(html`
    <section class="card escrow-snapshot" aria-labelledby="escrow-snapshot-title" aria-busy="true" data-testid="escrow-snapshot" data-ifdy-component="EscrowSnapshot" data-ifdy-source="demo/src/components/escrow-snapshot.js:7">
      <div class="card__header">
        <h2 class="card__title" id="escrow-snapshot-title">Escrow at a glance</h2>
        <a class="small" href="#/statement" data-testid="escrow-snapshot-details">Escrow details</a>
      </div>
      <div data-slot="body"><span class="skeleton" style="width: 70%"></span></div>
    </section>
  `);

  loadJSON('account.json')
    .then(({ escrow }) => {
      setContent(
        root.querySelector('[data-slot="body"]'),
        html`
          <div class="escrow-snapshot__grid">
            <p class="escrow-snapshot__item">
              <span class="escrow-snapshot__label">Monthly deposit</span>
              <span class="escrow-snapshot__value num">${money(escrow.monthly)}</span>
            </p>
            <p class="escrow-snapshot__item">
              <span class="escrow-snapshot__label">Taxes and insurance per year</span>
              <span class="escrow-snapshot__value num">${money(escrow.monthly * 12)}</span>
            </p>
          </div>
          <p class="escrow-snapshot__next">
            ${icon('calendar')}
            <span>
              Next disbursement: <strong class="num">${money(escrow.nextDisbursement.amount)}</strong> to
              ${escrow.nextDisbursement.payee} on ${formatDate(escrow.nextDisbursement.date)}.
            </span>
          </p>
        `,
      );
      root.setAttribute('aria-busy', 'false');
    })
    .catch((error) => {
      console.error('[harborline] could not load escrow snapshot', error);
      setContent(root.querySelector('[data-slot="body"]'), html`<p class="muted">Escrow details are unavailable right now.</p>`);
      root.setAttribute('aria-busy', 'false');
    });

  return root;
}
