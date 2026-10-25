# Harborline Home Loans: IFDY synthetic demo

Harborline Home Loans is a **fictional** mortgage servicer. This app is the synthetic demo used by IFDY (Interface
Foundry) to show design inspection, DevTools, foldable-device simulation and financial UX test scenarios. All
people, accounts, numbers and addresses are synthetic, and no real customer data is used.

- Plain HTML, CSS and vanilla ES modules. There is no build step and no external network requests (no CDNs and no
  web fonts; it uses a system font stack that prefers a locally installed Inter).
- The IFDY preview host serves it at `http://localhost:<port>/demo/` inside a sandboxed, cross-origin iframe. The
  IDE injects its own agent script, and the app does not depend on it.
- All state lives in memory in `src/store.js`, so it survives hash-route changes and works when Web Storage is
  blocked. Storage is touched only by "Remember this device", and every access is wrapped in try/catch.
- Seeded defects are documented in [`DEFECTS.md`](./DEFECTS.md).

To run it standalone, run `python3 -m http.server 8765` from the repository root, then open
`http://localhost:8765/demo/`.

## Routes

| Route | Page | Access |
| --- | --- | --- |
| `#/login` (default and fallback) | Sign in: hero photo on wide layouts, refinance banner, sign-in form | public |
| `#/dashboard` | Account overview: loan summary, escrow at a glance, quick actions, recent activity, important notice | borrower |
| `#/statement` | Mortgage statement: amount due, account info, past payments, 41-row transaction table, escrow analysis (404), notices | borrower |
| `#/payment` | Make a payment: Details → Review → Confirmation | borrower |
| `#/profile` | Account maintenance: contact details and mailing address | borrower |
| `#/keyboard` | Keyboard navigation lab: skip link, custom dropdown, preferences, modal dialog | public |
| `#/session-expired` | Signed-out page | public |

