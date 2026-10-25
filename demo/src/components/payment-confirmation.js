// Confirmation step: one confirmation number per accepted submission.
import { html, toElement, qs } from '../dom.js';
import { icon } from '../icons.js';
import { money, formatWeekday } from '../format.js';

export function PaymentConfirmation({ confirmation, onNewPayment }) {
  const { breakdown, source } = confirmation;
  const root = toElement(html`
    <section class="card payment-confirmation" aria-labelledby="payment-confirmation-title" data-testid="payment-confirmation" data-ifdy-component="PaymentConfirmation" data-ifdy-source="demo/src/components/payment-confirmation.js:6">
      <div class="payment-confirmation__hero">
        <span class="payment-confirmation__icon">${icon('checkCircle')}</span>
        <div>
          <h2 class="card__title" id="payment-confirmation-title" tabindex="-1">Payment scheduled</h2>
          <p class="muted">
            We'll debit ${source.name} ${source.mask} on ${formatWeekday(confirmation.date)}. A receipt was sent to the email
            address on file.
          </p>
        </div>
      </div>

      <div class="confirmation-number">
        <span class="confirmation-number__label">Confirmation number</span>
        <strong class="confirmation-number__value" data-testid="confirmation-number">${confirmation.number}</strong>
      </div>

      <dl class="kv">
        <div class="kv__row"><dt>Amount</dt><dd data-testid="confirmation-amount">${money(confirmation.amount)}</dd></div>
        <div class="kv__row"><dt>Principal</dt><dd>${money(breakdown.principal)}</dd></div>
        <div class="kv__row"><dt>Interest</dt><dd>${money(breakdown.interest)}</dd></div>
        <div class="kv__row"><dt>Escrow</dt><dd>${money(breakdown.escrow)}</dd></div>
        <div class="kv__row"><dt>Fees</dt><dd>${money(breakdown.fees)}</dd></div>
      </dl>

      <div class="btn-row">
        <a class="btn btn--primary" href="#/dashboard" data-testid="confirmation-done">Back to overview</a>
        <button type="button" class="btn btn--secondary" data-testid="payment-new">Make another payment</button>
      </div>
    </section>
  `);

  qs(root, '[data-testid="payment-new"]').addEventListener('click', onNewPayment);
  return root;
}
