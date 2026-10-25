import type { RecorderOptions, ReplayResult } from '@shared/protocol';
import type { Assertion, Locator, StepAction, TestStep, WaitCondition } from '@shared/types';
import { accessibleName, roleOf, tabbables } from './a11y';
import { isIfdyNode, isVisible, uniqueSelector } from './nodes';

/* ------------------------------------------------------------------ */
/* Locators                                                            */
/* ------------------------------------------------------------------ */

function labelText(el: Element): string | undefined {
  const input = el as HTMLInputElement;
  const lbl = input.labels?.[0];
  if (lbl) return (lbl.textContent ?? '').replace(/\s+/g, ' ').trim() || undefined;
  return undefined;
}

export function locatorFor(el: Element): Locator {
  const role = roleOf(el);
  const name = accessibleName(el).trim();
  const text = el.children.length === 0 ? (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) : undefined;
  return {
    role: role && role !== 'generic' ? role : undefined,
    name: name || undefined,
    label: labelText(el),
    testId: el.getAttribute('data-testid') ?? undefined,
    placeholder: el.getAttribute('placeholder') ?? undefined,
    text: text || undefined,
    css: uniqueSelector(el),
  };
}

export function describeLocator(l: Locator): string {
  if (l.testId) return `[data-testid="${l.testId}"]`;
  if (l.role && l.name) return `${l.role} “${l.name}”`;
  if (l.label) return `field “${l.label}”`;
  if (l.placeholder) return `placeholder “${l.placeholder}”`;
  if (l.text) return `text “${l.text}”`;
  return l.css;
}