**Demo mode.** If you open a borrower route without a session (for example, by loading `/demo/#/statement`), the app
starts a synthetic session as Jordan Mercer. This lets audits target any screen directly. After an explicit sign-out
(the header's Sign out button, or Sign out in the session dialog), borrower routes redirect to `#/login` and return
to the requested route after sign-in. Add `?requireAuth=1` to require sign-in from the start.

## Synthetic credentials

| Field | Value |
| --- | --- |
| Username | `demo.borrower` (trimmed, case-insensitive) |
| Password | `Harbor!2026` |
| Loan number | optional; any value is accepted |

The credentials are also shown under the sign-in form (`[data-testid="demo-credentials"]`).

## Behaviour that test scenarios rely on

- **Login.** An empty submit shows inline errors on username and password. Each error is linked with
  `aria-describedby`, the field gets `aria-invalid="true"`, and focus moves to the first invalid field. Wrong
  credentials show `[data-testid="login-error"]` (`role="alert"`) with the text "We couldn't verify those
  credentials.", clear the password field and focus it. Valid credentials put the button into a busy state for
  about 900 ms (spinner, `disabled`, `aria-busy="true"`, label "Signing in…"; repeat submits are ignored) and then
  navigate to `#/dashboard`. The form is never re-rendered on resize, so typed values and focus survive viewport
  changes.
- **Payment.** The amount field accepts values like `1234567.89` and formats them on blur to `1,234,567.89`. The
  breakdown updates live: interest, escrow and fees first, and any amount above the regular payment goes to
  principal. The allowed range runs from the regular payment ($11,394.42) to the estimated payoff
  ($1,505,157.76). The first submission after page load always fails with "Payment service timed out"
  (`[data-testid="payment-error"]`, `role="alert"`), shows `[data-testid="payment-retry"]` and moves focus to it;
  the retry succeeds. Submissions are guarded synchronously and carry an idempotency key, so double-clicking Submit
  or Retry never creates a second confirmation. Each accepted submission increments
  `paymentSubmissions.accepted` in the store and logs
  `console.info('[harborline] payment submission accepted', …)`. Confirmation numbers look like
  `HL-20261025-48211`.
- **Profile.** All fields are required except "Apartment, suite or unit". Phone numbers are formatted to
  `(555) 555-0142` and ZIP codes to 5 or 9 digits (`04999-1234`), on blur and on submit. A failed submit renders
  `[data-testid="profile-error-summary"]` at the top of the form and focuses it. Each link in the summary
  (`profile-error-summary-link`) focuses its field without changing the hash. Success shows
  `[data-testid="profile-success"]` with fixture reference `CHG-20261025-0417` and focuses it.
- **Session recovery.** "Simulate session timeout" (in Demo controls) or `?sessionTimeout=<seconds>` expires an
  active session. Account content is removed from the page, and `[data-testid="session-modal"]` opens
  (`role="dialog"`, `aria-modal="true"`, focus trapped, background `inert`; Escape does not dismiss it). Entering
  the password (`Harbor!2026`) re-renders the same route with non-sensitive drafts restored, such as the payment
  amount. The password lives only in the dialog's input and is cleared when the dialog closes. Choosing Sign out
  clears all drafts and goes to `#/session-expired`.
- **Keyboard lab.** The dropdown is a WAI-ARIA select-only combobox (`#delivery`) supporting arrow keys, Home and
  End, PageUp and PageDown, Enter, Space, Escape, Tab and type-ahead. "Review notification summary" opens a modal
  that traps focus, closes on Escape, the close button or the backdrop, and returns focus to its trigger.

## Network and console

| Request | Result |
| --- | --- |
| `data/account.json` | 200, borrower, loan, next payment, escrow, payment sources (cached per page load) |
| `data/activity.json` | 200, recent activity |
| `data/statement.json` | 200, statement, 41 transactions, notice text |
| `data/profile.json` | 200, profile fixture, update result, state list |
| `data/escrow-analysis.json` | **404, deliberate.** Each statement visit and each "Try again" logs a `console.error` |

Expected console output: `info` route logs and session and payment events, one `warn` (the `legacyRateFeed`
deprecation on the login page), and the 404 plus its `console.error` on the statement page. Nothing else is
expected.

A read-only debug handle is available as `window.__harborline`. It provides `version`, `routes`, `snapshot()` (a
deep copy of the store) and `expireSession()`.

## Demo controls

The footer contains a "Demo controls" disclosure (`<details>`, `[data-testid="demo-controls"]`) with:

- **Simulate session timeout** (`simulate-session-timeout`). If no session is active, it reports that in
  `demo-controls-status`.
- Links to the keyboard lab, the signed-out page, and a reload with `?sessionTimeout=30#/payment`.

Query parameters: `?sessionTimeout=<seconds>` (automatic expiry, which restarts after re-authentication) and
`?requireAuth=1`.

## Component inventory

Each component's root element carries `data-ifdy-component` and
`data-ifdy-source="demo/src/components/<file>:<line>"`. The line is the exact 1-based line of the exported render
function.

| Component | Source | Root element |
| --- | --- | --- |
| SiteHeader | `demo/src/components/site-header.js:14` | `header.site-header` |
| SiteFooter | `demo/src/components/site-footer.js:7` | `footer.site-footer` |
| DemoControls | `demo/src/components/demo-controls.js:7` | `details.demo-controls` |
| LoginPage | `demo/src/components/login-page.js:8` | `div.login` |
| RateBanner | `demo/src/components/rate-banner.js:8` | `aside.rate-banner` |
| LoginForm | `demo/src/components/login-form.js:13` | `form.login-form` |
| DashboardPage | `demo/src/components/dashboard-page.js:20` | `div.page.dashboard` |
| AccountSummary | `demo/src/components/account-summary.js:7` | `section.account-summary` |
| EscrowSnapshot | `demo/src/components/escrow-snapshot.js:7` | `section.escrow-snapshot` |
| QuickActions | `demo/src/components/quick-actions.js:11` | `section.quick-actions` |
| RecentActivity | `demo/src/components/recent-activity.js:10` | `section.activity` |
| ImportantNotice | `demo/src/components/important-notice.js:5` | `section.notice` |
| StatementPage | `demo/src/components/statement-page.js:17` | `div.page.statement` |
| StatementTable | `demo/src/components/statement-table.js:7` | `section.statement-activity` |
| EscrowAnalysis | `demo/src/components/escrow-analysis.js:8` | `section.escrow-analysis` |
| PaymentPage | `demo/src/components/payment-page.js:17` | `div.page.payment` |
| PaymentForm | `demo/src/components/payment-form.js:10` | `form.payment-form` |
| PaymentReview | `demo/src/components/payment-review.js:11` | `section.payment-review` |
| PaymentConfirmation | `demo/src/components/payment-confirmation.js:6` | `section.payment-confirmation` |
| ProfilePage | `demo/src/components/profile-page.js:7` | `div.page.profile` |
| ProfileForm | `demo/src/components/profile-form.js:92` | `form.profile-form` |
| ErrorSummary | `demo/src/components/error-summary.js:6` | `div.error-summary` |
| KeyboardLab | `demo/src/components/keyboard-lab.js:22` | `div.page.lab` |
| ListboxSelect | `demo/src/components/listbox-select.js:7` | `div.listbox-select` |
| LabDialog | `demo/src/components/lab-dialog.js:7` | `div.modal[role=dialog]` |
| SessionModal | `demo/src/components/session-modal.js:8` | `div.modal.session-modal[role=dialog]` |
| SessionExpiredPage | `demo/src/components/session-expired-page.js:5` | `div.page.session-expired` |
| SessionPaused | `demo/src/components/session-paused.js:6` | `div.page.session-expired` (placeholder while expired) |

## data-testid inventory

| data-testid | Element |
| --- | --- |
| **Shell** | |
| `skip-link` | "Skip to main content" link (first Tab stop) |
| `main` | `<main id="main-content">` |
| `brand-home` | Header logo link |
| `primary-nav` | Primary `<nav>` (signed in only) |
| `nav-dashboard`, `nav-statement`, `nav-payment`, `nav-profile` | Primary nav links (`aria-current="page"` on the active one) |
| `nav-toggle` | Menu button below 1200 px (`aria-expanded`, `aria-controls="site-nav"`) |
| `user-chip` | Signed-in borrower avatar and name |
| `sign-out` | Header Sign out button |
| `synthetic-badge` | Footer badge: "Synthetic demo — Harborline is fictional. No real customer data." |
| `demo-controls` / `demo-controls-toggle` | Demo controls `<details>` and its `<summary>` |
| `simulate-session-timeout` | Expires the active session |
| `demo-controls-status` | Status text for demo controls (`role="status"`) |
| `link-keyboard-lab`, `link-session-expired`, `link-auto-timeout` | Demo control links |
| **Login** | |
| `rate-banner`, `rate-banner-toggle`, `rate-banner-details` | Refinance banner (D1), its Details toggle and fine print |
| `login-form` | Sign-in form |
| `login-username`, `login-username-error` | Username input and its inline error |
| `login-password`, `login-password-error` | Password input and its inline error |
| `login-password-toggle` | Show password toggle (`aria-pressed`, name "Show password") |
| `login-loan-number` | Optional loan number input (D4) |
| `login-remember` | "Remember this device" checkbox (D5) |
| `forgot-password` | "Forgot password?" link (D3); shows an info message |
| `login-info` | Info alert shown after "Forgot password?" |
| `login-submit` | Sign in button (D2) |
| `login-error` | Wrong-credentials alert (`role="alert"`) |
| `demo-credentials`, `demo-username`, `demo-password` | Visible synthetic credentials |
| **Dashboard** | |
| `account-summary` | Loan summary card |
| `next-payment-amount`, `next-payment-due` | Next payment amount and due date |
| `loan-number` | Masked loan number (`••••4821`) |
| `principal-balance`, `interest-rate`, `escrow-balance` | Summary metrics |
| `escrow-snapshot`, `escrow-snapshot-details` | Escrow card and its link |
| `quick-actions` | Quick actions card |
| `qa-make-payment`, `qa-view-statement`, `qa-update-profile` | Quick action links |
| `recent-activity`, `activity-item`, `activity-view-history` | Activity card, each row, "View transaction history" |
| `important-notice` | Important notice (D7) |
| **Statement** | |
| `download-statement` | "Download statement (PDF)" primary button (D6) |
| `download-status` | Download status message |
| `statement-make-payment` | Secondary "Make a payment" link |
| `amount-due`, `amount-due-total` | Amount due card and total |
| `statement-principal` | Outstanding principal |
| `statement-activity` | Transaction activity card |
| `statement-table`, `statement-row` | Transactions table (D9) and each body row (41) |
| `escrow-analysis` | Escrow analysis card |
| `escrow-analysis-unavailable`, `escrow-analysis-retry` | 404 fallback message and its "Try again" button |
| `statement-note-escrow-explained`, `statement-note-late-fee`, `statement-note-assistance`, `statement-note-important` | Explanatory sections |
| **Payment** | |
| `payment-stepper` | Step indicator (`aria-current="step"`) |
| `payment-form` | Details step form |
| `payment-amount`, `payment-amount-error` | Amount input and its error |
| `payment-preset-regular`, `payment-preset-extra` | Amount shortcuts |
| `payment-breakdown` | Live breakdown container |
| `breakdown-principal`, `breakdown-interest`, `breakdown-escrow`, `breakdown-fees`, `breakdown-total` | Breakdown values |
| `payment-date`, `payment-date-error` | Payment date input and its error |
| `payment-source-chk-0193`, `payment-source-sav-7710` | Source account radios |
| `payment-continue`, `payment-cancel` | "Review payment" and Cancel |
| `payment-review` | Review step |
| `review-amount`, `review-source` | Reviewed amount and source |
| `payment-submit`, `payment-edit` | Submit payment and Edit details |
| `payment-error`, `payment-retry` | Timeout alert and Retry button |
| `payment-confirmation` | Confirmation step |
| `confirmation-number`, `confirmation-amount` | Confirmation number and amount |
| `confirmation-done`, `payment-new` | "Back to overview" and "Make another payment" |
| **Profile** | |
| `profile-form` | Contact details form |
| `profile-full-name`, `profile-email`, `profile-phone`, `profile-address1`, `profile-address2`, `profile-city`, `profile-state`, `profile-zip` | Fields (the `id` matches the testid) |
| `profile-<field>-error` | Inline error for each field, for example `profile-email-error` |
| `profile-error-summary`, `profile-error-summary-link` | Error summary and each of its links |
| `profile-submit`, `profile-undo` | Save changes and Undo changes |
| `profile-success`, `profile-reference` | Success message and reference number |
| **Keyboard lab** | |
| `lab-case-skip-link`, `lab-case-listbox`, `lab-case-preferences`, `lab-case-dialog` | Test case cards |
| `delivery-select`, `delivery-select-combobox`, `delivery-select-listbox` | Custom dropdown wrapper, combobox and listbox |
| `pref-reminders`, `pref-escrowAlerts`, `pref-offers` | Preference checkboxes |
| `save-preferences` | "Save preferences" fake button (D8) |
| `preferences-status` | Save status (`role="status"`) |
| `open-lab-dialog` | Opens the lab modal |
| `lab-dialog`, `lab-dialog-close`, `lab-dialog-confirm`, `lab-dialog-cancel` | Lab modal and its buttons |
| **Session** | |
| `session-modal` | Session-expired dialog |
| `session-username` | Read-only username in the dialog |
| `session-reauth-form`, `session-reauth-password`, `session-reauth-error` | Re-authentication form, password and error |
| `session-reauth-submit`, `session-sign-out` | Continue session and Sign out |
| `session-paused` | Placeholder rendered behind the dialog |
| `session-expired`, `session-expired-sign-in` | Signed-out page card and its "Sign in again" link |

## Design tokens

All tokens are CSS custom properties on `:root` in `src/styles/tokens.css`, and the rest of the CSS uses them:

- **Colour:** `--hl-color-navy` `#0B2545`, `--hl-color-teal` `#13A89E`, `--hl-color-gold` `#F2B544`, their tints,
  neutrals, feedback colours and semantic aliases.
- **Type:** `--hl-font-size-*`, `--hl-font-weight-*`, `--hl-line-height-*`, `--hl-measure`.
- **Space and shape:** `--hl-space-*`, `--hl-radius-*`.
- **Other:** `--hl-shadow-*`, `--hl-control-height`, `--hl-tap-target-min`, `--hl-content-max`, `--hl-split-gap`,
  plus motion and z-index tokens.

Outside `tokens.css`, the only raw colour values are translucent tints of the brand colours used in overlays and
gradients, plus the D3 defect's `#9aa5b1`.

## Files

```
demo/
  index.html            app shell (skip link, header/footer slots, <main>, #modal-root)
  assets/               harbor-home(.webp|-sm.webp), harborline-mark(.png|-64.png)
  data/                 account.json, activity.json, statement.json, profile.json (escrow-analysis.json is intentionally missing)
  src/app.js            bootstrap, routes, auth guard, session recovery
  src/router.js         hash router (ignores in-page anchors)
  src/store.js          in-memory state plus guarded Web Storage helpers
  src/session.js        session start, expire, resume and end; ?sessionTimeout
  src/api.js            fixture fetches and simulated services (login, payments, profile)
  src/payments.js       payment breakdown and validation rules
  src/dialog.js         modal plumbing (inert background, focus trap, focus return)
  src/dom.js, icons.js, format.js
  src/components/*.js   one file per component (see the inventory above)
  src/styles/*.css      tokens, base, layout, login, dashboard, statement, payment, profile, keyboard, modal
```
