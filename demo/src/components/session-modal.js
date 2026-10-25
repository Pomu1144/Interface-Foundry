// Session-expired dialog with a password-only re-authentication form. The
// password lives only in this dialog's input and is cleared when it closes.
import { html, toElement, qs } from '../dom.js';
import { icon } from '../icons.js';
import { verifyPassword } from '../api.js';
import { openDialog } from '../dialog.js';

export function SessionModal({ username, onResume, onSignOut }) {
  const root = toElement(html`
    <div class="modal session-modal" role="dialog" aria-modal="true" aria-labelledby="session-modal-title" aria-describedby="session-modal-desc" data-testid="session-modal" data-ifdy-component="SessionModal" data-ifdy-source="demo/src/components/session-modal.js:8">
      <div class="session-modal__icon">${icon('clock')}</div>
      <h2 class="modal__title" id="session-modal-title">Your session timed out</h2>
      <p class="session-modal__desc" id="session-modal-desc">
        For your security we paused your session after a period of inactivity. Enter your password to continue where
        you left off — your unsent drafts are still here.
      </p>

      <form class="session-modal__form" novalidate data-testid="session-reauth-form">
        <div class="field">
          <span class="field__label">Username</span>
          <p class="session-modal__user" data-testid="session-username">${icon('user')}<span>${username}</span></p>
        </div>
        <div class="field">
          <label class="field__label" for="session-password">Password</label>
          <input
            class="input"
            id="session-password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            data-testid="session-reauth-password"
          />
          <p class="field__error" id="session-password-error" data-testid="session-reauth-error" hidden>${icon('alert')}<span></span></p>
        </div>
        <div class="btn-row session-modal__actions">
          <button type="submit" class="btn btn--primary" data-testid="session-reauth-submit">
            <span class="spinner" aria-hidden="true" hidden></span>
            <span data-label>Continue session</span>
          </button>
          <button type="button" class="btn btn--secondary" data-testid="session-sign-out">Sign out</button>
        </div>
        <p class="visually-hidden" role="status" data-slot="status"></p>
      </form>
    </div>
  `);

  const form = qs(root, 'form');
  const password = qs(root, '#session-password');
  const error = qs(root, '#session-password-error');
  const submit = qs(root, '[data-testid="session-reauth-submit"]');
  const signOut = qs(root, '[data-testid="session-sign-out"]');
  const status = qs(root, '[data-slot="status"]');
  let busy = false;

  function setError(message) {
    if (message) {
      qs(error, 'span').textContent = message;
      error.hidden = false;
      password.setAttribute('aria-invalid', 'true');
      password.setAttribute('aria-describedby', error.id);
    } else {
      error.hidden = true;
      password.removeAttribute('aria-invalid');
      password.removeAttribute('aria-describedby');
    }
  }

  function setBusy(isBusy) {
    busy = isBusy;
    submit.disabled = isBusy;
    signOut.disabled = isBusy;
    submit.setAttribute('aria-busy', String(isBusy));
    qs(submit, '.spinner').hidden = !isBusy;
    qs(submit, '[data-label]').textContent = isBusy ? 'Checking…' : 'Continue session';
    status.textContent = isBusy ? 'Checking your password…' : '';
  }

  const handle = openDialog(root, { initialFocus: password, returnFocus: null });

  function close() {
    password.value = '';
    handle.close({ restoreFocus: false });
  }

  password.addEventListener('input', () => {
    if (!error.hidden && password.value) setError('');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!password.value) {
      setError('Enter your password.');
      password.focus();
      return;
    }
    setBusy(true);
    const ok = await verifyPassword(password.value);
    setBusy(false);
    if (!ok) {
      password.value = '';
      setError("That password didn't match. Try again.");
      password.focus();
      return;
    }
    close();
    onResume();
  });

  signOut.addEventListener('click', () => {
    if (busy) return;
    close();
    onSignOut();
  });

  return { element: root, close };
}