/** Resolve a locator, trying the most stable strategies first. */
export function resolveLocator(l: Locator): { el: Element; strategy: string } | null {
  const visibleFirst = (els: Element[]) => els.find(isVisible) ?? els[0];
  if (l.testId) {
    const el = visibleFirst([...document.querySelectorAll(`[data-testid="${CSS.escape(l.testId)}"]`)]);
    if (el) return { el, strategy: 'testId' };
  }
  if (l.role && l.name) {
    const candidates = [...(document.body?.querySelectorAll('*') ?? [])].filter(
      (e) => !isIfdyNode(e) && roleOf(e) === l.role && accessibleName(e).trim() === l.name,
    );
    const el = visibleFirst(candidates);
    if (el) return { el, strategy: 'role+name' };
  }
  if (l.label) {
    for (const lbl of document.querySelectorAll('label')) {
      if ((lbl.textContent ?? '').replace(/\s+/g, ' ').trim() === l.label && (lbl as HTMLLabelElement).control) {
        return { el: (lbl as HTMLLabelElement).control!, strategy: 'label' };
      }
    }
  }
  if (l.placeholder) {
    const el = document.querySelector(`[placeholder="${CSS.escape(l.placeholder)}"]`);
    if (el) return { el, strategy: 'placeholder' };
  }
  try {
    const el = document.querySelector(l.css);
    if (el) return { el, strategy: 'css' };
  } catch {
    /* invalid selector */
  }
  if (l.text) {
    const el = [...(document.body?.querySelectorAll('button, a, [role="button"], label, span, p, h1, h2, h3, li') ?? [])].find(
      (e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim() === l.text,
    );
    if (el) return { el, strategy: 'text' };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Recording                                                           */
/* ------------------------------------------------------------------ */

const SENSITIVE_FIELD = /pass|pwd|secret|token|ssn|social|card|cvv|cvc|pin|otp|iban|routing|account.?num/i;

export function isSensitiveField(el: Element): boolean {
  const i = el as HTMLInputElement;
  if (i.type === 'password') return true;
  const hints = [i.name, i.id, i.autocomplete, el.getAttribute('aria-label'), labelText(el)].filter(Boolean).join(' ');
  return SENSITIVE_FIELD.test(hints) || /cc-|current-password|new-password|one-time-code/.test(i.autocomplete ?? '');
}

let stepCounter = 0;
const newStep = (action: StepAction, description: string, expect?: string): TestStep => ({
  id: `s${Date.now().toString(36)}${(stepCounter++).toString(36)}`,
  action,
  timestamp: Date.now(),
  timeout: 5000,
  description,
  expect,
});

export class Recorder {
  private active = false;
  private opts: RecorderOptions = { maskAllInputs: false };
  private pendingFill = new Map<Element, ReturnType<typeof setTimeout>>();
  private lastHash = location.href;
  private cleanup: (() => void)[] = [];

  constructor(private emit: (step: TestStep) => void) {}

  start(opts: RecorderOptions) {
    if (this.active) this.stop();
    this.active = true;
    this.opts = opts;
    this.lastHash = location.href;
    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(type, fn, { capture: true, passive: true });
      this.cleanup.push(() => window.removeEventListener(type, fn, { capture: true }));
    };
    on('click', (e) => {
      const target = (e.target as Element)?.closest?.('a, button, input, select, textarea, label, summary, [role], [tabindex], [onclick]') ?? (e.target as Element);
      if (!target || isIfdyNode(target)) return;
      const t = target as HTMLInputElement;
      if (t.tagName === 'INPUT' && (t.type === 'checkbox' || t.type === 'radio')) {
        this.emit(newStep({ type: 'check', locator: locatorFor(t), checked: t.checked }, `${t.checked ? 'Check' : 'Uncheck'} ${describeLocator(locatorFor(t))}`));
        return;
      }
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && t.type !== 'submit' && t.type !== 'button') return;
      const loc = locatorFor(target);
      this.emit(newStep({ type: 'click', locator: loc }, `Click ${describeLocator(loc)}`));
    });
    on('input', (e) => {
      const el = e.target as HTMLInputElement;
      if (!el || !/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.type === 'checkbox' || el.type === 'radio') return;
      clearTimeout(this.pendingFill.get(el));
      this.pendingFill.set(el, setTimeout(() => this.flushFill(el), 600));
    });
    on('change', (e) => {
      const el = e.target as HTMLSelectElement;
      if (el?.tagName === 'SELECT') {
        const loc = locatorFor(el);
        this.emit(newStep({ type: 'select', locator: loc, value: el.value }, `Select “${el.value}” in ${describeLocator(loc)}`));
      } else if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) {
        this.flushFill(el as unknown as HTMLInputElement);
      }
    });
    on('keydown', (e) => {
      if (!['Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', ' '].includes(e.key)) return;
      const el = e.target as Element;
      if (e.key === ' ' && el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) this.flushFill(el as HTMLInputElement);
      const key = (e.shiftKey && e.key === 'Tab' ? 'Shift+' : '') + (e.key === ' ' ? 'Space' : e.key);
      const loc = el && el !== document.body ? locatorFor(el) : undefined;
      this.emit(newStep({ type: 'press', locator: loc, key }, `Press ${key}${loc ? ` on ${describeLocator(loc)}` : ''}`));
    });
    const navTimer = setInterval(() => {
      if (location.href !== this.lastHash) {
        this.lastHash = location.href;
        this.emit(newStep({ type: 'wait', condition: { kind: 'url', includes: location.hash || location.pathname }, timeout: 5000 }, `Wait for navigation to ${location.hash || location.pathname}`));
      }
    }, 250);
    this.cleanup.push(() => clearInterval(navTimer));
  }

  private flushFill(el: HTMLInputElement) {
    const t = this.pendingFill.get(el);
    if (t === undefined) return;
    clearTimeout(t);
    this.pendingFill.delete(el);
    const masked = this.opts.maskAllInputs || isSensitiveField(el);
    const loc = locatorFor(el);
    const value = masked ? `{{secret:${el.name || el.id || 'field'}}}` : el.value;
    this.emit(newStep({ type: 'fill', locator: loc, value, masked }, `Type ${masked ? '•••••' : `“${el.value}”`} into ${describeLocator(loc)}`));
  }

  stop() {
    for (const el of [...this.pendingFill.keys()]) this.flushFill(el as HTMLInputElement);
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    this.active = false;
  }
}

