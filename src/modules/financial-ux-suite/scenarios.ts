/**
 * Built-in financial UX scenarios for the Harborline synthetic demo.
 *
 * Selectors are the demo's data-testids (see demo/README.md). Credentials are
 * placeholders resolved from `settings.fixtures` at run time; deliberately
 * wrong passwords are obviously synthetic literals. These scenarios evaluate
 * UI and interaction behaviour only — never financial correctness or
 * transaction security.
 */
import type { Assertion, Locator, Posture, Scenario, StepAction, TestStep, WaitCondition } from '@shared/types';
import { cssLocator, describeAction, secretPlaceholder, testIdLocator } from '@/modules/interaction-recorder/steps';

export const SUITE_IDS = {
  login: 'Login',
  payment: 'Payment review',
  statement: 'Mortgage statement',
  profile: 'Account maintenance',
  session: 'Session recovery',
} as const;

export const FINANCIAL_SUITES: string[] = Object.values(SUITE_IDS);

export const BUILT_IN_PREFIX = 'fin.';

const USERNAME = secretPlaceholder('username');
const PASSWORD = secretPlaceholder('password');
/** Obviously synthetic, deliberately wrong. */
const WRONG_PASSWORD = 'Wrong!Pass-0000';

type Opts = { expect?: string; timeout?: number; description?: string };

/** Readable locators: test id first, accessible role + name as a fallback strategy. */
const L = {
  id: (testId: string, role?: string, name?: string): Locator => testIdLocator(testId, role && name ? { role, name } : {}),
  css: (css: string): Locator => cssLocator(css),
};

class Builder {
  steps: TestStep[] = [];
  constructor(private id: string) {}
  private push(action: StepAction, o: Opts = {}, defaultTimeout = 5000) {
    this.steps.push({
      id: `${this.id}.${this.steps.length + 1}`,
      action,
      timestamp: 0,
      timeout: o.timeout ?? defaultTimeout,
      description: o.description ?? describeAction(action),
      expect: o.expect,
    });
    return this;
  }
  click(l: Locator, o?: Opts) {
    return this.push({ type: 'click', locator: l }, o);
  }
  dblclick(l: Locator, o?: Opts) {
    return this.push({ type: 'click', locator: l, clickCount: 2 }, o);
  }
  fill(l: Locator, value: string, o?: Opts) {
    return this.push({ type: 'fill', locator: l, value, masked: value.includes('{{secret:') }, o);
  }
  press(key: string, l?: Locator, o?: Opts) {
    return this.push({ type: 'press', key, locator: l }, o);
  }
  focus(l: Locator, o?: Opts) {
    return this.push({ type: 'focus', locator: l }, o);
  }
  select(l: Locator, value: string, o?: Opts) {
    return this.push({ type: 'select', locator: l, value }, o);
  }
  check(l: Locator, checked: boolean, o?: Opts) {
    return this.push({ type: 'check', locator: l, checked }, o);
  }
  fold(posture: Posture, o?: Opts) {
    return this.push({ type: 'fold', posture }, o, 6000);
  }
  wait(condition: WaitCondition, o?: Opts) {
    const timeout = o?.timeout ?? (condition.kind === 'delay' ? condition.ms + 1000 : 5000);
    return this.push({ type: 'wait', condition, timeout }, { ...o, timeout });
  }
  waitVisible(l: Locator, o?: Opts) {
    return this.wait({ kind: 'visible', locator: l }, o);
  }
  waitHidden(l: Locator, o?: Opts) {
    return this.wait({ kind: 'hidden', locator: l }, o);
  }
  waitUrl(includes: string, o?: Opts) {
    return this.wait({ kind: 'url', includes }, o);
  }
  waitText(text: string, o?: Opts) {
    return this.wait({ kind: 'text', text }, o);
  }
  delay(ms: number, o?: Opts) {
    return this.wait({ kind: 'delay', ms }, o);
  }
  assert(assertion: Assertion, o?: Opts) {
    return this.push({ type: 'assert', assertion }, o, 2000);
  }
  visible(l: Locator, o?: Opts) {
    return this.assert({ kind: 'visible', locator: l }, o);
  }
  hidden(l: Locator, o?: Opts) {
    return this.assert({ kind: 'hidden', locator: l }, o);
  }
  text(l: Locator | undefined, text: string, o?: Opts) {
    return this.assert({ kind: 'text', locator: l, text }, o);
  }
  value(l: Locator, value: string, o?: Opts) {
    return this.assert({ kind: 'value', locator: l, value }, o);
  }
  focused(l: Locator, o?: Opts) {
    return this.assert({ kind: 'focused', locator: l }, o);
  }
  inViewport(l: Locator, o?: Opts) {
    return this.assert({ kind: 'in-viewport', locator: l }, o);
  }
  noOverflow(o?: Opts) {
    return this.assert({ kind: 'no-horizontal-overflow' }, o);
  }
  count(css: string, count: number, o?: Opts) {
    return this.assert({ kind: 'count', locator: L.css(css), count }, o);
  }
  enabled(l: Locator, enabled: boolean, o?: Opts) {
    return this.assert({ kind: 'enabled', locator: l, enabled }, o);
  }
  screenshot(label: string) {
    return this.push({ type: 'screenshot', label }, {}, 20000);
  }
}

