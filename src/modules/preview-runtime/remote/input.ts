import { MOD, type MouseButtonName } from './protocol';

/**
 * Pure input helpers for the streamed Chromium canvas: coordinate mapping,
 * modifiers, click counting, wheel normalisation and screencast sizing.
 */

export type Box = { left: number; top: number; width: number; height: number };

/**
 * Map a client (screen) point onto the remote page's CSS coordinate space.
 * `box` is the canvas' on-screen rect (after any CSS transforms such as the
 * canvas zoom or a wall tile's scale); `css` is the canvas' CSS (layout) size.
 */
export function mapPoint(clientX: number, clientY: number, box: Box, css: { width: number; height: number }, offset = { x: 0, y: 0 }) {
  const sx = box.width > 0 ? css.width / box.width : 1;
  const sy = box.height > 0 ? css.height / box.height : 1;
  const x = (clientX - box.left) * sx;
  const y = (clientY - box.top) * sy;
  return {
    x: Math.round(Math.min(css.width, Math.max(0, x)) * 100) / 100 + offset.x,
    y: Math.round(Math.min(css.height, Math.max(0, y)) * 100) / 100 + offset.y,
    inside: x >= 0 && y >= 0 && x <= css.width && y <= css.height,
  };
}

export function modifiersOf(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number {
  return (e.altKey ? MOD.alt : 0) | (e.ctrlKey ? MOD.ctrl : 0) | (e.metaKey ? MOD.meta : 0) | (e.shiftKey ? MOD.shift : 0);
}

/** DOM `MouseEvent.button` -> CDP button name. */
export function buttonName(button: number): MouseButtonName {
  switch (button) {
    case 0:
      return 'left';
    case 1:
      return 'middle';
    case 2:
      return 'right';
    case 3:
      return 'back';
    case 4:
      return 'forward';
    default:
      return 'none';
  }
}

/** Counts consecutive clicks (double/triple click) the way browsers do. */
export class ClickTracker {
  private last: { x: number; y: number; t: number; button: number; count: number } | null = null;
  constructor(
    private readonly interval = 500,
    private readonly slop = 5,
  ) {}
  down(x: number, y: number, button: number, t: number): number {
    const l = this.last;
    const count = l && l.button === button && t - l.t <= this.interval && Math.hypot(x - l.x, y - l.y) <= this.slop ? Math.min(3, l.count + 1) : 1;
    this.last = { x, y, t, button, count };
    return count;
  }
  /** Click count for the matching mouseup. */
  current(): number {
    return this.last?.count ?? 1;
  }
}

/** Normalise a WheelEvent delta to CSS pixels. */
export function normalizeWheel(e: { deltaX: number; deltaY: number; deltaMode: number; shiftKey?: boolean }, pageHeight: number): { dx: number; dy: number } {
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? Math.max(100, pageHeight * 0.9) : 1;
  let dx = e.deltaX * k;
  let dy = e.deltaY * k;
  // Shift + vertical wheel scrolls horizontally on Windows/Linux.
  if (e.shiftKey && !dx) {
    dx = dy;
    dy = 0;
  }
  return { dx, dy };
}

/**
 * Screencast size for a canvas: displayed size × the studio's device pixel ratio,
 * capped at the emulated device's own resolution, quantised so small zoom changes
 * do not restart the stream.
 */
export function screencastSize(opts: { cssWidth: number; cssHeight: number; displayScale: number; screenDpr: number; deviceDpr: number }) {
  const { cssWidth, cssHeight } = opts;
  const want = Math.max(0.05, opts.displayScale) * Math.max(1, opts.screenDpr);
  const k = Math.min(Math.max(0.1, opts.deviceDpr), quantize(want));
  const maxWidth = Math.max(160, Math.round(cssWidth * k));
  const maxHeight = Math.max(160, Math.round(cssHeight * k));
  return { maxWidth: Math.min(4096, maxWidth), maxHeight: Math.min(4096, maxHeight), scale: k };
}

/** Round a scale up to the next step of a 1.25× ladder (…0.41, 0.51, 0.64, 0.8, 1, 1.25, 1.56…). */
export function quantize(scale: number): number {
  const step = Math.ceil(Math.log(scale) / Math.log(1.25) - 1e-9);
  return Math.round(Math.pow(1.25, step) * 1000) / 1000;
}

/** Keys that the studio keeps for itself instead of forwarding (handled via clipboard events). */
export function isPasteShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey?: boolean }): boolean {
  return (e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V');
}

/** IME composition in progress: the textarea owns these keys until compositionend. */
export function isComposingKey(e: { isComposing?: boolean; keyCode?: number; key?: string }): boolean {
  return Boolean(e.isComposing) || e.keyCode === 229 || e.key === 'Process';
}
