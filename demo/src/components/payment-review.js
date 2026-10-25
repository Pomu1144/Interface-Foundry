// Review step: summarises the draft and submits it. Submission is guarded so a
// double-click (or Enter + click) can never create two payments, and failures
// offer a Retry that reuses the same idempotency key.
import { html, toElement, qs, qsa, setContent } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import { submitPayment } from '../api.js';
import { money, parseAmount, formatWeekday } from '../format.js';
import { computeBreakdown } from '../payments.js';

export function PaymentReview({ account, onEdit, onConfirmed }) {
  const draft = state.payment.draft;
  const source = account.paymentSources.find((s) => s.id === draft.sourceId) ?? account.paymentSources[0];
  const amount = parseAmount(draft.amount);
  const breakdown = computeBreakdown(amount, account.nextPayment);

  const root = toElement(html`
    <section class="card payment-review" aria-labelledby="payment-review-title" data-testid="payment-review" data-ifdy-component="PaymentReview" data-ifdy-source="demo/src/components/payment-review.js:11">
      <h2 class="card__title" id="payment-review-title" tabindex="-1">Review your payment</h2>

      <div class="review-amount">
        <span class="review-amount__label">You're paying</span>
        <span class="review-amount__value num" data-testid="review-amount">${money(amount)}</span>
        <span class="review-amount__meta">
          ${icon('calendar')}<span>on ${formatWeekday(draft.date)}</span>
        </span>
      </div>

      <dl class="kv">
        <div class="kv__row"><dt>From</dt><dd data-testid="review-source">${source.name} ${source.mask}</dd></div>
        <div class="kv__row"><dt>To</dt><dd>Harborline loan ••••${account.loan.last4}</dd></div>
        <div class="kv__row"><dt>Principal</dt><dd>${money(breakdown.principal)}</dd></div>
        <div class="kv__row"><dt>Interest</dt><dd>${money(breakdown.interest)}</dd></div>
        <div class="kv__row"><dt>Escrow</dt><dd>${money(breakdown.escrow)}</dd></div>
        <div class="kv__row"><dt>Fees</dt><dd>${money(breakdown.fees)}</dd></div>
        <div class="kv__row kv__row--total"><dt>Total</dt><dd>${money(breakdown.total)}</dd></div>
      </dl>

      <p class="payment-review__auth">
        By selecting <strong>Submit payment</strong>, you authorize Harborline Home Loans to debit ${money(amount)} from
        ${source.name} ${source.mask} on ${formatWeekday(draft.date)}. This is a synthetic demo; no money moves.
      </p>

      <div data-slot="alert"></div>

      <div class="btn-row payment-review__actions">
        <button type="button" class="btn btn--primary" data-testid="payment-submit">
          <span class="spinner" aria-hidden="true" hidden></span>
          <span data-label>Submit payment</span>
        </button>
        <button type="button" class="btn btn--secondary" data-testid="payment-edit">
          ${icon('arrowLeft')}<span>Edit details</span>
        </button>
      </div>
      <p class="visually-hidden" role="status" data-slot="status"></p>
    </section>
  `);

  const submit = qs(root, '[data-testid="payment-submit"]');
  const edit = qs(root, '[data-testid="payment-edit"]');
  const alertSlot = qs(root, '[data-slot="alert"]');
  const statusSlot = qs(root, '[data-slot="status"]');

  function setPending(pending) {
    state.payment.pending = pending;
    for (const button of [submit, edit, ...qsa(alertSlot, 'button')]) button.disabled = pending;
    submit.setAttribute('aria-busy', String(pending));
    qs(submit, '.spinner').hidden = !pending;
    qs(submit, '[data-label]').textContent = pending ? 'Submitting…' : 'Submit payment';
    statusSlot.textContent = pending ? 'Submitting your payment…' : '';
  }

  async function send() {
    // Guard first, synchronously: a second click in the same frame is ignored.
    if (state.payment.pending || state.payment.confirmation) return;
    setPending(true);
    const retry = qs(alertSlot, '[data-testid="payment-retry"]');
    if (retry) {
      retry.disabled = true;
      qs(retry, '.spinner').hidden = false;
    }
    try {
      const confirmation = await submitPayment({
        idempotencyKey: state.payment.idempotencyKey,
        amount,
        date: draft.date,
        source: { id: source.id, name: source.name, mask: source.mask },
        breakdown,
      });
      state.payment.pending = false;
      state.payment.error = null;
      state.payment.confirmation = confirmation;
      onConfirmed(confirmation);
    } catch (error) {
      state.payment.error = error.message;
      if (!root.isConnected) {
        state.payment.pending = false;
        return;
      }
      setContent(
        alertSlot,
        html`
          <div class="alert alert--danger payment-review__error" role="alert" data-testid="payment-error">
            ${icon('alert')}
            <div>
              <strong class="alert__title">${error.message}</strong>
              <p>Your payment was not submitted and you have not been charged. It's safe to try again.</p>
              <button type="button" class="btn btn--primary btn--sm payment-review__retry" data-testid="payment-retry">
                <span class="spinner" aria-hidden="true" hidden></span>
                ${icon('refresh')}<span>Retry payment</span>
              </button>
            </div>
          </div>
        `,
      );
      qs(alertSlot, '[data-testid="payment-retry"]').addEventListener('click', send);
      setPending(false);
      qs(alertSlot, '[data-testid="payment-retry"]').focus();
    }
  }

  submit.addEventListener('click', send);
  edit.addEventListener('click', () => {
    if (!state.payment.pending) onEdit();
  });

  return root;
}
