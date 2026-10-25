// Payment route: Details -> Review -> Confirmation, driven by state.payment.
import { html, toElement, qs, qsa, setContent } from '../dom.js';
import { icon } from '../icons.js';
import { loadJSON, newIdempotencyKey } from '../api.js';
import { state, resetPayment } from '../store.js';
import { money, formatDate, maskAccount } from '../format.js';
import { PaymentForm } from './payment-form.js';
import { PaymentReview } from './payment-review.js';
import { PaymentConfirmation } from './payment-confirmation.js';

const STEPS = [
  { id: 'details', label: 'Details' },
  { id: 'review', label: 'Review' },
  { id: 'confirmation', label: 'Confirmation' },
];

export function PaymentPage({ onCleanup }) {
  const root = toElement(html`
    <div class="page payment" data-ifdy-component="PaymentPage" data-ifdy-source="demo/src/components/payment-page.js:17">
      <header class="page__header">
        <div>
          <p class="page__eyebrow">Payments</p>
          <h1 class="page__title" id="payment-title">Make a payment</h1>
          <p class="page__lede" data-slot="lede">Loading your payment options…</p>
        </div>
      </header>
      <ol class="stepper" aria-label="Payment steps" data-testid="payment-stepper">
        ${STEPS.map(
          (step, index) => html`
            <li class="stepper__step" data-step="${step.id}">
              <span class="stepper__index" aria-hidden="true">${index + 1}</span>
              <span class="stepper__label">${step.label}</span>
              <span class="visually-hidden" data-step-state></span>
            </li>
          `,
        )}
      </ol>
      <div class="split payment__layout">
        <div class="stack" data-slot="step" aria-live="off">
          <div class="card"><span class="skeleton" style="width: 40%"></span><span class="skeleton" style="width: 90%; height: 3rem; margin-top: 1rem"></span></div>
        </div>
        <aside class="stack payment__aside" aria-label="Payment information" data-slot="aside"></aside>
      </div>
    </div>
  `);

  const stepSlot = qs(root, '[data-slot="step"]');
  let account = null;

  function updateStepper() {
    const currentIndex = STEPS.findIndex((s) => s.id === state.payment.step);
    for (const item of qsa(root, '.stepper__step')) {
      const index = STEPS.findIndex((s) => s.id === item.dataset.step);
      const status = index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming';
      item.dataset.status = status;
      if (status === 'current') item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
      qs(item, '[data-step-state]').textContent = status === 'complete' ? ', completed' : status === 'current' ? ', current step' : '';
    }
  }

  function go(step) {
    state.payment.step = step;
    renderStep({ focus: true });
  }

  function renderStep({ focus = false } = {}) {
    if (!account) return;
    let view;
    if (state.payment.step === 'confirmation' && state.payment.confirmation) {
      view = PaymentConfirmation({
        confirmation: state.payment.confirmation,
        onNewPayment: () => {
          resetPayment();
          go('details');
        },
      });
    } else if (state.payment.step === 'review') {
      view = PaymentReview({
        account,
        onEdit: () => go('details'),
        onConfirmed: () => {
          state.payment.step = 'confirmation';
          if (root.isConnected) renderStep({ focus: true });
        },
      });
    } else {
      state.payment.step = 'details';
      view = PaymentForm({
        account,
        onContinue: () => {
          state.payment.idempotencyKey = newIdempotencyKey();
          go('review');
        },
      });
    }
    setContent(stepSlot, view);
    updateStepper();
    if (focus) qs(view, 'h2')?.focus();
  }

  function renderAside() {
    const { nextPayment, payment } = account;
    setContent(
      qs(root, '[data-slot="aside"]'),
      html`
        <section class="card" aria-labelledby="regular-payment-title">
          <h2 class="card__title" id="regular-payment-title">Your regular payment</h2>
          <p class="aside-amount num">${money(nextPayment.amount)}</p>
          <p class="small muted">Due ${formatDate(nextPayment.dueDate)}</p>
          <dl class="kv">
            <div class="kv__row"><dt>Principal</dt><dd>${money(nextPayment.principal)}</dd></div>
            <div class="kv__row"><dt>Interest</dt><dd>${money(nextPayment.interest)}</dd></div>
            <div class="kv__row"><dt>Escrow</dt><dd>${money(nextPayment.escrow)}</dd></div>
            <div class="kv__row"><dt>Fees</dt><dd>${money(nextPayment.fees)}</dd></div>
          </dl>
        </section>
        <section class="card good-to-know" aria-labelledby="good-to-know-title">
          <h2 class="card__title" id="good-to-know-title">Good to know</h2>
          <ul class="good-to-know__list">
            <li>${icon('clock')}<span>Payments made before ${payment.cutoff} on a business day are credited the same day.</span></li>
            <li>${icon('sparkle')}<span>Extra principal can shorten your loan term. There's no prepayment penalty.</span></li>
            <li>${icon('shield')}<span>We'll never call to ask for your online banking password.</span></li>
          </ul>
        </section>
      `,
    );
  }

  loadJSON('account.json')
    .then((data) => {
      account = data;
      qs(root, '[data-slot="lede"]').textContent =
        `Loan ${maskAccount(data.loan.last4)} · Next payment due ${formatDate(data.nextPayment.dueDate)}`;
      renderAside();
      renderStep();
    })
    .catch((error) => {
      console.error('[harborline] could not load payment options', error);
      setContent(stepSlot, html`<div class="alert alert--danger" role="alert">${icon('alert')}<p>Payments are unavailable right now. Please try again later.</p></div>`);
    });

  onCleanup(() => {
    // A finished payment should not greet the borrower next time they visit.
    if (state.payment.step === 'confirmation' && !state.payment.pending) resetPayment();
  });

  updateStepper();
  return root;
}
