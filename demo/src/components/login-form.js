// Sign-in form: inline validation, credential check with a loading state,
// password visibility toggle and "Remember this device".
import { html, toElement, qs, setContent } from '../dom.js';
import { icon } from '../icons.js';
import { verifyCredentials } from '../api.js';
import { state, safeStorage, REMEMBERED_USER_KEY } from '../store.js';

const MESSAGES = {
  username: 'Enter your username.',
  password: 'Enter your password.',
};

export function LoginForm({ onSuccess }) {
  const root = toElement(html`
    <form class="login-form" novalidate data-testid="login-form" data-ifdy-component="LoginForm" data-ifdy-source="demo/src/components/login-form.js:13">
      <div class="login-form__alert" data-slot="alert"></div>

      <div class="field">
        <label class="field__label" for="login-username">Username</label>
        <input
          class="input"
          id="login-username"
          name="username"
          type="text"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          required
          aria-required="true"
          data-testid="login-username"
        />
        <p class="field__error" id="login-username-error" data-testid="login-username-error" hidden>
          ${icon('alert')}<span></span>
        </p>
      </div>

      <div class="field">
        <label class="field__label" for="login-password">Password</label>
        <div class="input-group input-group--action">
          <input
            class="input"
            id="login-password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            aria-required="true"
            data-testid="login-password"
          />
          <button
            type="button"
            class="icon-btn input-group__action"
            aria-label="Show password"
            aria-pressed="false"
            aria-controls="login-password"
            data-testid="login-password-toggle"
          >
            ${icon('eye')}
          </button>
        </div>
        <p class="field__error" id="login-password-error" data-testid="login-password-error" hidden>
          ${icon('alert')}<span></span>
        </p>
      </div>

      <div class="field">
        <input
          class="input"
          id="login-loan-number"
          name="loanNumber"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          placeholder="Loan number (optional)"
          data-testid="login-loan-number"
        />
      </div>

      <div class="login-form__options">
        <span class="login-form__remember">
          <input type="checkbox" id="login-remember" name="remember" aria-labelledby="login-remember-label" data-testid="login-remember" />
          <span id="login-remember-label">Remember this device</span>
        </span>
        <a class="login-form__forgot" href="#/login" data-testid="forgot-password">Forgot password?</a>
      </div>

      <button type="submit" class="btn btn--primary btn--block" data-testid="login-submit">
        <span class="spinner" aria-hidden="true" hidden></span>
        <span data-label>Sign in</span>
      </button>
      <p class="visually-hidden" role="status" data-slot="status"></p>
    </form>
  `);

  const alertSlot = qs(root, '[data-slot="alert"]');
  const statusSlot = qs(root, '[data-slot="status"]');
  const fields = {
    username: qs(root, '#login-username'),
    password: qs(root, '#login-password'),
  };
  const remember = qs(root, '#login-remember');
  const toggle = qs(root, '[data-testid="login-password-toggle"]');
  const submit = qs(root, '[data-testid="login-submit"]');
  let attempted = false;
  let busy = false;

  // Restore the non-sensitive draft (or a remembered username). Never the password.
  const remembered = safeStorage.get(REMEMBERED_USER_KEY);
  fields.username.value = state.login.username || remembered || '';
  remember.checked = state.login.remember || Boolean(remembered);

  fields.username.addEventListener('input', () => {
    state.login.username = fields.username.value;
    if (attempted) validateField('username');
  });
  fields.password.addEventListener('input', () => {
    if (attempted) validateField('password');
  });
  remember.addEventListener('change', () => {
    state.login.remember = remember.checked;
  });

  toggle.addEventListener('click', () => {
    const show = toggle.getAttribute('aria-pressed') !== 'true';
    toggle.setAttribute('aria-pressed', String(show));
    fields.password.type = show ? 'text' : 'password';
    toggle.innerHTML = String(icon(show ? 'eyeOff' : 'eye'));
  });

  qs(root, '[data-testid="forgot-password"]').addEventListener('click', (event) => {
    event.preventDefault();
    showAlert(html`
      <div class="alert alert--info" role="status" data-testid="login-info">
        ${icon('info')}
        <div>
          <strong class="alert__title">Password reset isn't available in this demo</strong>
          <p>Use the synthetic demo credentials shown below the form.</p>
        </div>
      </div>
    `);
  });

  function setFieldError(name, message) {
    const input = fields[name];
    const error = qs(root, `#login-${name}-error`);
    if (message) {
      qs(error, 'span').textContent = message;
      error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', error.id);
    } else {
      error.hidden = true;
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
  }

  function validateField(name) {
    const valid = fields[name].value.trim() !== '';
    setFieldError(name, valid ? '' : MESSAGES[name]);
    return valid;
  }

  function showAlert(content) {
    setContent(alertSlot, content);
  }

  function setBusy(isBusy) {
    busy = isBusy;
    submit.disabled = isBusy;
    submit.setAttribute('aria-busy', String(isBusy));
    root.setAttribute('aria-busy', String(isBusy));
    qs(submit, '.spinner').hidden = !isBusy;
    qs(submit, '[data-label]').textContent = isBusy ? 'Signing in…' : 'Sign in';
    statusSlot.textContent = isBusy ? 'Signing in…' : '';
  }

  root.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    attempted = true;
    showAlert('');
    const invalid = ['username', 'password'].filter((name) => !validateField(name));
    if (invalid.length) {
      fields[invalid[0]].focus();
      return;
    }

    setBusy(true);
    const ok = await verifyCredentials(fields.username.value, fields.password.value);
    if (!root.isConnected) return;

    if (!ok) {
      setBusy(false);
      fields.password.value = '';
      showAlert(html`
        <div class="alert alert--danger" role="alert" data-testid="login-error">
          ${icon('alert')}
          <div>
            <strong class="alert__title">We couldn't verify those credentials.</strong>
            <p>Check your username and password, then try again.</p>
          </div>
        </div>
      `);
      fields.password.focus();
      return;
    }

    const username = fields.username.value.trim();
    if (remember.checked) safeStorage.set(REMEMBERED_USER_KEY, username);
    else safeStorage.remove(REMEMBERED_USER_KEY);
    fields.password.value = '';
    statusSlot.textContent = 'Signed in. Loading your account…';
    onSuccess({ username });
  });

  return root;
}
