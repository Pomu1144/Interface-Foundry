// Accessible custom dropdown following the WAI-ARIA "select-only combobox"
// pattern: focus stays on the combobox, aria-activedescendant tracks the
// highlighted option, and the full keyboard model is supported.
import { html, toElement, qs, qsa } from '../dom.js';
import { icon } from '../icons.js';

export function ListboxSelect({ id, label, hint, options, value, onChange, testid = id }) {
  const labelId = `${id}-label`;
  const listId = `${id}-listbox`;
  const hintId = `${id}-hint`;
  const root = toElement(html`
    <div class="listbox-select" data-testid="${testid}" data-ifdy-component="ListboxSelect" data-ifdy-source="demo/src/components/listbox-select.js:7">
      <span class="field__label" id="${labelId}">${label}</span>
      ${hint ? html`<p class="field__hint" id="${hintId}">${hint}</p>` : ''}
      <div
        class="listbox-select__combo"
        id="${id}"
        role="combobox"
        tabindex="0"
        aria-labelledby="${labelId}"
        ${hint ? html`aria-describedby="${hintId}"` : ''}
        aria-controls="${listId}"
        aria-expanded="false"
        aria-haspopup="listbox"
        data-testid="${testid}-combobox"
      >
        <span class="listbox-select__value" data-value-label></span>
        ${icon('chevronDown', 'listbox-select__chevron')}
      </div>
      <ul class="listbox-select__list" id="${listId}" role="listbox" aria-labelledby="${labelId}" tabindex="-1" data-testid="${testid}-listbox" hidden>
        ${options.map(
          (option) => html`
            <li class="listbox-select__option" id="${id}-option-${option.value}" role="option" aria-selected="false" data-value="${option.value}">
              <span class="listbox-select__option-text">
                <span class="listbox-select__option-label">${option.label}</span>
                ${option.description ? html`<span class="listbox-select__option-desc">${option.description}</span>` : ''}
              </span>
              ${icon('check', 'listbox-select__check')}
            </li>
          `,
        )}
      </ul>
    </div>
  `);

  const combo = qs(root, '[role="combobox"]');
  const list = qs(root, '[role="listbox"]');
  const optionEls = qsa(root, '[role="option"]');
  const valueLabel = qs(root, '[data-value-label]');
  let selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  let activeIndex = selectedIndex;
  let typeahead = '';
  let typeaheadTimer = null;

  function isOpen() {
    return combo.getAttribute('aria-expanded') === 'true';
  }

  function setActive(index) {
    activeIndex = Math.max(0, Math.min(options.length - 1, index));
    optionEls.forEach((el, i) => el.classList.toggle('is-active', i === activeIndex));
    combo.setAttribute('aria-activedescendant', optionEls[activeIndex].id);
    optionEls[activeIndex].scrollIntoView({ block: 'nearest' });
  }

  function select(index, { notify = true } = {}) {
    selectedIndex = index;
    optionEls.forEach((el, i) => el.setAttribute('aria-selected', String(i === index)));
    valueLabel.textContent = options[index].label;
    if (notify) onChange?.(options[index].value);
  }

  function open(index = selectedIndex) {
    list.hidden = false;
    combo.setAttribute('aria-expanded', 'true');
    setActive(index);
  }

  function close({ commit = false } = {}) {
    if (commit) select(activeIndex);
    list.hidden = true;
    combo.setAttribute('aria-expanded', 'false');
    combo.removeAttribute('aria-activedescendant');
  }

  function matchTypeahead(char) {
    window.clearTimeout(typeaheadTimer);
    typeahead += char.toLowerCase();
    typeaheadTimer = window.setTimeout(() => {
      typeahead = '';
    }, 600);
    const start = isOpen() ? activeIndex + (typeahead.length === 1 ? 1 : 0) : selectedIndex + 1;
    for (let i = 0; i < options.length; i += 1) {
      const index = (start + i) % options.length;
      if (options[index].label.toLowerCase().startsWith(typeahead)) return index;
    }
    return -1;
  }

  combo.addEventListener('keydown', (event) => {
    const { key, altKey } = event;
    if (!isOpen()) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(key)) {
        event.preventDefault();
        open(key === 'ArrowUp' && !altKey ? Math.max(0, selectedIndex - 1) : selectedIndex);
      } else if (key === 'Home' || key === 'End') {
        event.preventDefault();
        open(key === 'Home' ? 0 : options.length - 1);
      } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && key !== ' ') {
        const index = matchTypeahead(key);
        if (index >= 0) {
          open(index);
        }
      }
      return;
    }
    switch (key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive(activeIndex + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (altKey) close({ commit: true });
        else setActive(activeIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(options.length - 1);
        break;
      case 'PageUp':
        event.preventDefault();
        setActive(activeIndex - 10);
        break;
      case 'PageDown':
        event.preventDefault();
        setActive(activeIndex + 10);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        close({ commit: true });
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case 'Tab':
        close({ commit: true });
        break;
      default:
        if (key.length === 1 && !event.ctrlKey && !event.metaKey) {
          const index = matchTypeahead(key);
          if (index >= 0) setActive(index);
        }
    }
  });

  combo.addEventListener('click', () => (isOpen() ? close() : open()));
  combo.addEventListener('blur', () => {
    if (isOpen()) close();
  });
  // Keep focus on the combobox while choosing with a pointer.
  list.addEventListener('mousedown', (event) => event.preventDefault());
  optionEls.forEach((el, index) => {
    el.addEventListener('click', () => {
      setActive(index);
      close({ commit: true });
      combo.focus();
    });
    el.addEventListener('mousemove', () => {
      if (activeIndex !== index) setActive(index);
    });
  });

  select(selectedIndex, { notify: false });
  return root;
}
