// Keyboard navigation lab: a page of keyboard test cases (skip link, custom
// dropdown, preference controls and a modal dialog).
import { html, toElement, qs, qsa } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import { ListboxSelect } from './listbox-select.js';
import { LabDialog } from './lab-dialog.js';

const DELIVERY_OPTIONS = [
  { value: 'paperless', label: 'Paperless (email)', description: 'Statements in your secure inbox; email when ready' },
  { value: 'paper', label: 'Paper by mail', description: 'Mailed to the address on file' },
  { value: 'both', label: 'Paper and email', description: 'Both, for your records' },
  { value: 'portal', label: 'Secure message center only', description: 'No email notifications' },
];

const NOTIFICATIONS = [
  { key: 'reminders', label: 'Payment reminders', detail: '5 days before each due date' },
  { key: 'escrowAlerts', label: 'Escrow changes', detail: 'Tax or insurance disbursements and analyses' },
  { key: 'offers', label: 'Rate and refinance offers', detail: 'At most once a month' },
];

export function KeyboardLab() {
  const prefs = state.preferences;
  const root = toElement(html`
    <div class="page lab" data-ifdy-component="KeyboardLab" data-ifdy-source="demo/src/components/keyboard-lab.js:22">
      <header class="page__header">
        <div>
          <p class="page__eyebrow">Accessibility test page</p>
          <h1 class="page__title" id="keyboard-title">Keyboard navigation lab</h1>
          <p class="page__lede">
            Each panel is a keyboard test case. Use Tab and Shift+Tab to move between controls, Enter or Space to
            activate, the arrow keys inside the dropdown, and Escape to close.
          </p>
        </div>
      </header>

      <div class="split">
        <div class="stack">
          <section class="card lab-case" aria-labelledby="lab-skip-title" data-testid="lab-case-skip-link">
            <p class="lab-case__number">Case 1</p>
            <h2 class="card__title" id="lab-skip-title">Skip link</h2>
            <p>
              The first Tab stop on every page is a <strong>Skip to main content</strong> link. It becomes visible when
              focused and moves focus past the header to the main region.
            </p>
            <ol class="lab-steps">
              <li>Reload the page, then press <kbd>Tab</kbd> once.</li>
              <li>Press <kbd>Enter</kbd> on “Skip to main content”.</li>
              <li>Press <kbd>Tab</kbd> again: focus continues inside the page content.</li>
            </ol>
          </section>

          <section class="card lab-case" aria-labelledby="lab-listbox-title" data-testid="lab-case-listbox">
            <p class="lab-case__number">Case 2</p>
            <h2 class="card__title" id="lab-listbox-title">Custom dropdown</h2>
            <div data-slot="listbox"></div>
            <p class="small muted lab-case__keys">
              <kbd>↓</kbd> <kbd>↑</kbd> move · <kbd>Home</kbd> <kbd>End</kbd> jump · <kbd>Enter</kbd> select ·
              <kbd>Esc</kbd> close · type a letter to jump
            </p>
          </section>
        </div>

        <div class="stack">
          <section class="card lab-case" aria-labelledby="lab-prefs-title" data-testid="lab-case-preferences">
            <p class="lab-case__number">Case 3</p>
            <h2 class="card__title" id="lab-prefs-title">Notification preferences</h2>
            <fieldset class="lab-prefs">
              <legend class="visually-hidden">Send me</legend>
              ${NOTIFICATIONS.map(
                (n) => html`
                  <label class="checkbox">
                    <input type="checkbox" name="${n.key}" data-testid="pref-${n.key}" ${prefs[n.key] ? html`checked` : ''} />
                    <span><span class="checkbox__label">${n.label}</span><span class="checkbox__detail">${n.detail}</span></span>
                  </label>
                `,
              )}
            </fieldset>
            <div class="lab-actions">
              <div class="fake-button" data-testid="save-preferences">Save preferences</div>
            </div>
            <p class="lab-status" role="status" data-testid="preferences-status"></p>
          </section>

          <section class="card lab-case" aria-labelledby="lab-dialog-case-title" data-testid="lab-case-dialog">
            <p class="lab-case__number">Case 4</p>
            <h2 class="card__title" id="lab-dialog-case-title">Modal dialog</h2>
            <p>
              Opens a dialog that traps focus, closes with <kbd>Esc</kbd>, and returns focus to the button that opened
              it.
            </p>
            <div>
              <button type="button" class="btn btn--secondary" data-testid="open-lab-dialog">
                ${icon('document')}<span>Review notification summary</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  `);

  qs(root, '[data-slot="listbox"]').replaceWith(
    ListboxSelect({
      id: 'delivery',
      testid: 'delivery-select',
      label: 'Statement delivery',
      hint: 'How you receive your monthly mortgage statement.',
      options: DELIVERY_OPTIONS,
      value: prefs.delivery,
      onChange: (value) => {
        prefs.delivery = value;
      },
    }),
  );

  for (const box of qsa(root, '.lab-prefs input[type="checkbox"]')) {
    box.addEventListener('change', () => {
      prefs[box.name] = box.checked;
    });
  }

  const status = qs(root, '[data-testid="preferences-status"]');
  qs(root, '.fake-button').addEventListener('click', () => {
    prefs.savedAt = new Date();
    const time = prefs.savedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    status.textContent = `Preferences saved at ${time}.`;
  });

  const trigger = qs(root, '[data-testid="open-lab-dialog"]');
  trigger.addEventListener('click', () => {
    const delivery = DELIVERY_OPTIONS.find((o) => o.value === prefs.delivery)?.label;
    const enabled = NOTIFICATIONS.filter((n) => prefs[n.key]).map((n) => n.label);
    LabDialog({
      title: 'Notification summary',
      returnFocus: trigger,
      body: html`
        <p>Here's how Harborline will contact you. Nothing is saved until you choose Save preferences.</p>
        <dl class="kv">
          <div class="kv__row"><dt>Statement delivery</dt><dd>${delivery}</dd></div>
          <div class="kv__row"><dt>Notifications</dt><dd>${enabled.length ? enabled.join(', ') : 'None'}</dd></div>
        </dl>
      `,
    });
  });

  return root;
}