function scenario(id: string, suite: string, name: string, route: string, description: string, tags: string[], build: (b: Builder) => void): Scenario {
  const b = new Builder(id);
  build(b);
  return { id, name, description, suite, route, steps: b.steps, createdAt: 0, builtIn: true, tags: ['built-in', 'financial-ux', ...tags] };
}

/* ------------------------------------------------------------------ */
/* Shared locators                                                     */
/* ------------------------------------------------------------------ */

const login = {
  form: L.id('login-form'),
  username: L.id('login-username', 'textbox', 'Username'),
  usernameError: L.id('login-username-error'),
  password: L.id('login-password'),
  passwordError: L.id('login-password-error'),
  toggle: L.id('login-password-toggle', 'button', 'Show password'),
  loan: L.id('login-loan-number'),
  remember: L.id('login-remember'),
  forgot: L.id('forgot-password', 'link', 'Forgot password?'),
  submit: L.id('login-submit'),
  error: L.id('login-error'),
};
const pay = {
  form: L.id('payment-form'),
  amount: L.id('payment-amount', 'textbox', 'Payment amount'),
  amountError: L.id('payment-amount-error'),
  presetRegular: L.id('payment-preset-regular'),
  presetExtra: L.id('payment-preset-extra'),
  breakdown: L.id('payment-breakdown'),
  principal: L.id('breakdown-principal'),
  interest: L.id('breakdown-interest'),
  escrow: L.id('breakdown-escrow'),
  fees: L.id('breakdown-fees'),
  total: L.id('breakdown-total'),
  continue: L.id('payment-continue'),
  review: L.id('payment-review'),
  reviewAmount: L.id('review-amount'),
  reviewSource: L.id('review-source'),
  submit: L.id('payment-submit'),
  error: L.id('payment-error'),
  retry: L.id('payment-retry'),
  confirmation: L.id('payment-confirmation'),
  confirmationNumber: L.id('confirmation-number'),
  confirmationAmount: L.id('confirmation-amount'),
  savings: L.id('payment-source-sav-7710'),
};
const session = {
  toggleControls: L.id('demo-controls-toggle'),
  simulate: L.id('simulate-session-timeout', 'button', 'Simulate session timeout'),
  modal: L.id('session-modal'),
  username: L.id('session-username'),
  password: L.id('session-reauth-password', 'textbox', 'Password'),
  error: L.id('session-reauth-error'),
  submit: L.id('session-reauth-submit', 'button', 'Continue session'),
  signOut: L.id('session-sign-out', 'button', 'Sign out'),
  paused: L.id('session-paused'),
  expired: L.id('session-expired'),
};
const st = {
  table: L.id('statement-table'),
  activity: L.id('statement-activity'),
  download: L.id('download-statement', 'button', 'Download statement (PDF)'),
  makePayment: L.id('statement-make-payment'),
  amountDue: L.id('amount-due-total'),
};
const profile = {
  form: L.id('profile-form'),
  fullName: L.id('profile-full-name', 'textbox', 'Full name'),
  email: L.id('profile-email', 'textbox', 'Email address'),
  phone: L.id('profile-phone', 'textbox', 'Mobile phone'),
  city: L.id('profile-city', 'textbox', 'City'),
  state: L.id('profile-state'),
  zip: L.id('profile-zip', 'textbox', 'ZIP code'),
  submit: L.id('profile-submit', 'button', 'Save changes'),
  summary: L.id('profile-error-summary'),
  summaryLink: L.id('profile-error-summary-link'),
  success: L.id('profile-success'),
  reference: L.id('profile-reference'),
};

const signIn = (b: Builder) =>
  b
    .fill(login.username, USERNAME, { description: 'Type the synthetic username (fixture “username”)' })
    .fill(login.password, PASSWORD, { description: 'Type the synthetic password (fixture “password”)' })
    .click(login.submit, { description: 'Click “Sign in”' })
    .waitUrl('#/dashboard', { timeout: 6000, expect: 'Valid credentials open the account overview' })
    .waitVisible(L.id('account-summary'), { timeout: 6000 });

const expireSession = (b: Builder) =>
  b
    .click(session.toggleControls, { description: 'Open “Demo controls” in the footer' })
    .click(session.simulate, { description: 'Click “Simulate session timeout”' })
    .waitVisible(session.modal, { timeout: 4000, expect: 'The session-expired dialog opens' });