/* ------------------------------------------------------------------ */
/* Replay                                                              */
/* ------------------------------------------------------------------ */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(fn: () => T | null | undefined | false, timeout: number): Promise<T | null> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(50);
  }
  return null;
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

function dispatchPointerClick(el: Element) {
  const r = el.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, composed: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, view: window, button: 0 };
  el.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mousedown', init));
  if (el instanceof HTMLElement && typeof el.focus === 'function') el.focus({ preventScroll: true });
  el.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mouseup', init));
  (el as HTMLElement).click?.();
}

function moveFocus(backwards: boolean) {
  const list = tabbables();
  const idx = list.indexOf(document.activeElement as HTMLElement);
  const next = list[(idx + (backwards ? -1 : 1) + list.length) % list.length];
  next?.focus();
}

function checkWait(c: WaitCondition): boolean {
  switch (c.kind) {
    case 'visible': {
      const r = resolveLocator(c.locator);
      return Boolean(r && isVisible(r.el));
    }
    case 'hidden': {
      const r = resolveLocator(c.locator);
      return !r || !isVisible(r.el);
    }
    case 'text':
      return (document.body?.innerText ?? '').includes(c.text);
    case 'url':
      return location.href.includes(c.includes);
    case 'delay':
      return false;
  }
}

function checkAssertion(a: Assertion): string | null {
  switch (a.kind) {
    case 'visible': {
      const r = resolveLocator(a.locator);
      return r && isVisible(r.el) ? null : `Expected ${describeLocator(a.locator)} to be visible`;
    }
    case 'hidden': {
      const r = resolveLocator(a.locator);
      return !r || !isVisible(r.el) ? null : `Expected ${describeLocator(a.locator)} to be hidden`;
    }
    case 'text': {
      const scope = a.locator ? resolveLocator(a.locator)?.el : document.body;
      const text = (scope as HTMLElement | undefined)?.innerText ?? '';
      return text.includes(a.text) ? null : `Expected text “${a.text}”${a.locator ? ` in ${describeLocator(a.locator)}` : ''}`;
    }
    case 'value': {
      const r = resolveLocator(a.locator);
      const v = (r?.el as HTMLInputElement | undefined)?.value;
      return v === a.value ? null : `Expected value “${a.value}”, got “${v ?? '∅'}”`;
    }
    case 'focused': {
      const r = resolveLocator(a.locator);
      return r && document.activeElement === r.el ? null : `Expected ${describeLocator(a.locator)} to be focused`;
    }
    case 'no-horizontal-overflow':
      return document.documentElement.scrollWidth <= innerWidth + 1 ? null : `Page overflows horizontally (${document.documentElement.scrollWidth}px > ${innerWidth}px)`;
    case 'in-viewport': {
      const r = resolveLocator(a.locator);
      if (!r) return `${describeLocator(a.locator)} not found`;
      const b = r.el.getBoundingClientRect();
      return b.left >= -1 && b.right <= innerWidth + 1 && b.width > 0 ? null : `${describeLocator(a.locator)} is outside the viewport horizontally`;
    }
    case 'count': {
      let n = 0;
      try {
        n = document.querySelectorAll(a.locator.css).length;
      } catch {
        n = 0;
      }
      return n === a.count ? null : `Expected ${a.count} × ${a.locator.css}, found ${n}`;
    }
    case 'enabled': {
      const r = resolveLocator(a.locator);
      const enabled = r && !(r.el as HTMLButtonElement).disabled && r.el.getAttribute('aria-disabled') !== 'true';
      return Boolean(enabled) === a.enabled ? null : `Expected ${describeLocator(a.locator)} to be ${a.enabled ? 'enabled' : 'disabled'}`;
    }
  }
}

