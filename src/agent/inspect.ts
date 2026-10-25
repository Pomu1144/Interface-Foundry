import type { AgentEvents, InspectMode } from '@shared/protocol';
import type { NodeId, Rect } from '@shared/types';
import { elementOf, idOf, isIfdyNode, labelFor, rectOf, uniqueSelector } from './nodes';

type Emit = <E extends keyof AgentEvents>(event: E, payload: AgentEvents[E]) => void;

/**
 * Inspect mode makes the page inert: pointer events are captured and turned into
 * hover/select events for the studio. Interact mode leaves the page fully usable.
 */
export class Inspector {
  mode: InspectMode = 'interact';
  private watched: NodeId[] = [];
  private lastRects = '';
  private rafPending = false;
  private hoverPending: Element | null = null;
  private editing: { el: HTMLElement; before: string; prevEditable: string | null } | null = null;

  constructor(private emit: Emit) {
    const block = (e: Event) => {
      if (this.mode !== 'inspect') return;
      if (this.editing && this.editing.el.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'contextmenu', 'touchstart', 'touchend', 'auxclick', 'submit', 'dragstart']) {
      window.addEventListener(type, block, { capture: true, passive: false });
    }
    window.addEventListener(
      'click',
      (e) => {
        if (this.mode !== 'inspect') return;
        if (this.editing && this.editing.el.contains(e.target as Node)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const el = this.pick(e);
        if (el) this.emit('select', { id: idOf(el), rect: rectOf(el), label: labelFor(el), additive: e.shiftKey });
      },
      { capture: true },
    );
    window.addEventListener(
      'dblclick',
      (e) => {
        if (this.mode !== 'inspect') return;
        if (this.editing && this.editing.el.contains(e.target as Node)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const el = this.pick(e);
        if (el) this.emit('dblselect', { id: idOf(el) });
      },
      { capture: true },
    );
    window.addEventListener(
      'pointermove',
      (e) => {
        if (this.mode !== 'inspect') return;
        this.hoverPending = this.pick(e);
        if (!this.rafPending) {
          this.rafPending = true;
          requestAnimationFrame(() => {
            this.rafPending = false;
            const el = this.hoverPending;
            this.emit('hover', el ? { id: idOf(el), rect: rectOf(el), label: labelFor(el) } : { id: null, rect: null, label: '' });
          });
        }
      },
      { capture: true, passive: true },
    );
    document.addEventListener('pointerleave', () => {
      if (this.mode === 'inspect') this.emit('hover', { id: null, rect: null, label: '' });
    });

    // Rect tracking for overlays.
    const schedule = () => this.scheduleRects();
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    setInterval(schedule, 400);

    // Forward studio shortcuts and canvas zoom gestures.
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.editing) {
          if (e.key === 'Escape') {
            e.preventDefault();
            this.finishEdit(true);
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.finishEdit(false);
          }
          return;
        }
        const mod = e.metaKey || e.ctrlKey;
        const studioCombo = mod && ['k', 's', '\\', 'j', 'i', 'b', '.', '0', '=', '-', '+'].includes(e.key.toLowerCase());
        if (this.mode === 'inspect' || studioCombo) {
          if (this.mode === 'inspect' || studioCombo) e.preventDefault();
          this.emit('key', { key: e.key, code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
        }
      },
      { capture: true },
    );
    window.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.emit('wheel', { deltaX: e.deltaX, deltaY: e.deltaY, ctrl: true, clientX: e.clientX, clientY: e.clientY });
        }
      },
      { passive: false, capture: true },
    );
  }

  private pick(e: MouseEvent | PointerEvent): Element | null {
    let el = document.elementFromPoint(e.clientX, e.clientY);
    while (el && isIfdyNode(el)) el = el.parentElement;
    if (!el || el === document.documentElement) return null;
    return el;
  }

  setMode(mode: InspectMode) {
    this.mode = mode;
    document.documentElement.toggleAttribute('data-ifdy-inspecting', mode === 'inspect');
    if (mode === 'interact') this.emit('hover', { id: null, rect: null, label: '' });
  }

  watch(ids: NodeId[]) {
    this.watched = ids;
    this.lastRects = '';
    this.scheduleRects();
  }

  scheduleRects() {
    if (!this.watched.length) return;
    requestAnimationFrame(() => {
      const rects: Record<NodeId, Rect | null> = {};
      for (const id of this.watched) {
        const el = elementOf(id);
        rects[id] = el && el.isConnected ? rectOf(el) : null;
      }
      const key = JSON.stringify(rects) + scrollX + ',' + scrollY;
      if (key === this.lastRects) return;
      this.lastRects = key;
      this.emit('rects', { rects, scroll: { x: scrollX, y: scrollY } });
    });
  }

  beginEdit(id: NodeId): { before: string } | null {
    const el = elementOf(id) as HTMLElement | null;
    if (!el || !(el instanceof HTMLElement)) return null;
    if ([...el.children].length > 0) return null;
    this.finishEdit(false);
    const before = el.textContent ?? '';
    const prevEditable = el.getAttribute('contenteditable');
    try {
      el.contentEditable = 'plaintext-only';
    } catch {
      el.contentEditable = 'true';
    }
    el.setAttribute('data-ifdy-editing', '');
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    this.editing = { el, before, prevEditable };
    el.addEventListener('blur', () => this.finishEdit(false), { once: true });
    return { before };
  }

  finishEdit(cancel: boolean) {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    const { el, before, prevEditable } = ed;
    if (prevEditable === null) el.removeAttribute('contenteditable');
    else el.setAttribute('contenteditable', prevEditable);
    el.removeAttribute('data-ifdy-editing');
    if (cancel) {
      el.textContent = before;
      return;
    }
    const after = el.textContent ?? '';
    if (after !== before) {
      // The studio re-applies the text as a DOM patch, which makes it undoable.
      el.textContent = before;
      this.emit('text.edited', { id: idOf(el), selector: uniqueSelector(el), before, after });
    }
  }
}