const reauthenticate = (b: Builder) =>
  b
    .fill(session.password, PASSWORD, { description: 'Type the synthetic password (fixture “password”) in the dialog' })
    .click(session.submit, { description: 'Click “Continue session”' })
    .waitHidden(session.modal, { timeout: 5000, expect: 'The dialog closes after re-authentication' });

/* ------------------------------------------------------------------ */
/* Login                                                               */
/* ------------------------------------------------------------------ */

const LOGIN: Scenario[] = [
  scenario('fin.login.empty-form', SUITE_IDS.login, 'Empty form', '#/login', 'Submitting without credentials shows linked inline errors and focuses the first invalid field.', ['validation'], (b) =>
    b
      .visible(login.form)
      .click(login.submit, { description: 'Click “Sign in” with both fields empty' })
      .visible(login.usernameError, { expect: 'Username error is shown' })
      .text(login.usernameError, 'Enter your username.')
      .visible(login.passwordError, { expect: 'Password error is shown' })
      .text(login.passwordError, 'Enter your password.')
      .focused(login.username, { expect: 'Focus moves to the first invalid field' })
      .visible(L.css('#login-username[aria-invalid="true"][aria-describedby="login-username-error"]'), { description: 'Assert username is aria-invalid and linked to its error', expect: 'The error is programmatically associated with the field' })
      .waitUrl('#/login', { timeout: 1000, expect: 'No navigation happens' }),
  ),
  scenario('fin.login.invalid-credentials', SUITE_IDS.login, 'Invalid credentials', '#/login', 'Wrong credentials show an alert, clear only the password and keep the username.', ['errors'], (b) =>
    b
      .fill(login.username, USERNAME, { description: 'Type the synthetic username (fixture “username”)' })
      .fill(login.password, WRONG_PASSWORD, { description: 'Type a deliberately wrong synthetic password' })
      .click(login.submit, { description: 'Click “Sign in”' })
      .waitVisible(login.error, { timeout: 5000, expect: 'A credential error alert appears' })
      .text(login.error, "We couldn't verify those credentials.")
      .visible(L.css('[data-testid="login-error"][role="alert"]'), { description: 'Assert the error is announced (role="alert")' })
      .value(login.password, '', { expect: 'The password field is cleared' })
      .focused(login.password, { expect: 'Focus returns to the password field' })
      .value(login.username, USERNAME, { expect: 'The username is kept' })
      .enabled(login.submit, true, { expect: 'Sign in is available again' }),
  ),
  scenario('fin.login.loading-state', SUITE_IDS.login, 'Loading state', '#/login', 'While credentials are verified the button is busy, disabled and labelled “Signing in…”.', ['loading'], (b) =>
    b
      .fill(login.username, USERNAME, { description: 'Type the synthetic username (fixture “username”)' })
      .fill(login.password, PASSWORD, { description: 'Type the synthetic password (fixture “password”)' })
      .click(login.submit, { description: 'Click “Sign in”' })
      .enabled(login.submit, false, { expect: 'The button is disabled while signing in', timeout: 800 })
      .text(login.submit, 'Signing in…', { timeout: 800 })
      .visible(L.css('[data-testid="login-submit"][aria-busy="true"]'), { description: 'Assert the button reports aria-busy="true"', timeout: 800 })
      .waitUrl('#/dashboard', { timeout: 6000, expect: 'The overview opens when verification finishes' })
      .visible(L.id('account-summary')),
  ),
  scenario('fin.login.password-toggle', SUITE_IDS.login, 'Password visibility toggle', '#/login', 'The eye button reveals and hides the password without losing the typed value.', ['a11y'], (b) =>
    b
      .fill(login.password, PASSWORD, { description: 'Type the synthetic password (fixture “password”)' })
      .visible(L.css('input#login-password[type="password"]'), { description: 'Assert the password is masked by default' })
      .click(login.toggle, { description: 'Click “Show password”' })
      .visible(L.css('input#login-password[type="text"]'), { description: 'Assert the password is shown as text' })
      .visible(L.css('[data-testid="login-password-toggle"][aria-pressed="true"]'), { description: 'Assert the toggle reports aria-pressed="true"' })
      .value(login.password, PASSWORD, { expect: 'The typed value is preserved' })
      .click(login.toggle, { description: 'Click the toggle again' })
      .visible(L.css('input#login-password[type="password"]'), { description: 'Assert the password is masked again' })
      .visible(L.css('[data-testid="login-password-toggle"][aria-pressed="false"]'), { description: 'Assert the toggle reports aria-pressed="false"' }),
  ),
  scenario('fin.login.keyboard', SUITE_IDS.login, 'Keyboard navigation', '#/login', 'Tab order follows the visual order and Enter submits the form.', ['keyboard', 'a11y'], (b) =>
    b
      .focus(login.username)
      .press('Tab')
      .focused(login.password)
      .press('Tab')
      .focused(login.toggle, { expect: 'The show-password button is reachable' })
      .press('Tab')
      .focused(login.loan)
      .press('Tab')
      .focused(login.remember)
      .press('Tab')
      .focused(login.forgot)
      .press('Tab')
      .focused(login.submit)
      .press('Shift+Tab')
      .focused(login.forgot, { expect: 'Shift+Tab moves backwards' })
      .fill(login.username, USERNAME, { description: 'Type the synthetic username (fixture “username”)' })
      .fill(login.password, PASSWORD, { description: 'Type the synthetic password (fixture “password”)' })
      .press('Enter', login.password, { description: 'Press Enter in the password field' })
      .waitUrl('#/dashboard', { timeout: 6000, expect: 'Enter submits the form' }),
  ),
  scenario('fin.login.validation', SUITE_IDS.login, 'Validation messages', '#/login', 'Errors appear on submit, clear as fields become valid and return when a field is emptied.', ['validation'], (b) =>
    b
      .click(login.submit, { description: 'Click “Sign in” with both fields empty' })
      .visible(login.usernameError)
      .visible(login.passwordError)
      .fill(login.username, USERNAME, { description: 'Type the synthetic username (fixture “username”)' })
      .hidden(login.usernameError, { expect: 'The username error clears as soon as the field is valid' })
      .visible(L.css('#login-username:not([aria-invalid])'), { description: 'Assert the username is no longer aria-invalid' })
      .visible(login.passwordError, { expect: 'Other errors stay until fixed' })
      .fill(login.password, PASSWORD, { description: 'Type the synthetic password (fixture “password”)' })
      .hidden(login.passwordError)
      .fill(login.username, '', { description: 'Clear the username' })
      .visible(login.usernameError, { expect: 'Emptying the field shows the error again' })
      .text(login.usernameError, 'Enter your username.'),
  ),
  scenario('fin.login.session-expiration', SUITE_IDS.login, 'Session expiration', '#/login', 'After sign-in, an expired session locks the account behind a modal that Escape cannot dismiss.', ['session'], (b) => {
    signIn(b);
    expireSession(b)
      .text(session.modal, 'Your session timed out')
      .text(session.username, USERNAME, { expect: 'The dialog names the signed-in user' })
      .visible(session.paused, { expect: 'Account details are replaced by a placeholder' })
      .hidden(L.id('account-summary'), { expect: 'Account content is removed from the page' })
      .focused(session.password, { expect: 'Focus starts in the password field' })
      .press('Escape')
      .visible(session.modal, { expect: 'Escape does not dismiss the dialog' });
  }),
  scenario(
    'fin.login.resize-during-input',
    SUITE_IDS.login,
    'Responsive resizing during interaction',
    '#/login',
    'Type the username, unfold the device, and check the value and focus survive and the form was not duplicated or resubmitted. Posture steps are skipped on single-posture devices.',
    ['foldable', 'responsive'],
    (b) =>
      b
        .fold('folded', { description: 'Start folded' })
        .focus(login.username)
        .fill(login.username, USERNAME, { description: 'Type the synthetic username (fixture “username”)' })
        .focused(login.username)
        .fold('expanded', { expect: 'The page reflows without re-rendering the form' })
        .value(login.username, USERNAME, { expect: 'The typed username survives the unfold' })
        .focused(login.username, { expect: 'Focus survives the unfold' })
        .count('form[data-testid="login-form"]', 1, { description: 'Assert exactly one sign-in form', expect: 'The form was not duplicated' })
        .count('[data-testid="login-username"]', 1, { description: 'Assert exactly one username field' })
        .hidden(login.error, { expect: 'The form was not resubmitted' })
        .hidden(login.usernameError)
        .enabled(login.submit, true, { expect: 'No submission is in progress' })
        .waitUrl('#/login', { timeout: 1000, expect: 'Still on the sign-in page' })
        .screenshot('Unfolded mid-input')
        .fold('folded', { description: 'Fold back' })
        .value(login.username, USERNAME, { expect: 'The value survives folding back' })
        .focused(login.username),
  ),
];

