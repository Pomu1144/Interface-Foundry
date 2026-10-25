// In-memory application state. Everything lives in this module so it survives
// hash-route changes and works when the preview sandbox blocks Web Storage.
// Storage is only used for the opt-in "Remember this device" username.

const listeners = new Set();

function initialPayment() {
  return {
    step: 'details',
    draft: { amount: '', date: '', sourceId: '' },
    idempotencyKey: null,
    pending: false,
    error: null,
    confirmation: null,
  };
}

export const state = {
  session: {
    status: 'signed-out', // 'signed-out' | 'active' | 'expired'
    username: null,
    displayName: null,
    startedAt: null,
    expiresAt: null,
    synthetic: false,
  },
  /** Route to return to after signing in (set when an anonymous visitor hits a protected route). */
  returnTo: null,
  login: { username: '', remember: false },
  payment: initialPayment(),
  /** Counts payment submissions the (simulated) service accepted. Never decreases. */
  paymentSubmissions: { attempts: 0, accepted: 0 },
  profile: { draft: null, result: null },
  preferences: { delivery: 'paperless', reminders: true, escrowAlerts: true, offers: false, savedAt: null },
};

export function update(mutator, reason = 'update') {
  mutator(state);
  for (const listener of listeners) {
    try {
      listener(state, reason);
    } catch (err) {
      console.error('[harborline] store listener failed', err);
    }
  }
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetPayment() {
  state.payment = initialPayment();
}

/** Clear everything tied to the signed-in borrower (used on sign-out). */
export function clearBorrowerState() {
  state.payment = initialPayment();
  state.profile = { draft: null, result: null };
  state.returnTo = null;
}

// Web Storage wrappers ------------------------------------------------------
// Sandboxed or partitioned iframes may throw on any access, so every call is
// guarded and failures fall back silently to in-memory behaviour.

function storageArea(kind) {
  try {
    const area = kind === 'session' ? window.sessionStorage : window.localStorage;
    const probe = '__harborline_probe__';
    area.setItem(probe, '1');
    area.removeItem(probe);
    return area;
  } catch {
    return null;
  }
}

export const safeStorage = {
  get(key, kind = 'local') {
    try {
      return storageArea(kind)?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key, value, kind = 'local') {
    try {
      storageArea(kind)?.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key, kind = 'local') {
    try {
      storageArea(kind)?.removeItem(key);
    } catch {
      /* storage unavailable: nothing to remove */
    }
  },
};

export const REMEMBERED_USER_KEY = 'harborline.rememberedUsername';
