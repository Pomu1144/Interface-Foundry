// Error summary shown at the top of a form after a failed submit. It receives
// focus, and each link moves focus to the field it describes.
import { html, toElement, qsa } from '../dom.js';
import { icon } from '../icons.js';

export function ErrorSummary({ errors, testid = 'error-summary' }) {
  const count = errors.length;
  const root = toElement(html`
    <div class="error-summary" tabindex="-1" aria-labelledby="${testid}-title" data-testid="${testid}" data-ifdy-component="ErrorSummary" data-ifdy-source="demo/src/components/error-summary.js:6">
      <h2 class="error-summary__title" id="${testid}-title">
        ${icon('alert')}<span>There ${count === 1 ? 'is a problem with 1 field' : `are problems with ${count} fields`}</span>
      </h2>
      <ul class="error-summary__list">
        ${errors.map(
          (error) => html`<li><a href="#${error.id}" data-field="${error.id}" data-testid="${testid}-link">${error.message}</a></li>`,
        )}
      </ul>
    </div>
  `);

  // The app uses hash routing, so in-page anchors are handled here instead of
  // letting the browser rewrite the hash.
  for (const link of qsa(root, 'a[data-field]')) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const field = document.getElementById(link.dataset.field);
      if (!field) return;
      const label = document.querySelector(`label[for="${field.id}"]`);
      (label ?? field).scrollIntoView({ block: 'center' });
      field.focus({ preventScroll: true });
    });
  }

  return root;
}