/* ------------------------------------------------------------------ */
/* Payment review                                                      */
/* ------------------------------------------------------------------ */

const toReview = (b: Builder) =>
  b
    .waitVisible(pay.amount, { timeout: 8000 })
    .click(pay.presetRegular, { description: 'Choose “Regular payment”' })
    .click(pay.continue, { description: 'Click “Review payment”' })
    .waitVisible(pay.review, { timeout: 4000 });

const PAYMENT: Scenario[] = [
  scenario('fin.payment.long-amounts', SUITE_IDS.payment, 'Long amounts', '#/payment', 'Seven-figure amounts are validated, formatted on blur and stay inside the viewport through review.', ['formatting', 'responsive'], (b) =>
    b
      .waitVisible(pay.amount, { timeout: 8000 })
      .fill(pay.amount, '9999999.99', { description: 'Type an amount above the payoff estimate' })
      .click(pay.continue, { description: 'Click “Review payment”' })
      .visible(pay.amountError, { expect: 'An out-of-range message appears' })
      .text(pay.amountError, 'Enter $1,505,157.76 or less')
      .focused(pay.amount, { expect: 'Focus returns to the amount' })
      .fill(pay.amount, '1234567.89', { description: 'Type a seven-figure amount' })
      .press('Tab', undefined, { description: 'Press Tab to leave the field' })
      .value(pay.amount, '1,234,567.89', { expect: 'The amount is formatted with separators on blur' })
      .text(pay.total, '$1,234,567.89')
      .text(pay.principal, '$1,225,208.96', { expect: 'Everything above the regular payment goes to principal' })
      .inViewport(pay.total, { expect: 'The long total is not clipped' })
      .noOverflow()
      .click(pay.continue, { description: 'Click “Review payment”' })
      .waitVisible(pay.review, { timeout: 4000 })
      .text(pay.reviewAmount, '$1,234,567.89')
      .inViewport(pay.reviewAmount, { expect: 'The reviewed amount fits on screen' })
      .noOverflow()
      .screenshot('Review with a seven-figure amount'),
  ),
  scenario('fin.payment.breakdown', SUITE_IDS.payment, 'Principal, interest, escrow and fee breakdown', '#/payment', 'The live breakdown applies interest, escrow and fees first and puts any extra toward principal.', ['breakdown'], (b) =>
    b
      .waitVisible(pay.breakdown, { timeout: 8000 })
      .click(pay.presetRegular, { description: 'Choose “Regular payment”' })
      .text(pay.principal, '$2,035.49')
      .text(pay.interest, '$7,946.43')
      .text(pay.escrow, '$1,412.50')
      .text(pay.fees, '$0.00')
      .text(pay.total, '$11,394.42')
      .click(pay.presetExtra, { description: 'Choose “+ $1,000 to principal”' })
      .text(pay.principal, '$3,035.49', { expect: 'The extra $1,000 is applied to principal' })
      .text(pay.interest, '$7,946.43', { expect: 'Interest is unchanged' })
      .text(pay.total, '$12,394.42')
      .text(pay.breakdown, 'Includes $1,000.00 of additional principal')
      .fill(pay.amount, '500', { description: 'Type a partial payment' })
      .text(pay.breakdown, 'Enter at least $11,394.42 to see how your payment is applied.', { expect: 'Partial payments explain the minimum instead of a breakdown' }),
  ),
  scenario('fin.payment.confirmation', SUITE_IDS.payment, 'Confirmation summary', '#/payment', 'Review summarises amount and source; the confirmation shows a number, the amount and takes focus.', ['confirmation'], (b) =>
    toReview(b)
      .text(pay.reviewAmount, '$11,394.42')
      .text(pay.reviewSource, 'Harbor Checking')
      .text(pay.review, 'authorize Harborline Home Loans to debit $11,394.42', { expect: 'The authorisation text repeats the amount' })
      .click(pay.submit, { description: 'Click “Submit payment”' })
      .waitVisible(pay.error, { timeout: 6000, description: 'Wait for the first attempt to fail (by design in the demo)' })
      .click(pay.retry, { description: 'Click “Retry payment”' })
      .waitVisible(pay.confirmation, { timeout: 6000 })
      .text(pay.confirmationNumber, 'HL-20261025-', { expect: 'A confirmation number is shown' })
      .text(pay.confirmationAmount, '$11,394.42')
      .focused(L.css('#payment-confirmation-title'), { description: 'Assert focus moves to the confirmation heading' })
      .visible(L.css('[data-testid="payment-stepper"] [data-step="confirmation"][aria-current="step"]'), { description: 'Assert the stepper marks Confirmation as current' })
      .screenshot('Confirmation'),
  ),
  scenario('fin.payment.error-recovery', SUITE_IDS.payment, 'Error recovery', '#/payment', 'The first submission times out (by design); the user is told they were not charged and Retry succeeds.', ['errors'], (b) =>
    toReview(b)
      .click(pay.submit, { description: 'Click “Submit payment”' })
      .enabled(pay.submit, false, { expect: 'Submit is disabled while the request is pending', timeout: 800 })
      .waitVisible(pay.error, { timeout: 6000 })
      .text(pay.error, 'Payment service timed out')
      .text(pay.error, 'you have not been charged', { expect: 'The error says it is safe to retry' })
      .focused(pay.retry, { expect: 'Focus moves to “Retry payment”' })
      .hidden(pay.confirmation)
      .click(pay.retry, { description: 'Click “Retry payment”' })
      .waitVisible(pay.confirmation, { timeout: 6000, expect: 'The retry succeeds' })
      .visible(pay.confirmationNumber),
  ),
  scenario('fin.payment.duplicate-submission', SUITE_IDS.payment, 'Duplicate-submission prevention', '#/payment', 'Double-clicking Submit and Retry yields exactly one confirmation.', ['idempotency'], (b) =>
    toReview(b)
      .dblclick(pay.submit, { description: 'Double-click “Submit payment”' })
      .waitVisible(pay.error, { timeout: 6000, description: 'Wait for the (single) first attempt to fail' })
      .dblclick(pay.retry, { description: 'Double-click “Retry payment”' })
      .waitVisible(pay.confirmation, { timeout: 6000 })
      .count('[data-testid="payment-confirmation"]', 1, { description: 'Assert exactly one confirmation', expect: 'One confirmation per payment' })
      .count('[data-testid="confirmation-number"]', 1)
      .text(pay.confirmationNumber, 'HL-20261025-48211', { expect: 'The first and only accepted submission of this page load' })
      .delay(1500, { description: 'Wait 1.5 s for any duplicate request to land' })
      .count('[data-testid="payment-confirmation"]', 1, { description: 'Assert there is still exactly one confirmation' })
      .text(pay.confirmationNumber, 'HL-20261025-48211'),
  ),
];

