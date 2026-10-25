# Harborline: seeded defects

Harborline Home Loans is a synthetic demo with nine deliberate defects (D1–D9). The IFDY acceptance demo must be able
to find, diagnose and fix each one. Everything else in the app aims to be accessible and responsive, so these
defects stand out. The defects are not marked with comments in the source, so audits have to find them from the
rendered page.

Reference devices

| Device                         | Viewport  | Notes                                                    |
| ------------------------------ | --------- | -------------------------------------------------------- |
| Surface Duo, folded            | 540 × 720 | primary demo device                                      |
| Surface Duo, spanned           | 1114 × 720 | **34 px vertical hinge at x = 540–574**; content there is invisible |
| Galaxy Z Fold, cover screen    | 344 × 882 |                                                          |
| Desktop                        | 1440 × 900 | reference "good" layout                                 |

Line numbers below were correct when this file was written. The selectors and properties identify each defect
exactly, so use them if the line numbers drift.

---

## D1: Promotional banner overflows the folded viewport

| | |
|---|---|
| Route | `#/login` |
| Selectors | `.rate-banner` · `[data-testid="rate-banner"]` (component `RateBanner`, `demo/src/components/rate-banner.js:8`) |
| Manifests | width ≤ 575 px: 540 × 720 (scrollWidth 576), 344 × 882. Not at 1114 or 1440. |
| Audit should report | Horizontal page overflow: `document.documentElement.scrollWidth` (576) > `innerWidth` (540). The offending element is `.rate-banner`, whose right edge is at x = 576, past the viewport. Its fixed width does not shrink with its container. |
| Root cause | `demo/src/styles/login.css`, rule `.rate-banner`, property `width: 560px;` (line 49). |
| Minimal fix | In `.rate-banner`, replace `width: 560px;` with `width: auto; max-width: 100%;` |
| Verify | At 540 and 344, `scrollWidth <= innerWidth`, and the banner text wraps inside the card. |

## D2: Login card split by the Surface Duo hinge

| | |
|---|---|
| Route | `#/login` |
| Selectors | `.login__panel-inner`, `.login-card`, `[data-testid="login-submit"]`, `#login-username`, `#login-password`, `#login-loan-number` |
| Manifests | 1114 × 720 (spanned Duo). Any width from 700 to 1199 px gets the same centred-card layout, but the hinge exists only on the Duo. |
| Audit should report | Interactive content under the hinge (x = 540–574). The card spans x ≈ 237–877. The Sign in button (x ≈ 278–836, y ≈ 618–666) and all three inputs cross the hinge, so the middle of each field and the button label are hidden. |
| Root cause | `demo/src/styles/login.css`: (a) `@media (min-width: 700px) and (max-width: 1199px)` (line 234) makes `.login__panel-inner { max-width: 640px; margin-inline: auto }` (line 244) a single card centred on the hinge; (b) the two-column photo \| form layout starts only at `@media (min-width: 1200px)` (line 259), and its `.login { grid-template-columns: minmax(0, 1fr) minmax(640px, 44%) }` (line 262) is not hinge-aware. There is no `horizontal-viewport-segments` rule. |
| Minimal fix | **Fix D1 first.** After this fix the form column is about 557 px wide, which the fixed 560 px banner would overflow. In `login.css`: change `@media (min-width: 700px) and (max-width: 1199px)` to `@media (min-width: 700px) and (max-width: 999px)`. Change `@media (min-width: 1200px)` to `@media (min-width: 1000px), (horizontal-viewport-segments: 2)`. In that block, change `grid-template-columns: minmax(0, 1fr) minmax(640px, 44%);` to `grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);`. The halves now meet at x = 557, and the panel padding moves the form to x ≥ 597, clear of the hinge. |
| Optional, segment-exact | `@media (horizontal-viewport-segments: 2) { .login { grid-template-columns: env(viewport-segment-width 0 0) env(viewport-segment-width 1 0); column-gap: calc(env(viewport-segment-left 1 0) - env(viewport-segment-right 0 0)); } }` |
| Verify | At 1114, no element of `.login__panel` intersects x = 540–574, and `[data-testid="login-submit"]` has left ≈ 597. At 1440 nothing overflows. |

## D3: Low-contrast "Forgot password?" link

| | |
|---|---|
| Route | `#/login` |
| Selectors | `.login-form__forgot` · `[data-testid="forgot-password"]` |
| Manifests | All viewports |
| Audit should report | Text contrast 2.5:1 for `#9AA5B1` on `#FFFFFF` at 14 px / weight 500, below the 4.5:1 that WCAG 1.4.3 (AA) requires. axe-core reports it as `color-contrast` (serious). |
| Root cause | `demo/src/styles/login.css`, rules `.login-form__forgot` and `.login-form__forgot:hover`, property `color: #9aa5b1;` (lines 181 and 186). This is a hard-coded colour that bypasses the design tokens. |
| Minimal fix | Use the link token: `color: var(--hl-color-link);` (`#0A7A72`, about 5.2:1) in both rules. |
| Verify | axe `color-contrast` passes for `.login-form`. |

