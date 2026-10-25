// Transaction activity table for the mortgage statement.
import { html, toElement } from '../dom.js';
import { ledger, money, formatDateShort } from '../format.js';

const COLUMNS = ['Principal', 'Interest', 'Escrow', 'Fees', 'Total', 'Balance'];

export function StatementTable({ transactions, range }) {
  return toElement(html`
    <section class="card statement-activity" aria-labelledby="statement-activity-title" data-testid="statement-activity" data-ifdy-component="StatementTable" data-ifdy-source="demo/src/components/statement-table.js:7">
      <div class="statement-activity__header">
        <h2 class="card__title" id="statement-activity-title">Transaction activity</h2>
        <p class="small muted">
          ${formatDateShort(range.start)} – ${formatDateShort(range.end)} · ${transactions.length} transactions, newest first
        </p>
      </div>
      <table class="statement-table" data-testid="statement-table">
        <caption class="visually-hidden">
          Transaction activity from ${formatDateShort(range.start)} to ${formatDateShort(range.end)}, newest first. Amounts in US dollars;
          balance is the unpaid principal balance after each transaction.
        </caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Description</th>
            ${COLUMNS.map((label) => html`<th scope="col" class="statement-table__num">${label}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${transactions.map(
            (tx) => html`
              <tr class="statement-table__row statement-table__row--${tx.type}" data-testid="statement-row">
                <td class="statement-table__date"><time datetime="${tx.date}">${formatDateShort(tx.date)}</time></td>
                <td class="statement-table__desc">${tx.description}</td>
                <td class="statement-table__num">${ledger(tx.principal)}</td>
                <td class="statement-table__num">${ledger(tx.interest)}</td>
                <td class="statement-table__num${tx.escrow < 0 ? ' is-negative' : ''}">${ledger(tx.escrow)}</td>
                <td class="statement-table__num${tx.fees < 0 ? ' is-negative' : ''}">${ledger(tx.fees)}</td>
                <td class="statement-table__num statement-table__total${tx.total < 0 ? ' is-negative' : ''}">${ledger(tx.total)}</td>
                <td class="statement-table__num statement-table__balance">${money(tx.balance)}</td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </section>
  `);
}
