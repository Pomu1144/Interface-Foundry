// Accessible modal used by the keyboard lab: labelled, focus-trapped, closes
// with Escape, the close button or the backdrop, and restores focus.
import { html, toElement, qs } from '../dom.js';
import { icon } from '../icons.js';
import { openDialog } from '../dialog.js';

export function LabDialog({ title, body, confirmLabel = 'Done', returnFocus, onClose }) {
  const root = toElement(html`
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="lab-dialog-title" aria-describedby="lab-dialog-body" data-testid="lab-dialog" data-ifdy-component="LabDialog" data-ifdy-source="demo/src/components/lab-dialog.js:7">
      <div class="modal__header">
        <h2 class="modal__title" id="lab-dialog-title">${title}</h2>
        <button type="button" class="icon-btn modal__close" aria-label="Close" data-testid="lab-dialog-close">${icon('close')}</button>
      </div>
      <div class="modal__body" id="lab-dialog-body">${body}</div>
      <div class="modal__footer btn-row">
        <button type="button" class="btn btn--primary" data-testid="lab-dialog-confirm">${confirmLabel}</button>
        <button type="button" class="btn btn--secondary" data-testid="lab-dialog-cancel">Cancel</button>
      </div>
    </div>
  `);

  let handle = null;
  const close = () => {
    handle?.close();
    onClose?.();
  };
  qs(root, '[data-testid="lab-dialog-close"]').addEventListener('click', close);
  qs(root, '[data-testid="lab-dialog-confirm"]').addEventListener('click', close);
  qs(root, '[data-testid="lab-dialog-cancel"]').addEventListener('click', close);

  handle = openDialog(root, {
    returnFocus,
    initialFocus: () => qs(root, '[data-testid="lab-dialog-confirm"]'),
    onEscape: close,
    onBackdropClick: close,
  });
  return root;
}
