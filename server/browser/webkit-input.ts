/**
 * Pure input mapping for the WebKit engine (no CDP: Playwright's mouse,
 * keyboard and touchscreen only). No Playwright imports so this is unit-testable.
 */
import { MOD, type MouseButtonName, type TouchPoint, type VisualViewport } from '../../src/modules/preview-runtime/remote/protocol';

/** Playwright only knows three mouse buttons; back/forward have no equivalent. */
export function mouseButton(name: MouseButtonName): 'left' | 'middle' | 'right' | null {
  return name === 'left' || name === 'middle' || name === 'right' ? name : null;
}

const MODIFIER_KEYS: [number, string][] = [
  [MOD.alt, 'Alt'],
  [MOD.ctrl, 'Control'],
  [MOD.meta, 'Meta'],
  [MOD.shift, 'Shift'],
];

/**
 * Playwright's mouse takes its modifiers from the keyboard state, so a shift-click whose
 * Shift keydown never reached the page (the studio input was not focused yet) needs the
 * modifier pressed first. Returns the keys to press / release so the held set matches `mask`.
 */
export function modifierChanges(held: ReadonlySet<string>, mask: number): { press: string[]; release: string[] } {
  const press: string[] = [];
  const release: string[] = [];
  for (const [bit, key] of MODIFIER_KEYS) {
    const want = (mask & bit) !== 0;
    if (want && !held.has(key)) press.push(key);
    else if (!want && held.has(key)) release.push(key);
  }
  return { press, release };
}

/**
 * A key Playwright's US layout does not know (é, ß, dead keys, non-Latin): type the character
 * on keydown instead, unless Ctrl/Meta is held (shortcuts never produce text). Returns the text
 * to insert, or null when the key should be dropped.
 */
export function unknownKeyText(key: string, type: 'down' | 'up', modifiers: number): string | null {
  if (type !== 'down' || modifiers & (MOD.ctrl | MOD.meta)) return null;
  return [...key].length === 1 ? key : null;
}

/**
 * Playwright's touchscreen takes visual-viewport (screen) coordinates, while the studio sends
 * layout CSS px like the mouse. They differ on zoomed-out mobile pages without a meta viewport.
 */
export function toScreenPoint(p: { x: number; y: number }, visual: VisualViewport | null): { x: number; y: number } {
  if (!visual || !(visual.scale > 0)) return { x: p.x, y: p.y };
  return { x: (p.x - visual.offsetX) * visual.scale, y: (p.y - visual.offsetY) * visual.scale };
}

export type GestureAction = { type: 'tap'; x: number; y: number } | { type: 'pan'; x: number; y: number; dx: number; dy: number };

/**
 * Turns the studio's touch stream into what WebKit can do without CDP touch injection
 * (WebKit has no `Input.dispatchTouchEvent` and the page cannot construct `Touch` objects):
 *  - start + end without movement → a real tap (`touchscreen.tap`: touchstart/touchend + click),
 *  - movement past the slop → panning: the content under the finger scrolls by the finger delta
 *    (page touchmove handlers do not see it: swipe carousels and custom gestures will not react),
 *  - a second finger (pinch) is ignored.
 */
export class TouchGesture {
  private start: { x: number; y: number; id: number } | null = null;
  private last: { x: number; y: number } | null = null;
  private panning = false;
  private multi = false;

  constructor(private readonly slop = 8) {}

  feed(type: 'start' | 'move' | 'end' | 'cancel', points: TouchPoint[]): GestureAction[] {
    if (type === 'cancel') {
      this.reset();
      return [];
    }
    if (type === 'start') {
      if (this.start || points.length > 1) {
        // A second finger: not a tap, and pinch zoom is not emulated.
        this.multi = true;
        return [];
      }
      const p = points[0];
      if (!p) return [];
      this.start = { x: p.x, y: p.y, id: p.id };
      this.last = { x: p.x, y: p.y };
      this.panning = false;
      this.multi = false;
      return [];
    }
    if (!this.start) return [];
    if (type === 'move') {
      if (this.multi) return [];
      const p = points.find((q) => q.id === this.start!.id) ?? points[0];
      if (!p) return [];
      if (!this.panning && Math.hypot(p.x - this.start.x, p.y - this.start.y) < this.slop) return [];
      this.panning = true;
      const from = this.last!;
      this.last = { x: p.x, y: p.y };
      const dx = from.x - p.x;
      const dy = from.y - p.y;
      return dx || dy ? [{ type: 'pan', x: this.start.x, y: this.start.y, dx, dy }] : [];
    }
    // end
    const tap = !this.panning && !this.multi;
    const at = this.start;
    this.reset();
    return tap ? [{ type: 'tap', x: at.x, y: at.y }] : [];
  }

  private reset() {
    this.start = null;
    this.last = null;
    this.panning = false;
    this.multi = false;
  }
}