## D4: Loan number field has no label

| | |
|---|---|
| Route | `#/login` |
| Selectors | `#login-loan-number` · `[data-testid="login-loan-number"]` |
| Manifests | All viewports |
| Audit should report | The form field has no programmatic label: no `<label for>`, no wrapping label, no `aria-label`, `aria-labelledby` or `title`. The only cue is `placeholder="Loan number (optional)"`, which disappears once the user types (WCAG 1.3.1, 3.3.2 and 4.1.2). Chrome falls back to the placeholder for the accessible name. |
| Note for integrators | axe-core 4.14's `label` rule **passes** this input, because its `non-empty-placeholder` check accepts a placeholder. To detect D4, add a heuristic that flags `input:not([type=hidden])` with a placeholder and `labels.length === 0`, no `aria-label`, no `aria-labelledby` and no `title`. |
| Root cause | `demo/src/components/login-form.js`, in the `LoginForm` markup (lines 66–77). The `<input id="login-loan-number" … placeholder="Loan number (optional)">` has no label element. |
| Minimal fix | Add `<label class="field__label" for="login-loan-number">Loan number <span class="field__optional">(optional)</span></label>` before the input in the same `.field`. The placeholder can then be removed. |
| Verify | The accessible name is "Loan number (optional)" and comes from a `<label>`. |

## D5: "Remember this device" checkbox is too small to tap

| | |
|---|---|
| Route | `#/login` |
| Selectors | `#login-remember` · `[data-testid="login-remember"]` · `.login-form__remember` |
| Manifests | All viewports, and matters most on touch devices (540, 344) |
| Audit should report | The touch target is 14 × 14 CSS px, below the 24 × 24 minimum in WCAG 2.5.8 (AA) and the 44 × 44 recommendation in 2.5.5 and the platform guidelines. The text "Remember this device" is not clickable: it is a `<span>` referenced by `aria-labelledby`, not a `<label>`. |
| Note for integrators | axe-core's `target-size` rule passes this checkbox through its spacing exception, because nothing else interactive is within 24 px. Use a size-based tap-target check, for example any interactive element whose bounding box is smaller than 24 × 24. |
| Root cause | `demo/src/styles/login.css`, rule `.login-form__remember input`, properties `width: 14px; height: 14px;` (lines 174–175). In the markup (`login-form.js` lines 80–83), the wrapper is a `<span class="login-form__remember">`, not a `<label>`. |
| Minimal fix | CSS: `.login-form__remember input { width: 1.25rem; height: 1.25rem; }` and `.login-form__remember { min-height: var(--hl-tap-target-min); cursor: pointer; }`. Markup: change the wrapper `<span class="login-form__remember">` to `<label class="login-form__remember" for="login-remember">` so the text becomes part of the target. `aria-labelledby` can then be removed. |
| Verify | The checkbox is ≥ 20 × 20, and the clickable label row is ≥ 44 px tall. |

## D6: Primary action hidden on narrow screens

| | |
|---|---|
| Route | `#/statement` |
| Selectors | `.statement__download` · `[data-testid="download-statement"]` ("Download statement (PDF)") |
| Manifests | width < 600 px: 540 × 720 and 344 × 882. The button is visible at 1114 and 1440. |
| Audit should report | The primary action exists in the DOM but `display: none` hides it below 600 px, so mobile users cannot download their statement. Only the secondary "Make a payment" button remains. This is a responsive feature-parity problem. |
| Root cause | `demo/src/styles/statement.css`, `@media (max-width: 599px) { .statement__download { display: none; } }` (lines 7–11). |
| Minimal fix | Delete that media block. If you want a mobile treatment, use `.statement__download { width: 100%; }` instead. |
| Verify | At 540, `getComputedStyle(downloadButton).display !== 'none'`, and the button is in the tab order. |

## D7: Important notice lines are too long

| | |
|---|---|
| Route | `#/dashboard` |
| Selectors | `.notice__body` (inside `.notice` · `[data-testid="important-notice"]`, component `ImportantNotice`, `demo/src/components/important-notice.js:5`) |
| Manifests | Wide viewports: about 162 characters per line at 1114 and about 191 at 1440. At 540 it is about 75, which is fine. |
| Audit should report | Line length is about 160–190 characters, well over the roughly 80-character readable measure (WCAG 1.4.8 AAA; typographic best practice is 45–80). |
| Root cause | `demo/src/styles/dashboard.css`, rule `.notice__body` (line 321) has no `max-width`. The notice spans the full `.page` content width (up to 80 rem). |
| Minimal fix | Add `max-width: var(--hl-measure);` to `.notice__body`. The `--hl-measure` token is `55ch`, about 80 characters. |
| Verify | At 1440 the longest line is at most 80 characters. |

