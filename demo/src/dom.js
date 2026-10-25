// Tiny DOM helpers. Template values are HTML-escaped unless wrapped in raw()
// or produced by another html`` call, so data never becomes markup by accident.

class SafeHTML {
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function serialize(value) {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(serialize).join('');
  if (value instanceof SafeHTML) return value.value;
  return escapeHTML(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += serialize(values[i]) + strings[i + 1];
  return new SafeHTML(out);
}

export function raw(markup) {
  return new SafeHTML(markup);
}

/** Parse an html`` result and return its first element. */
export function toElement(safe) {
  const template = document.createElement('template');
  template.innerHTML = serialize(safe).trim();
  return template.content.firstElementChild;
}

/** Replace the children of `parent` with the parsed markup (or element). */
export function setContent(parent, content) {
  if (content instanceof Node) {
    parent.replaceChildren(content);
    return content;
  }
  const template = document.createElement('template');
  template.innerHTML = serialize(content).trim();
  parent.replaceChildren(template.content);
  return parent.firstElementChild;
}

export const qs = (root, selector) => root.querySelector(selector);
export const qsa = (root, selector) => Array.from(root.querySelectorAll(selector));

/** Move focus to an element that may not be focusable by default. */
export function focusElement(el, { preventScroll = false } = {}) {
  if (!el) return;
  if (!el.matches('a[href], button, input, select, textarea, [tabindex]')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll });
}

export const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function focusableWithin(root) {
  return qsa(root, FOCUSABLE).filter((el) => !el.closest('[hidden], [inert]') && el.getClientRects().length > 0);
}

let idCounter = 0;
export function uid(prefix = 'hl') {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}