export async function replayStep(action: StepAction, timeout: number): Promise<ReplayResult> {
  const t0 = performance.now();
  const done = (ok: boolean, error?: string, usedLocator?: string): ReplayResult => ({ ok, error, usedLocator, durationMs: Math.round(performance.now() - t0) });
  const need = async (l: Locator) => {
    const r = await waitFor(() => {
      const found = resolveLocator(l);
      return found && isVisible(found.el) ? found : null;
    }, timeout);
    if (!r) throw new Error(`Could not find ${describeLocator(l)} within ${timeout}ms`);
    r.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return r;
  };
  try {
    switch (action.type) {
      case 'click': {
        const r = await need(action.locator);
        const d = r.el as HTMLButtonElement;
        if (d.disabled) throw new Error(`${describeLocator(action.locator)} is disabled`);
        dispatchPointerClick(r.el);
        // Extra clicks of a double-click land in the same task, before the page can re-render.
        for (let i = 1; i < Math.min(3, action.clickCount ?? 1); i++) dispatchPointerClick(r.el);
        if ((action.clickCount ?? 1) > 1) r.el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, composed: true, view: window }));
        return done(true, undefined, r.strategy);
      }
      case 'fill': {
        const r = await need(action.locator);
        const el = r.el as HTMLInputElement;
        el.focus();
        setNativeValue(el, action.value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return done(true, undefined, r.strategy);
      }
      case 'focus': {
        const r = await need(action.locator);
        (r.el as HTMLElement).focus();
        return done(true, undefined, r.strategy);
      }
      case 'select': {
        const r = await need(action.locator);
        const el = r.el as HTMLSelectElement;
        el.value = action.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return done(true, undefined, r.strategy);
      }
      case 'check': {
        const r = await need(action.locator);
        const el = r.el as HTMLInputElement;
        if (el.checked !== action.checked) dispatchPointerClick(el);
        return done(true, undefined, r.strategy);
      }
      case 'press': {
        let target: Element = document.activeElement ?? document.body;
        let strategy: string | undefined;
        if (action.locator) {
          const r = await need(action.locator);
          target = r.el;
          strategy = r.strategy;
          if (document.activeElement !== target) (target as HTMLElement).focus?.();
        }
        const key = action.key.replace(/^Shift\+/, '');
        const shift = action.key.startsWith('Shift+');
        const kKey = key === 'Space' ? ' ' : key;
        const init = { key: kKey, code: key === 'Space' ? 'Space' : key, bubbles: true, cancelable: true, shiftKey: shift };
        const notPrevented = target.dispatchEvent(new KeyboardEvent('keydown', init));
        target.dispatchEvent(new KeyboardEvent('keyup', init));
        // Synthetic key events have no default action, so emulate the important ones.
        if (notPrevented) {
          if (key === 'Tab') moveFocus(shift);
          else if (key === 'Enter') {
            const form = (target as HTMLInputElement).form;
            if (form && target.tagName === 'INPUT') form.requestSubmit();
            else if (/^(BUTTON|A)$/.test(target.tagName) || target.getAttribute('role') === 'button') (target as HTMLElement).click();
          } else if (kKey === ' ' && (target.tagName === 'BUTTON' || target.getAttribute('role') === 'button' || (target as HTMLInputElement).type === 'checkbox')) {
            (target as HTMLElement).click();
          }
        }
        return done(true, undefined, strategy);
      }
      case 'navigate': {
        if (action.url.startsWith('#')) location.hash = action.url;
        else location.href = action.url;
        return done(true);
      }
      case 'wait': {
        if (action.condition.kind === 'delay') {
          await sleep(action.condition.ms);
          return done(true);
        }
        const ok = await waitFor(() => checkWait(action.condition), action.timeout || timeout);
        return ok ? done(true) : done(false, `Timed out waiting for ${JSON.stringify(action.condition)}`);
      }
      case 'assert': {
        let err: string | null = null;
        // Assertions retry briefly to absorb rendering latency.
        const ok = await waitFor(() => {
          err = checkAssertion(action.assertion);
          return err === null;
        }, Math.min(timeout, 2000));
        return ok ? done(true) : done(false, err ?? 'Assertion failed');
      }
      default:
        // viewport / fold / screenshot are executed by the studio.
        return done(true);
    }
  } catch (e) {
    return done(false, (e as Error).message);
  }
}
