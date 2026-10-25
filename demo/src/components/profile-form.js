// Account maintenance form: contact details and mailing address with
// formatting (phone, ZIP), per-field messages and an error summary.
import { html, toElement, qs, qsa, setContent } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import { updateProfile } from '../api.js';
import { formatPhone, formatZip, isValidEmail, isValidPhone, isValidZip } from '../format.js';
import { ErrorSummary } from './error-summary.js';

const FIELDS = {
  fullName: { id: 'profile-full-name', label: 'Full name', autocomplete: 'name' },
  email: {
    id: 'profile-email',
    label: 'Email address',
    type: 'email',
    autocomplete: 'email',
    hint: 'We send statements and security alerts here.',
  },
  phone: {
    id: 'profile-phone',
    label: 'Mobile phone',
    type: 'tel',
    autocomplete: 'tel-national',
    inputmode: 'tel',
    hint: '10-digit US number, like (555) 555-0142.',
  },
  address1: { id: 'profile-address1', label: 'Street address', autocomplete: 'address-line1' },
  address2: { id: 'profile-address2', label: 'Apartment, suite or unit', autocomplete: 'address-line2', optional: true },
  city: { id: 'profile-city', label: 'City', autocomplete: 'address-level2' },
  state: { id: 'profile-state', label: 'State', autocomplete: 'address-level1', select: true },
  zip: {
    id: 'profile-zip',
    label: 'ZIP code',
    autocomplete: 'postal-code',
    inputmode: 'numeric',
    hint: '5 or 9 digits, like 04999 or 04999-1234.',
  },
};

function validateValues(values) {
  const errors = [];
  const add = (name, message) => errors.push({ name, id: FIELDS[name].id, message });
  if (!values.fullName.trim()) add('fullName', 'Enter your full name');
  if (!values.email.trim()) add('email', 'Enter your email address');
  else if (!isValidEmail(values.email)) add('email', 'Enter an email address in the correct format, like name@example.com');
  if (!values.phone.trim()) add('phone', 'Enter your mobile phone number');
  else if (!isValidPhone(values.phone)) add('phone', 'Enter a 10-digit US phone number, like (555) 555-0142');
  if (!values.address1.trim()) add('address1', 'Enter your street address');
  if (!values.city.trim()) add('city', 'Enter your city');
  if (!values.state) add('state', 'Select your state');
  if (!values.zip.trim()) add('zip', 'Enter your ZIP code');
  else if (!isValidZip(values.zip)) add('zip', 'Enter a ZIP code with 5 or 9 digits, like 04999 or 04999-1234');
  return errors;
}

function fieldMarkup(name, states) {
  const f = FIELDS[name];
  const describedBy = f.hint ? `${f.id}-hint` : null;
  const control = f.select
    ? html`
        <select class="select" id="${f.id}" name="${name}" autocomplete="${f.autocomplete}" required data-testid="${f.id}">
          <option value="">Select a state</option>
          ${states.map(([code, label]) => html`<option value="${code}">${label}</option>`)}
        </select>
      `
    : html`
        <input
          class="input"
          id="${f.id}"
          name="${name}"
          type="${f.type ?? 'text'}"
          autocomplete="${f.autocomplete}"
          ${f.inputmode ? html`inputmode="${f.inputmode}"` : ''}
          ${f.optional ? '' : html`required`}
          ${describedBy ? html`aria-describedby="${describedBy}"` : ''}
          ${f.type === 'email' ? html`spellcheck="false" autocapitalize="none"` : ''}
          data-testid="${f.id}"
        />
      `;
  return html`
    <div class="field" data-field="${name}">
      <label class="field__label" for="${f.id}">
        ${f.label}${f.optional ? html` <span class="field__optional">(optional)</span>` : ''}
      </label>
      ${f.hint ? html`<p class="field__hint" id="${f.id}-hint">${f.hint}</p>` : ''}
      ${control}
      <p class="field__error" id="${f.id}-error" data-testid="${f.id}-error" hidden>${icon('alert')}<span></span></p>
    </div>
  `;
}

