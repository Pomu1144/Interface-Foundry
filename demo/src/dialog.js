// Modal dialog plumbing shared by the session re-authentication dialog and the
// keyboard lab dialog: renders into #modal-root, makes the app inert, traps
// Tab / Shift+Tab inside the dialog and restores focus when it closes.
import { focusElement, focusableWithin } from './dom.js';

const openDialogs = [];

export function openDialog(dialogEl, { initialFocus, returnFocus = document.activeElement, onEscape, onBackdropClick } = {}) {
  const modalRoot = document.getElementById('modal-root');
  const app = document.getElementById('app');

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.append(dialogEl);
  modalRoot.append(backdrop);

  openDialogs.push(dialogEl);
  app.inert = true;
  document.documentElement.classList.add('has-modal');

  function onKeydown(event) {
    if (openDialogs[openDialogs.length - 1] !== dialogEl) return;
    if (event.key === 'Escape' && onEscape) {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusableWithin(dialogEl);
    if (items.length === 0) {
      event.preventDefault();
      focusElement(dialogEl);
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialogEl)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // If focus escapes (for example via a tool or a script), pull it back in.
  function onFocusIn(event) {
    if (openDialogs[openDialogs.length - 1] !== dialogEl) return;
    if (!dialogEl.contains(event.target)) focusElement(focusableWithin(dialogEl)[0] ?? dialogEl);
  }

  function onPointerDown(event) {
    if (event.target === backdrop && onBackdropClick) onBackdropClick();
  }

  dialogEl.addEventListener('keydown', onKeydown);
  document.addEventListener('focusin', onFocusIn);
  backdrop.addEventListener('mousedown', onPointerDown);

  const target = typeof initialFocus === 'function' ? initialFocus() : initialFocus;
  focusElement(target ?? focusableWithin(dialogEl)[0] ?? dialogEl);

  let closed = false;
  return {
    element: dialogEl,
    close({ restoreFocus = true, fallbackFocus } = {}) {
      if (closed) return;
      closed = true;
      dialogEl.removeEventListener('keydown', onKeydown);
      document.removeEventListener('focusin', onFocusIn);
      backdrop.removeEventListener('mousedown', onPointerDown);
      backdrop.remove();
      openDialogs.splice(openDialogs.indexOf(dialogEl), 1);
      if (openDialogs.length === 0) {
        app.inert = false;
        document.documentElement.classList.remove('has-modal');
      }
      if (!restoreFocus) return;
      if (returnFocus && returnFocus.isConnected && returnFocus !== document.body) returnFocus.focus();
      else if (fallbackFocus) focusElement(typeof fallbackFocus === 'function' ? fallbackFocus() : fallbackFocus);
    },
  };
}

export function hasOpenDialog() {
  return openDialogs.length > 0;
}