/* ------------------------------------------------------------------ */
/* Mortgage statement                                                  */
/* ------------------------------------------------------------------ */

const STATEMENT: Scenario[] = [
  scenario('fin.statement.dense-table', SUITE_IDS.statement, 'Dense table', '#/statement', 'All 41 transactions render in an 8-column table that fits its viewport or scrolls inside its card.', ['table', 'responsive'], (b) =>
    b
      .waitVisible(st.table, { timeout: 8000 })
      .count('[data-testid="statement-row"]', 41, { description: 'Assert 41 transaction rows' })
      .count('[data-testid="statement-table"] thead th', 8, { description: 'Assert 8 columns' })
      .text(st.activity, '41 transactions, newest first')
      .inViewport(st.table, { expect: 'The table does not spill past the viewport' })
      .screenshot('Transaction table'),
  ),
  scenario('fin.statement.long-descriptions', SUITE_IDS.statement, 'Long descriptions', '#/statement', 'Long transaction descriptions are shown in full and wrap inside the viewport.', ['table'], (b) =>
    b
      .waitVisible(st.table, { timeout: 8000 })
      .text(st.table, 'second-half real property tax installment, parcel 12-0457-889-0021', { expect: 'The full description is present (not truncated)' })
      .text(st.table, 'applied to principal only, per borrower instructions received by secure message')
      .inViewport(L.css('[data-testid="statement-table"] tbody tr:nth-child(6) .statement-table__desc'), { description: 'Assert a 145-character description cell fits the viewport' })
      .screenshot('Long descriptions'),
  ),
  scenario('fin.statement.expanded-readability', SUITE_IDS.statement, 'Expanded-screen readability', '#/statement', 'On the expanded screen the primary action is available and the table fits without sideways scrolling.', ['foldable', 'responsive'], (b) =>
    b
      .fold('expanded', { description: 'Unfold the device (skipped on single-posture devices)' })
      .waitVisible(st.table, { timeout: 8000 })
      .visible(st.download, { expect: 'The primary action is visible' })
      .inViewport(st.table)
      .noOverflow()
      .inViewport(st.amountDue)
      .screenshot('Statement, expanded'),
  ),
  scenario('fin.statement.small-screen-overflow', SUITE_IDS.statement, 'Small-screen overflow', '#/statement', 'On narrow screens nothing scrolls sideways and the download action stays available.', ['responsive'], (b) =>
    b
      .waitVisible(st.table, { timeout: 8000 })
      .noOverflow({ expect: 'No sideways page scrolling' })
      .inViewport(st.table)
      .visible(st.download, { expect: 'Download is available on small screens too' })
      .inViewport(st.makePayment)
      .screenshot('Statement, small screen'),
  ),
];