export function ProfileForm({ saved, states }) {
  const root = toElement(html`
    <form class="card profile-form" novalidate aria-labelledby="profile-form-title" data-testid="profile-form" data-ifdy-component="ProfileForm" data-ifdy-source="demo/src/components/profile-form.js:92">
      <div data-slot="summary"></div>
      <div data-slot="result"></div>

      <h2 class="card__title" id="profile-form-title">Contact details</h2>
      <p class="profile-form__intro">All fields are required unless marked optional.</p>

      <fieldset class="profile-form__group">
        <legend class="profile-form__legend">${icon('user')}<span>About you</span></legend>
        ${fieldMarkup('fullName', states)}
        ${fieldMarkup('email', states)}
        ${fieldMarkup('phone', states)}
      </fieldset>

      <fieldset class="profile-form__group">
        <legend class="profile-form__legend">${icon('mail')}<span>Mailing address</span></legend>
        ${fieldMarkup('address1', states)}
        ${fieldMarkup('address2', states)}
        <div class="profile-form__row">
          ${fieldMarkup('city', states)}
          ${fieldMarkup('state', states)}
        </div>
        ${fieldMarkup('zip', states)}
      </fieldset>

      <div class="btn-row profile-form__actions">
        <button type="submit" class="btn btn--primary" data-testid="profile-submit">
          <span class="spinner" aria-hidden="true" hidden></span>
          <span data-label>Save changes</span>
        </button>
        <button type="button" class="btn btn--ghost" data-testid="profile-undo">Undo changes</button>
      </div>
      <p class="visually-hidden" role="status" data-slot="status"></p>
    </form>
  `);

  const summarySlot = qs(root, '[data-slot="summary"]');
  const resultSlot = qs(root, '[data-slot="result"]');
  const statusSlot = qs(root, '[data-slot="status"]');
  const submit = qs(root, '[data-testid="profile-submit"]');
  const inputs = Object.fromEntries(Object.entries(FIELDS).map(([name, f]) => [name, qs(root, `#${f.id}`)]));
  let attempted = false;
  let busy = false;

  function fill(values) {
    for (const [name, input] of Object.entries(inputs)) input.value = values[name] ?? '';
  }

  function read() {
    return Object.fromEntries(Object.entries(inputs).map(([name, input]) => [name, input.value]));
  }

  function setFieldError(name, message) {
    const f = FIELDS[name];
    const input = inputs[name];
    const error = qs(root, `#${f.id}-error`);
    const ids = [f.hint ? `${f.id}-hint` : null];
    if (message) {
      qs(error, 'span').textContent = message;
      error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      ids.push(error.id);
    } else {
      error.hidden = true;
      input.removeAttribute('aria-invalid');
    }
    const describedBy = ids.filter(Boolean).join(' ');
    if (describedBy) input.setAttribute('aria-describedby', describedBy);
    else input.removeAttribute('aria-describedby');
  }

  function showErrors(errors) {
    for (const name of Object.keys(FIELDS)) setFieldError(name, errors.find((e) => e.name === name)?.message);
  }

  fill(state.profile.draft ?? saved);

  root.addEventListener('input', () => {
    state.profile.draft = read();
    if (attempted) showErrors(validateValues(read()));
  });
  root.addEventListener('change', () => {
    state.profile.draft = read();
  });
  inputs.phone.addEventListener('blur', () => {
    inputs.phone.value = formatPhone(inputs.phone.value);
    state.profile.draft = read();
  });
  inputs.zip.addEventListener('blur', () => {
    inputs.zip.value = formatZip(inputs.zip.value);
    state.profile.draft = read();
  });

  qs(root, '[data-testid="profile-undo"]').addEventListener('click', () => {
    attempted = false;
    state.profile.draft = null;
    fill(state.profile.result?.profile ?? saved);
    showErrors([]);
    setContent(summarySlot, '');
    statusSlot.textContent = 'Changes undone.';
  });

  root.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    attempted = true;
    inputs.phone.value = formatPhone(inputs.phone.value);
    inputs.zip.value = formatZip(inputs.zip.value);
    const values = read();
    const errors = validateValues(values);
    showErrors(errors);
    setContent(resultSlot, '');

    if (errors.length) {
      const summary = setContent(summarySlot, ErrorSummary({ errors, testid: 'profile-error-summary' }));
      summary.focus();
      return;
    }

    setContent(summarySlot, '');
    busy = true;
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    qs(submit, '.spinner').hidden = false;
    qs(submit, '[data-label]').textContent = 'Saving…';
    statusSlot.textContent = 'Saving your changes…';

    const result = await updateProfile(values);
    busy = false;
    state.profile.result = result;
    state.profile.draft = null;
    if (!root.isConnected) return;
    submit.disabled = false;
    submit.setAttribute('aria-busy', 'false');
    qs(submit, '.spinner').hidden = true;
    qs(submit, '[data-label]').textContent = 'Save changes';
    statusSlot.textContent = '';
    const success = setContent(
      resultSlot,
      html`
        <div class="alert alert--success profile-form__success" tabindex="-1" role="status" data-testid="profile-success">
          ${icon('checkCircle')}
          <div>
            <strong class="alert__title">${result.title}</strong>
            <p>${result.message}</p>
            <p>${result.effective}</p>
            <p class="profile-form__reference">Reference <strong data-testid="profile-reference">${result.reference}</strong></p>
          </div>
        </div>
      `,
    );
    success.focus();
  });

  for (const select of qsa(root, 'select')) select.addEventListener('change', () => attempted && showErrors(validateValues(read())));
  return root;
}