## D8: "Save preferences" cannot be reached by keyboard

| | |
|---|---|
| Route | `#/keyboard` |
| Selectors | `.fake-button` · `[data-testid="save-preferences"]` |
| Manifests | All viewports |
| Audit should report | A clickable element is not keyboard accessible: it is a `<div>` with a click handler, `cursor: pointer` and button styling, but no `tabindex`, no `role="button"` and no key handling. Tab skips it (the focus order goes `pref-offers` → `open-lab-dialog`). Its role is `generic`, so it has no button semantics or name (WCAG 2.1.1 and 4.1.2). Pressing Enter or Space cannot save preferences. |
| Note for integrators | axe-core does not detect this. Look for elements that have click listeners or `cursor: pointer` but are not focusable and have no interactive role, or walk the Tab order and compare it with the visible controls. |
| Root cause | `demo/src/components/keyboard-lab.js`, in the `KeyboardLab` markup, line 80: `<div class="fake-button" data-testid="save-preferences">Save preferences</div>`. The handler is attached at line 124 with `qs(root, '.fake-button')`. The styling is the `.fake-button` rule in `demo/src/styles/keyboard.css`. |
| Minimal fix | Replace the div with `<button type="button" class="btn btn--primary" data-testid="save-preferences">Save preferences</button>`, and change the handler lookup to `qs(root, '[data-testid="save-preferences"]')`. A less good alternative is to add `role="button" tabindex="0"` and handle Enter and Space keydown. |
| Verify | Tab reaches "Save preferences", and Enter shows "Preferences saved at …" in `[data-testid="preferences-status"]`. |

## D9: Statement table overflows the page

| | |
|---|---|
| Route | `#/statement` |
| Selectors | `.statement-table` · `[data-testid="statement-table"]` (inside `.statement-activity`, component `StatementTable`, `demo/src/components/statement-table.js:7`) |
| Manifests | width < about 1030 px: 540 × 720 (table about 1013 px wide, page scrollWidth about 1030) and 344 × 882. The table fits at 1114 and 1440. |
| Audit should report | Horizontal page overflow caused by the transactions table: 8 columns, numbers set to `white-space: nowrap`, and a description column with `min-width: 16rem`. The table spills out of its card and the whole page scrolls sideways. No horizontally scrollable container wraps it (WCAG 1.4.10 Reflow). |
| Root cause | `demo/src/components/statement-table.js`: the `<table class="statement-table">` (line 16) is a direct child of the card, with no scroll wrapper. `demo/src/styles/statement.css` has no overflow handling for the table (rule `.statement-table` at line 127). |
| Minimal fix | Markup: wrap the table in `<div class="table-scroll" role="region" aria-labelledby="statement-activity-title" tabindex="0">…</div>`. The `tabindex` lets keyboard users scroll the region. CSS: `.table-scroll { overflow-x: auto; }`. |
| Verify | At 540, `scrollWidth === innerWidth` and the table scrolls inside its card. |

---

## Expected signals that are not defects

These are intentional and should not count as regressions:

- **Network failure:** every visit to `#/statement` requests `demo/data/escrow-analysis.json`, which does not
  exist. The request returns HTTP 404 and is logged with
  `console.error('[harborline] Failed to load escrow analysis (HTTP 404) …')`. The page shows an inline
  "Escrow analysis is temporarily unavailable" message with a "Try again" button
  (`[data-testid="escrow-analysis-unavailable"]`).
- **Console warning:** the first render of `#/login` logs a deprecation warning:
  `console.warn('[harborline] RateBanner option "legacyRateFeed" is deprecated …')`.
- **Info logs:** `console.info('[harborline] route', <route>)` runs on every route change. The app also logs when a
  synthetic session starts or expires, and when a payment submission is accepted.
- **Spanned-Duo observations not seeded as defects:** the full-width statement table (its numeric columns) and the
  D7 notice paragraph cross the hinge at 1114. On every other route, the two-column `.split` layout puts its
  36 px gap over the hinge, and the hinge-aware rule in `modal.css` keeps dialogs on one screen when
  `horizontal-viewport-segments` is supported. In an emulator that only sets the width, centred modals still
  straddle the hinge.
- **axe-core baseline:** with WCAG 2.0/2.1/2.2 A and AA plus best practices enabled, every route is clean except
  `color-contrast` on `.login-form__forgot` (D3). D4, D5 and D8 need the extra heuristics described above.
