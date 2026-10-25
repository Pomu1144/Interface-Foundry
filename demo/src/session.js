// Session lifecycle: start, expire (timeout or demo control), resume after
// re-authentication, and sign-out. Passwords are never stored anywhere.
import { state, update, clearBorrowerState } from './store.js';

let expiryTimer = null;
let expireHandler = () => {};

export function onSessionExpired(handler) {
  expireHandler = handler;
}

/** Seconds from ?sessionTimeout=<seconds>, or null when absent/invalid. */
export function sessionTimeoutSeconds() {
  try {
    const raw = new URLSearchParams(window.location.search).get('sessionTimeout');
    const seconds = Number(raw);
    return raw !== null && Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 86400) : null;
  } catch {
    return null;
  }
}

function schedule() {
  window.clearTimeout(expiryTimer);
  const seconds = sessionTimeoutSeconds();
  if (!seconds) {
    update((s) => {
      s.session.expiresAt = null;
    }, 'session');
    return;
  }
  const expiresAt = Date.now() + seconds * 1000;
  update((s) => {
    s.session.expiresAt = expiresAt;
  }, 'session');
  expiryTimer = window.setTimeout(() => expireSession('timeout'), seconds * 1000);
}

export function startSession({ username, displayName, synthetic = false }) {
  update((s) => {
    s.session.status = 'active';
    s.session.username = username;
    s.session.displayName = displayName;
    s.session.startedAt = Date.now();
    s.session.synthetic = synthetic;
  }, 'session');
  schedule();
}

/** Returns false when there is no active session to expire. */
export function expireSession(reason = 'manual') {
  if (state.session.status !== 'active') return false;
  window.clearTimeout(expiryTimer);
  update((s) => {
    s.session.status = 'expired';
    s.session.expiresAt = null;
  }, 'session');
  console.info('[harborline] session expired', { reason });
  expireHandler(reason);
  return true;
}

export function resumeSession() {
  update((s) => {
    s.session.status = 'active';
    s.session.startedAt = Date.now();
  }, 'session');
  schedule();
}

export function endSession() {
  window.clearTimeout(expiryTimer);
  update((s) => {
    s.session.status = 'signed-out';
    s.session.username = null;
    s.session.displayName = null;
    s.session.startedAt = null;
    s.session.expiresAt = null;
    s.session.synthetic = false;
    clearBorrowerState();
  }, 'session');
}
