// Mortgage statement route: amount due, account information, past payments,
// full transaction activity and the explanatory notices.
import { html, toElement, qs, setContent } from '../dom.js';
import { icon } from '../icons.js';
import { loadJSON } from '../api.js';
import { money, formatDate, maskAccount } from '../format.js';
import { StatementTable } from './statement-table.js';
import { EscrowAnalysis } from './escrow-analysis.js';

const BREAKDOWN_ROWS = [
  ['principal', 'Principal'],
  ['interest', 'Interest'],
  ['escrow', 'Escrow (taxes and insurance)'],
  ['fees', 'Fees and charges'],
];

export function StatementPage() {
  const root = toElement(html`
    <div class="page statement" data-ifdy-component="StatementPage" data-ifdy-source="demo/src/components/statement-page.js:17">
      <header class="page__header">
        <div>
          <p class="page__eyebrow">Mortgage statement</p>
          <h1 class="page__title" id="statement-title">October 2026 statement</h1>
          <p class="page__lede" data-slot="lede">Loading statement details…</p>
        </div>
        <div class="statement__actions btn-row">
          <button type="button" class="btn btn--primary statement__download" data-testid="download-statement">
            ${icon('download')}<span>Download statement (PDF)</span>
          </button>
          <a class="btn btn--secondary" href="#/payment" data-testid="statement-make-payment">Make a payment</a>
        </div>
      </header>
      <p class="statement__download-status alert alert--info" role="status" data-testid="download-status" hidden></p>
      <div class="statement__content" aria-busy="true" data-slot="content">
        <div class="split">
          <div class="card"><span class="skeleton" style="width: 50%"></span><span class="skeleton" style="width: 80%; height: 2.5rem; margin-top: 1rem"></span></div>
          <div class="card"><span class="skeleton" style="width: 70%"></span></div>
        </div>
      </div>
    </div>
  `);

  const status = qs(root, '[data-testid="download-status"]');
  qs(root, '[data-testid="download-statement"]').addEventListener('click', () => {
    status.hidden = false;
    status.textContent = 'Preparing your October 2026 statement… In this demo no file is downloaded.';
  });

  loadJSON('statement.json')
    .then((statement) => renderStatement(statement))
    .catch((error) => {
      console.error('[harborline] could not load statement', error);
      setContent(
        qs(root, '[data-slot="content"]'),
        html`<div class="alert alert--danger" role="alert">${icon('alert')}<p>We couldn't load this statement. Refresh the page to try again.</p></div>`,
      );
    });

  function renderStatement(s) {
    qs(root, '[data-slot="lede"]').textContent =
      `Statement date ${formatDate(s.statementDate)} · Loan ${maskAccount(s.loan.last4)} · ${s.property}`;

    const content = qs(root, '[data-slot="content"]');
    setContent(
      content,
      html`
        <div class="split statement__overview">
          <section class="card amount-due" aria-labelledby="amount-due-title" data-testid="amount-due">
            <h2 class="card__title" id="amount-due-title">Amount due</h2>
            <p class="amount-due__total num" data-testid="amount-due-total">${money(s.amountDue.total)}</p>
            <p class="amount-due__date">${icon('calendar')}<span>Due by ${formatDate(s.amountDue.dueDate)}</span></p>
            <p class="amount-due__late">
              If we receive your payment after ${formatDate(s.lateFee.assessedAfter)}, a
              <strong class="num">${money(s.lateFee.amount)}</strong> late fee will be charged, for a total of
              <strong class="num">${money(s.lateFee.totalIfLate)}</strong>.
            </p>
            <h3 class="statement__subhead">Explanation of amount due</h3>
            <dl class="kv">
              ${BREAKDOWN_ROWS.map(
                ([key, label]) => html`<div class="kv__row"><dt>${label}</dt><dd>${money(s.amountDue[key])}</dd></div>`,
              )}
              <div class="kv__row"><dt>Overdue amount</dt><dd>${money(s.amountDue.overdue)}</dd></div>
              <div class="kv__row kv__row--total"><dt>Total amount due</dt><dd>${money(s.amountDue.total)}</dd></div>
            </dl>
          </section>

          <div class="stack">
            <section class="card" aria-labelledby="account-info-title">
              <h2 class="card__title" id="account-info-title">Account information</h2>
              <dl class="kv">
                <div class="kv__row"><dt>Outstanding principal</dt><dd data-testid="statement-principal">${money(s.accountInfo.outstandingPrincipal)}</dd></div>
                <div class="kv__row"><dt>Interest rate</dt><dd>${s.accountInfo.interestRate.toFixed(3)}% fixed</dd></div>
                <div class="kv__row"><dt>Escrow balance</dt><dd>${money(s.accountInfo.escrowBalance)}</dd></div>
                <div class="kv__row"><dt>Unapplied funds (suspense)</dt><dd>${money(s.accountInfo.suspense)}</dd></div>
                <div class="kv__row"><dt>Maturity date</dt><dd>${formatDate(s.accountInfo.maturityDate)}</dd></div>
                <div class="kv__row"><dt>Prepayment penalty</dt><dd>${s.loan.prepaymentPenalty}</dd></div>
              </dl>
            </section>

            <section class="card" aria-labelledby="past-payments-title">
              <h2 class="card__title" id="past-payments-title">Past payments breakdown</h2>
              <table class="mini-table">
                <caption class="visually-hidden">Amounts paid last month and year to date</caption>
                <thead>
                  <tr>
                    <th scope="col"><span class="visually-hidden">Category</span></th>
                    <th scope="col">Paid last month</th>
                    <th scope="col">Paid year to date</th>
                  </tr>
                </thead>
                <tbody>
                  ${BREAKDOWN_ROWS.map(
                    ([key, label]) => html`
                      <tr>
                        <th scope="row">${label}</th>
                        <td>${money(s.pastPayments.lastMonth[key])}</td>
                        <td>${money(s.pastPayments.yearToDate[key])}</td>
                      </tr>
                    `,
                  )}
                  <tr class="mini-table__total">
                    <th scope="row">Total</th>
                    <td>${money(s.pastPayments.lastMonth.total)}</td>
                    <td>${money(s.pastPayments.yearToDate.total)}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          </div>
        </div>

        <div data-slot="table"></div>

        <div class="split statement__notes">
          <div class="stack" data-slot="notes-primary"></div>
          <div class="stack" data-slot="notes-secondary"></div>
        </div>
      `,
    );

    qs(content, '[data-slot="table"]').replaceWith(StatementTable({ transactions: s.transactions, range: s.transactionsRange }));

    const sectionCard = (section) =>
      toElement(html`
        <section class="card statement-note" aria-labelledby="note-${section.id}" data-testid="statement-note-${section.id}">
          <h2 class="card__title" id="note-${section.id}">${section.title}</h2>
          ${section.paragraphs.map((p) => html`<p>${p}</p>`)}
        </section>
      `);
    const [escrowExplained, lateFee, ...rest] = s.sections;
    qs(content, '[data-slot="notes-primary"]').append(EscrowAnalysis(), sectionCard(escrowExplained));
    qs(content, '[data-slot="notes-secondary"]').append(sectionCard(lateFee), ...rest.map(sectionCard));
    content.setAttribute('aria-busy', 'false');
  }

  return root;
}
