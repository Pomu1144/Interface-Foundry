// Data access and simulated back-end services. Fixtures are real HTTP requests
// (fetch) so they appear in network tooling; services add realistic latency.
import { state } from './store.js';

const DATA_URL = new URL('../data/', import.meta.url);

export class HttpError extends Error {
  constructor(status, url) {
    super(`Request failed with HTTP ${status}: ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

const cache = new Map();

/** Fetch a JSON fixture from demo/data. Cached per page load unless cache: false. */
export function loadJSON(name, { cache: useCache = true } = {}) {
  if (useCache && cache.has(name)) return cache.get(name);
  const url = new URL(name, DATA_URL);
  const request = fetch(url, { headers: { Accept: 'application/json' } }).then((res) => {
    if (!res.ok) throw new HttpError(res.status, url.pathname);
    return res.json();
  });
  if (useCache) {
    cache.set(name, request);
    request.catch(() => cache.delete(name));
  }
  return request;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Synthetic credentials. Harborline is fictional; these unlock nothing real. */
export const DEMO_CREDENTIALS = Object.freeze({ username: 'demo.borrower', password: 'Harbor!2026' });

export async function verifyCredentials(username, password, { delay = 900 } = {}) {
  await wait(delay);
  return String(username).trim().toLowerCase() === DEMO_CREDENTIALS.username && password === DEMO_CREDENTIALS.password;
}

export async function verifyPassword(password, { delay = 700 } = {}) {
  await wait(delay);
  return password === DEMO_CREDENTIALS.password;
}

// Payments --------------------------------------------------------------------
// The first submission after page load times out (to exercise error recovery).
// Accepted submissions are keyed by an idempotency key, so a repeated request
// for the same review returns the original confirmation instead of a new one.

const acceptedByKey = new Map();

export function newIdempotencyKey() {
  const random = Math.random().toString(36).slice(2, 10);
  return `pay_${Date.now().toString(36)}_${random}`;
}

export async function submitPayment({ idempotencyKey, amount, date, source, breakdown }) {
  state.paymentSubmissions.attempts += 1;
  const attempt = state.paymentSubmissions.attempts;
  await wait(1100);
  if (attempt === 1) {
    const error = new Error('Payment service timed out');
    error.code = 'ETIMEDOUT';
    throw error;
  }
  if (acceptedByKey.has(idempotencyKey)) return { ...acceptedByKey.get(idempotencyKey), replayed: true };

  state.paymentSubmissions.accepted += 1;
  const count = state.paymentSubmissions.accepted;
  const confirmation = {
    number: `HL-20261025-${String(48210 + count).padStart(5, '0')}`,
    amount,
    date,
    source,
    breakdown,
    submittedAt: new Date().toISOString(),
    replayed: false,
  };
  acceptedByKey.set(idempotencyKey, confirmation);
  console.info('[harborline] payment submission accepted', {
    confirmation: confirmation.number,
    acceptedSubmissions: count,
    amount,
  });
  return confirmation;
}

// Profile ---------------------------------------------------------------------

export async function updateProfile(profile) {
  const fixture = await loadJSON('profile.json');
  await wait(800);
  return { ...fixture.updateResult, profile };
}
