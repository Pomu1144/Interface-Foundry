// Payment rules shared by the payment form, review and confirmation steps.
import { money, parseAmount, formatDateShort } from './format.js';

const round = (value) => Math.round(value * 100) / 100;

/**
 * Apply an amount using the standard waterfall: scheduled interest, escrow and
 * fees first, then scheduled principal; anything above the regular payment is
 * additional principal.
 */
export function computeBreakdown(amount, nextPayment) {
  if (!Number.isFinite(amount) || amount < nextPayment.amount) return null;
  const extra = round(amount - nextPayment.amount);
  return {
    principal: round(nextPayment.principal + extra),
    additionalPrincipal: extra,
    interest: nextPayment.interest,
    escrow: nextPayment.escrow,
    fees: nextPayment.fees,
    total: round(amount),
  };
}

export function validateAmount(text, account) {
  const value = parseAmount(text);
  if (String(text ?? '').trim() === '') return { value, error: 'Enter a payment amount.' };
  if (Number.isNaN(value)) return { value, error: 'Enter an amount in dollars and cents, like 11,394.42.' };
  if (value < account.nextPayment.amount) {
    return {
      value,
      error: `Enter at least your regular payment of ${money(account.nextPayment.amount)}. Partial payments can't be scheduled online.`,
    };
  }
  if (value > account.payment.estimatedPayoff) {
    return {
      value,
      error: `Enter ${money(account.payment.estimatedPayoff)} or less. To pay off your loan, request a payoff quote.`,
    };
  }
  return { value, error: null };
}

export function validateDate(iso, account) {
  const { earliestDate, latestDate } = account.payment;
  if (!iso) return 'Choose a payment date.';
  if (iso < earliestDate || iso > latestDate) {
    return `Choose a date between ${formatDateShort(earliestDate)} and ${formatDateShort(latestDate)}.`;
  }
  return null;
}
