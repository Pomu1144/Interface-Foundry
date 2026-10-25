// Payment details step: amount (with live breakdown), date and source account.
// Every change is saved to the in-memory draft so it survives navigation and
// session re-authentication.
import { html, toElement, qs, qsa, setContent } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import { money, amountForInput, parseAmount, formatDateShort } from '../format.js';
import { computeBreakdown, validateAmount, validateDate } from '../payments.js';

export function PaymentForm({ account, onContinue }) {
  const { nextPayment, payment, paymentSources } = account;
  const draft = state.payment.draft;
  if (!draft.amount) draft.amount = amountForInput(nextPayment.amount);
  if (!draft.date) draft.date = payment.defaultDate;
  if (!draft.sourceId) draft.sourceId = (paymentSources.find((s) => s.default) ?? paymentSources[0]).id;

  const root = toElement(html`
    <form class="card payment-form" novalidate aria-labelledby="payment-details-title" data-testid="payment-form" data-ifdy-component="PaymentForm" data-ifdy-source="demo/src/components/payment-form.js:10">
      <h2 class="card__title" id="payment-details-title" tabindex="-1">Payment details</h2>

      <div class="field">
        <label class="field__label" for="payment-amount">Payment amount</label>
        <p class="field__hint" id="payment-amount-hint">
          Your regular payment is ${money(nextPayment.amount)}. Anything above that is applied to principal.
        </p>
        <div class="input-group input-group--prefixed">
          <span class="input-group__prefix" aria-hidden="true">$</span>
          <input
            class="input input--amount num"
            id="payment-amount"
            name="amount"
            type="text"
            inputmode="decimal"
            autocomplete="transaction-amount"
            aria-describedby="payment-amount-hint"
            data-testid="payment-amount"
          />
        </div>
        <div class="amount-presets" role="group" aria-label="Suggested amounts">
          <button type="button" class="chip" data-amount="${nextPayment.amount}" data-testid="payment-preset-regular">
            Regular payment
          </button>
          <button type="button" class="chip" data-amount="${nextPayment.amount + 1000}" data-testid="payment-preset-extra">
            + $1,000 to principal
          </button>
        </div>
        <p class="field__error" id="payment-amount-error" data-testid="payment-amount-error" hidden>${icon('alert')}<span></span></p>
      </div>

      <section class="breakdown" aria-labelledby="payment-breakdown-title">
        <h3 class="breakdown__title" id="payment-breakdown-title">How this payment is applied</h3>
        <div data-slot="breakdown" data-testid="payment-breakdown"></div>
      </section>

      <div class="field">
        <label class="field__label" for="payment-date">Payment date</label>
        <p class="field__hint" id="payment-date-hint">
          Between ${formatDateShort(payment.earliestDate)} and ${formatDateShort(payment.latestDate)}. Payments made after
          ${formatDateShort(nextPayment.graceEnds)} are charged a late fee.
        </p>
        <input
          class="input input--date"
          id="payment-date"
          name="date"
          type="date"
          min="${payment.earliestDate}"
          max="${payment.latestDate}"
          aria-describedby="payment-date-hint"
          data-testid="payment-date"
        />
        <p class="field__error" id="payment-date-error" data-testid="payment-date-error" hidden>${icon('alert')}<span></span></p>
      </div>

      <fieldset class="field">
        <legend class="field__label">Pay from</legend>
        <div class="source-options">
          ${paymentSources.map(
            (source) => html`
              <label class="source-option">
                <input type="radio" name="source" value="${source.id}" data-testid="payment-source-${source.id}" />
                <span class="source-option__icon">${icon('bank')}</span>
                <span class="source-option__body">
                  <span class="source-option__name">${source.name} <span class="num">${source.mask}</span></span>
                  <span class="source-option__meta">${source.kind} · ${source.institution}</span>
                </span>
              </label>
            `,
          )}
        </div>
      </fieldset>

      <div class="btn-row payment-form__actions">
        <button type="submit" class="btn btn--primary" data-testid="payment-continue">
          <span>Review payment</span>${icon('arrowRight')}
        </button>
        <a class="btn btn--ghost" href="#/dashboard" data-testid="payment-cancel">Cancel</a>
      </div>
    </form>
  `);

  const amount = qs(root, '#payment-amount');
  const date = qs(root, '#payment-date');
  const breakdownSlot = qs(root, '[data-slot="breakdown"]');
  let attempted = false;

  amount.value = draft.amount;
  date.value = draft.date;
  for (const radio of qsa(root, 'input[name="source"]')) radio.checked = radio.value === draft.sourceId;

  function renderBreakdown() {
    const breakdown = computeBreakdown(parseAmount(amount.value), nextPayment);
    if (!breakdown) {
      setContent(
        breakdownSlot,
        html`<p class="breakdown__empty">Enter at least ${money(nextPayment.amount)} to see how your payment is applied.</p>`,
      );
      return;
    }
    setContent(
      breakdownSlot,
      html`
        <dl class="kv">
          <div class="kv__row"><dt>Principal</dt><dd data-testid="breakdown-principal">${money(breakdown.principal)}</dd></div>
          <div class="kv__row"><dt>Interest</dt><dd data-testid="breakdown-interest">${money(breakdown.interest)}</dd></div>
          <div class="kv__row"><dt>Escrow</dt><dd data-testid="breakdown-escrow">${money(breakdown.escrow)}</dd></div>
          <div class="kv__row"><dt>Fees</dt><dd data-testid="breakdown-fees">${money(breakdown.fees)}</dd></div>
          <div class="kv__row kv__row--total"><dt>Total</dt><dd data-testid="breakdown-total">${money(breakdown.total)}</dd></div>
        </dl>
        ${breakdown.additionalPrincipal > 0
          ? html`<p class="breakdown__note">${icon('sparkle')}<span>Includes <strong class="num">${money(breakdown.additionalPrincipal)}</strong> of additional principal.</span></p>`
          : ''}
      `,
    );
  }

  function setError(input, errorId, message) {
    const error = qs(root, `#${errorId}`);
    const hint = input.getAttribute('aria-describedby').split(' ')[0];
    if (message) {
      qs(error, 'span').textContent = message;
      error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', `${hint} ${errorId}`);
    } else {
      error.hidden = true;
      input.removeAttribute('aria-invalid');
      input.setAttribute('aria-describedby', hint);
    }
  }

  function validate() {
    const amountError = validateAmount(amount.value, account).error;
    const dateError = validateDate(date.value, account);
    setError(amount, 'payment-amount-error', amountError);
    setError(date, 'payment-date-error', dateError);
    return [amountError && amount, dateError && date].filter(Boolean);
  }

  amount.addEventListener('input', () => {
    draft.amount = amount.value;
    renderBreakdown();
    if (attempted) validate();
  });
  amount.addEventListener('blur', () => {
    const value = parseAmount(amount.value);
    if (Number.isFinite(value)) {
      amount.value = amountForInput(value);
      draft.amount = amount.value;
    }
  });
  date.addEventListener('change', () => {
    draft.date = date.value;
    if (attempted) validate();
  });
  root.addEventListener('change', (event) => {
    if (event.target.name === 'source') draft.sourceId = event.target.value;
  });
  for (const chip of qsa(root, '.chip')) {
    chip.addEventListener('click', () => {
      amount.value = amountForInput(Number(chip.dataset.amount));
      draft.amount = amount.value;
      renderBreakdown();
      if (attempted) validate();
    });
  }

  root.addEventListener('submit', (event) => {
    event.preventDefault();
    attempted = true;
    const invalid = validate();
    if (invalid.length) {
      invalid[0].focus();
      return;
    }
    const value = parseAmount(amount.value);
    draft.amount = amountForInput(value);
    onContinue();
  });

  renderBreakdown();
  return root;
}
