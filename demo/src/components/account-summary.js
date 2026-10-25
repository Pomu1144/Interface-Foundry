// Loan overview card: next payment, masked loan number, balances and rate.
import { html, toElement, setContent } from '../dom.js';
import { icon } from '../icons.js';
import { loadJSON } from '../api.js';
import { money, formatDate, formatDateNoYear, daysBetween, maskAccount } from '../format.js';

export function AccountSummary() {
  const root = toElement(html`
    <section class="card account-summary" aria-labelledby="account-summary-title" aria-busy="true" data-testid="account-summary" data-ifdy-component="AccountSummary" data-ifdy-source="demo/src/components/account-summary.js:7">
      <div class="card__header">
        <h2 class="card__title" id="account-summary-title">Your loan</h2>
        <span class="badge badge--teal">${icon('checkCircle')}Current</span>
      </div>
      <div data-slot="body">
        <div class="next-payment next-payment--loading">
          <span class="skeleton" style="width: 40%"></span>
          <span class="skeleton" style="width: 70%; height: 2.5rem"></span>
          <span class="skeleton" style="width: 55%"></span>
        </div>
      </div>
    </section>
  `);

  loadJSON('account.json')
    .then((account) => {
      const { loan, nextPayment, escrow, asOf } = account;
      const daysLeft = daysBetween(asOf, nextPayment.dueDate);
      const paid = loan.originalPrincipal - loan.principalBalance;
      const paidPct = (paid / loan.originalPrincipal) * 100;
      setContent(
        root.querySelector('[data-slot="body"]'),
        html`
          <div class="account-summary__body">
            <div class="next-payment">
              <p class="next-payment__label">Next payment</p>
              <p class="next-payment__amount num" data-testid="next-payment-amount">${money(nextPayment.amount)}</p>
              <p class="next-payment__due" data-testid="next-payment-due">
                ${icon('calendar')}<span>Due ${formatDate(nextPayment.dueDate)} · ${daysLeft} days left</span>
              </p>
              <p class="next-payment__note">
                No late fee if received by ${formatDateNoYear(nextPayment.graceEnds)}. Autopay is ${nextPayment.autopay ? 'on' : 'off'}.
              </p>
            </div>

            <dl class="metrics">
              <div class="metric">
                <dt>Loan number</dt>
                <dd class="num" data-testid="loan-number">${maskAccount(loan.last4)}</dd>
              </div>
              <div class="metric">
                <dt>Principal balance</dt>
                <dd class="num" data-testid="principal-balance">${money(loan.principalBalance)}</dd>
              </div>
              <div class="metric">
                <dt>Interest rate</dt>
                <dd data-testid="interest-rate"><span class="num">${loan.interestRate.toFixed(3)}%</span> <span class="metric__unit">fixed</span></dd>
              </div>
              <div class="metric">
                <dt>Escrow balance</dt>
                <dd class="num" data-testid="escrow-balance">${money(escrow.balance)}</dd>
              </div>
            </dl>

            <div class="payoff">
              <div class="payoff__label">
                <span>Paid toward original principal</span>
                <span class="num">${paidPct.toFixed(1)}%</span>
              </div>
              <div class="payoff__track" aria-hidden="true">
                <span class="payoff__fill" style="width: ${paidPct.toFixed(2)}%"></span>
              </div>
              <p class="payoff__meta">
                <span class="num">${money(paid)}</span> of <span class="num">${money(loan.originalPrincipal)}</span> ·
                ${loan.paymentsMade} of ${loan.termMonths} payments made · ${loan.type}, ${loan.program}
              </p>
            </div>
          </div>
        `,
      );
      root.setAttribute('aria-busy', 'false');
    })
    .catch((error) => {
      console.error('[harborline] could not load account summary', error);
      setContent(
        root.querySelector('[data-slot="body"]'),
        html`<div class="alert alert--danger" role="alert">${icon('alert')}<p>We couldn't load your loan details. Refresh the page to try again.</p></div>`,
      );
      root.setAttribute('aria-busy', 'false');
    });

  return root;
}