/* ------------------------------------------------------------------ */
/* Account maintenance                                                 */
/* ------------------------------------------------------------------ */

const PROFILE: Scenario[] = [
  scenario('fin.profile.required-fields', SUITE_IDS.profile, 'Required fields', '#/profile', 'Empty required fields produce a counted summary and inline messages; the optional field never errors.', ['validation'], (b) =>
    b
      .waitVisible(profile.fullName, { timeout: 8000 })
      .fill(profile.fullName, '', { description: 'Clear “Full name”' })
      .fill(profile.email, '', { description: 'Clear “Email address”' })
      .click(profile.submit, { description: 'Click “Save changes”' })
      .waitVisible(profile.summary, { timeout: 3000 })
      .text(profile.summary, 'There are problems with 2 fields')
      .text(L.id('profile-full-name-error'), 'Enter your full name')
      .text(L.id('profile-email-error'), 'Enter your email address')
      .count('[data-testid="profile-error-summary-link"]', 2, { description: 'Assert the summary links both fields' })
      .hidden(L.id('profile-address2-error'), { expect: 'The optional field has no error' })
      .visible(L.css('#profile-full-name[aria-invalid="true"]'), { description: 'Assert “Full name” is aria-invalid' }),
  ),
  scenario('fin.profile.input-formatting', SUITE_IDS.profile, 'Input formatting', '#/profile', 'Phone numbers and ZIP codes are normalised when the field loses focus.', ['formatting'], (b) =>
    b
      .waitVisible(profile.phone, { timeout: 8000 })
      .fill(profile.phone, '5555550199')
      .press('Tab', undefined, { description: 'Press Tab to leave the field' })
      .value(profile.phone, '(555) 555-0199')
      .fill(profile.zip, '049991234')
      .press('Tab', undefined, { description: 'Press Tab to leave the field' })
      .value(profile.zip, '04999-1234')
      .fill(profile.zip, '04999')
      .press('Tab', undefined, { description: 'Press Tab to leave the field' })
      .value(profile.zip, '04999', { expect: 'Five-digit ZIP codes are kept as typed' }),
  ),
  scenario('fin.profile.error-messages', SUITE_IDS.profile, 'Error messages', '#/profile', 'Invalid email, phone and ZIP values get specific, example-led messages linked to their fields.', ['validation', 'a11y'], (b) =>
    b
      .waitVisible(profile.email, { timeout: 8000 })
      .fill(profile.email, 'jordan.mercer@')
      .fill(profile.phone, '123')
      .fill(profile.zip, '12')
      .click(profile.submit, { description: 'Click “Save changes”' })
      .waitVisible(profile.summary, { timeout: 3000 })
      .text(profile.summary, 'There are problems with 3 fields')
      .text(L.id('profile-email-error'), 'Enter an email address in the correct format, like name@example.com')
      .text(L.id('profile-phone-error'), 'Enter a 10-digit US phone number, like (555) 555-0142')
      .text(L.id('profile-zip-error'), 'Enter a ZIP code with 5 or 9 digits, like 04999 or 04999-1234')
      .visible(L.css('#profile-email[aria-describedby~="profile-email-error"]'), { description: 'Assert the email message is linked with aria-describedby' }),
  ),
  scenario('fin.profile.focus-management', SUITE_IDS.profile, 'Focus management', '#/profile', 'The error summary takes focus, its links focus their fields without changing the route, and success takes focus.', ['a11y', 'keyboard'], (b) =>
    b
      .waitVisible(profile.email, { timeout: 8000 })
      .fill(profile.email, '', { description: 'Clear “Email address”' })
      .click(profile.submit, { description: 'Click “Save changes”' })
      .waitVisible(profile.summary, { timeout: 3000 })
      .focused(profile.summary, { expect: 'Focus moves to the error summary' })
      .click(profile.summaryLink, { description: 'Click the first link in the error summary' })
      .focused(profile.email, { expect: 'The link moves focus to its field' })
      .waitUrl('#/profile', { timeout: 1000, expect: 'The hash route is unchanged' })
      .fill(profile.email, 'jordan.mercer@example.com')
      .click(profile.submit, { description: 'Click “Save changes”' })
      .waitVisible(profile.success, { timeout: 5000 })
      .focused(profile.success, { expect: 'Focus moves to the success message' }),
  ),
  scenario('fin.profile.success', SUITE_IDS.profile, 'Successful completion', '#/profile', 'A valid update shows a busy state, then a focused success message with a reference number.', ['confirmation'], (b) =>
    b
      .waitVisible(profile.fullName, { timeout: 8000 })
      .fill(profile.phone, '(555) 555-0187')
      .fill(profile.city, 'South Portland')
      .select(profile.state, 'ME')
      .fill(profile.zip, '04106')
      .click(profile.submit, { description: 'Click “Save changes”' })
      .text(profile.submit, 'Saving…', { expect: 'The button shows a busy label', timeout: 700 })
      .enabled(profile.submit, false, { timeout: 700 })
      .waitVisible(profile.success, { timeout: 5000 })
      .text(profile.reference, 'CHG-20261025-0417')
      .text(profile.success, 'Your contact details were updated')
      .focused(profile.success)
      .hidden(profile.summary)
      .screenshot('Profile saved'),
  ),
];

