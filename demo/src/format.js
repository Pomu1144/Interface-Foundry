// Formatting and parsing helpers for money, dates and contact details.

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const plain = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function money(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return currency.format(value);
}

/** Signed money for ledgers: "-$2,808.00", "$0.00" shown as an em dash. */
export function ledger(value) {
  if (!value) return '—';
  return currency.format(value);
}

/** 1234567.891 -> "1,234,567.89" (no currency symbol, for input fields). */
export function amountForInput(value) {
  return plain.format(value);
}

/** "$1,234,567.89" | "1234567.89" | " 1 234 " -> 1234567.89; NaN when invalid. */
export function parseAmount(text) {
  const cleaned = String(text ?? '').replace(/[\s,$]/g, '');
  if (!cleaned) return NaN;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned) && !/^\.\d{1,2}$/.test(cleaned)) return NaN;
  return Math.round(Number(cleaned) * 100) / 100;
}

export function percent(value, digits = 3) {
  return `${value.toFixed(digits)}%`;
}

const dateLong = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const dateShort = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const dateNoYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const asDate = (iso) => new Date(`${iso}T00:00:00Z`);

export const formatDate = (iso) => dateLong.format(asDate(iso));
export const formatDateShort = (iso) => dateShort.format(asDate(iso));
export const formatDateNoYear = (iso) => dateNoYear.format(asDate(iso));
export const formatWeekday = (iso) => weekday.format(asDate(iso));

export function daysBetween(fromIso, toIso) {
  return Math.round((asDate(toIso) - asDate(fromIso)) / 86400000);
}

export function maskAccount(last4) {
  return `••••${last4}`;
}

export function digitsOnly(text) {
  return String(text ?? '').replace(/\D/g, '');
}

/** "5555550142" -> "(555) 555-0142"; partial input is returned unchanged. */
export function formatPhone(text) {
  let d = digitsOnly(text);
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return String(text ?? '').trim();
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function isValidPhone(text) {
  let d = digitsOnly(text);
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 && !/^[01]/.test(d);
}

/** "049991234" -> "04999-1234"; 5-digit ZIPs are returned as-is. */
export function formatZip(text) {
  const d = digitsOnly(text);
  if (d.length === 9) return `${d.slice(0, 5)}-${d.slice(5)}`;
  if (d.length === 5) return d;
  return String(text ?? '').trim();
}

export function isValidZip(text) {
  return /^\d{5}(-?\d{4})?$/.test(String(text ?? '').trim());
}

export function isValidEmail(text) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(text ?? '').trim());
}

export function initials(name) {
  return String(name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}