/* ------------------------------------------------------------------ */
/* Session recovery                                                    */
/* ------------------------------------------------------------------ */

const SESSION: Scenario[] = [
  scenario('fin.session.expired-messaging', SUITE_IDS.session, 'Expired session messaging', '#/payment', 'The expiry dialog explains what happened, traps focus, hides account content and ignores Escape.', ['session', 'a11y'], (b) =>
    expireSession(b.waitVisible(pay.form, { timeout: 8000 }))
      .text(session.modal, 'Your session timed out')
      .text(session.modal, 'Enter your password to continue where you left off')
      .visible(L.css('[data-testid="session-modal"][role="dialog"][aria-modal="true"]'), { description: 'Assert it is announced as a modal dialog' })
      .focused(session.password, { expect: 'Focus starts in the password field' })
      .visible(session.paused)
      .hidden(pay.form, { expect: 'Account content is removed while the session is paused' })
      .press('Escape')
      .visible(session.modal, { expect: 'Escape does not dismiss the dialog' })
      .press('Tab')
      .press('Tab')
      .press('Tab')
      .focused(session.password, { expect: 'Tab wraps around inside the dialog (focus trap)' })
      .screenshot('Session dialog'),
  ),
  scenario('fin.session.return-to-task', SUITE_IDS.session, 'Return to task', '#/payment', 'After re-authentication the borrower is back on the payment step with their draft amount.', ['session'], (b) =>
    reauthenticate(
      expireSession(
        b
          .waitVisible(pay.amount, { timeout: 8000 })
          .fill(pay.amount, '12500', { description: 'Type a draft amount' })
          .press('Tab', undefined, { description: 'Press Tab to leave the field' })
          .value(pay.amount, '12,500.00'),
      ),
    )
      .waitVisible(pay.form, { timeout: 5000 })
      .waitUrl('#/payment', { timeout: 1000, expect: 'Still on the payment route' })
      .value(pay.amount, '12,500.00', { expect: 'The draft amount is restored' })
      .hidden(session.paused),
  ),
  scenario('fin.session.safe-reauth', SUITE_IDS.session, 'Safe re-authentication', '#/payment', 'Empty and wrong passwords are rejected with clear messages, the field is cleared, and account content stays hidden.', ['session', 'errors'], (b) =>
    expireSession(b.waitVisible(pay.form, { timeout: 8000 }))
      .click(session.submit, { description: 'Click “Continue session” with an empty password' })
      .text(session.error, 'Enter your password.')
      .fill(session.password, WRONG_PASSWORD, { description: 'Type a deliberately wrong synthetic password' })
      .click(session.submit, { description: 'Click “Continue session”' })
      .waitText("That password didn't match. Try again.", { timeout: 4000 })
      .value(session.password, '', { expect: 'The wrong password is cleared' })
      .focused(session.password)
      .visible(session.modal)
      .hidden(pay.form, { expect: 'Account content stays hidden' })
      .fill(session.password, PASSWORD, { description: 'Type the synthetic password (fixture “password”)' })
      .click(session.submit, { description: 'Click “Continue session”' })
      .waitHidden(session.modal, { timeout: 5000 })
      .visible(pay.form),
  ),
  scenario('fin.session.state-preserved', SUITE_IDS.session, 'Non-sensitive state preserved', '#/payment', 'Draft amount and source account survive re-authentication, the password is not kept, and sign-out clears drafts.', ['session'], (b) =>
    reauthenticate(
      expireSession(
        b
          .waitVisible(pay.amount, { timeout: 8000 })
          .fill(pay.amount, '13000', { description: 'Type a draft amount' })
          .press('Tab', undefined, { description: 'Press Tab to leave the field' })
          .check(pay.savings, true, { description: 'Choose the savings account as the source' }),
      ),
    )
      .waitVisible(pay.form, { timeout: 5000 })
      .value(pay.amount, '13,000.00', { expect: 'The draft amount is restored' })
      .count('[data-testid="payment-source-sav-7710"]:checked', 1, { description: 'Assert the savings account is still selected' })
      .count('#session-password', 0, { description: 'Assert the dialog’s password field is gone', expect: 'The password is not retained anywhere on the page' })
      .click(session.simulate, { description: 'Expire the session again (Demo controls are still open)' })
      .waitVisible(session.modal, { timeout: 4000 })
      .click(session.signOut, { description: 'Click “Sign out” in the dialog' })
      .waitUrl('#/session-expired', { timeout: 4000 })
      .visible(session.expired)
      .text(session.expired, 'Drafts of payments and profile changes were cleared'),
  ),
];

export const FINANCIAL_SCENARIOS: Scenario[] = [...LOGIN, ...PAYMENT, ...STATEMENT, ...PROFILE, ...SESSION];

export const isFinancialScenario = (s: Pick<Scenario, 'id'>) => s.id.startsWith(BUILT_IN_PREFIX);
