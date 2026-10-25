import { MOD, type RemoteInput } from '../../src/modules/preview-runtime/remote/protocol';
import type { W3CActionSource } from './webdriver';

/**
 * Studio input -> iOS. The studio streams low-level events (pointer down/move/up,
 * wheel, keys); iOS automation wants whole gestures. `InputMapper` turns the
 * stream into semantic jobs, which are then expressed either as W3C WebDriver
 * actions (safaridriver) or `idb ui` commands (simctl fallback).
 *
 * Gestures are sent once the finger lifts: implementations differ in whether
 * pointer state survives between Perform Actions calls, so one call per gesture
 * is the portable choice (a drag scrolls when released, not live).
 */

export type GesturePoint = { x: number; y: number; t: number };
export type Gesture = { points: GesturePoint[] };

export type InputJob =
  | { kind: 'gesture'; gesture: Gesture }
  | { kind: 'scroll'; x: number; y: number; dx: number; dy: number }
  | { kind: 'key'; key: string; modifiers: number }
  | { kind: 'text'; text: string };

const MAX_POINTS = 600;
const WHEEL_SETTLE_MS = 70;
const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

export class InputMapper {
  private gesture: { id: number | 'mouse'; points: GesturePoint[] } | null = null;
  private wheel: { x: number; y: number; dx: number; dy: number } | null = null;
  private wheelTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly emit: (job: InputJob) => void,
    private readonly now: () => number = Date.now,
  ) {}

  push(ev: RemoteInput) {
    if (!ev || typeof ev !== 'object') return;
    switch (ev.kind) {
      case 'touch': {
        const pts = Array.isArray(ev.points) ? ev.points : [];
        if (ev.type === 'start') {
          // Only the first finger is driven (multi-touch gestures are not supported yet).
          if (this.gesture || !pts.length) return;
          this.begin(Math.round(num(pts[0].id)), pts[0].x, pts[0].y);
        } else if (ev.type === 'move') {
          const g = this.gesture;
          if (!g) return;
          const p = pts.find((q) => Math.round(num(q.id)) === g.id);
          if (p) this.move(p.x, p.y);
          // The tracked finger lifted while others stay down: finish its gesture.
          else this.finish();
        } else if (ev.type === 'end') this.finish();
        else this.gesture = null;
        return;
      }
      case 'mouse': {
        // iOS has no hover: only left-button drags become touches.
        if (ev.type === 'down' && ev.button === 'left' && !this.gesture) this.begin('mouse', ev.x, ev.y);
        else if (ev.type === 'move' && this.gesture?.id === 'mouse' && num(ev.buttons) & 1) this.move(ev.x, ev.y);
        else if (ev.type === 'up' && this.gesture?.id === 'mouse') {
          this.move(ev.x, ev.y);
          this.finish();
        }
        return;
      }
      case 'wheel': {
        const w = this.wheel ?? { x: num(ev.x), y: num(ev.y), dx: 0, dy: 0 };
        w.dx += Math.max(-5000, Math.min(5000, num(ev.deltaX)));
        w.dy += Math.max(-5000, Math.min(5000, num(ev.deltaY)));
        this.wheel = w;
        if (this.wheelTimer) clearTimeout(this.wheelTimer);
        this.wheelTimer = setTimeout(() => this.flushWheel(), WHEEL_SETTLE_MS);
        return;
      }
      case 'key': {
        if (ev.type !== 'down' || typeof ev.key !== 'string' || !ev.key) return;
        this.emit({ kind: 'key', key: ev.key.slice(0, 32), modifiers: Math.max(0, Math.min(15, Math.round(num(ev.modifiers)))) });
        return;
      }
      case 'char':
      case 'insertText':
        if (typeof ev.text === 'string' && ev.text) this.emit({ kind: 'text', text: ev.text.slice(0, 10_000) });
        return;
    }
  }

  flushWheel() {
    if (this.wheelTimer) clearTimeout(this.wheelTimer);
    this.wheelTimer = null;
    const w = this.wheel;
    this.wheel = null;
    if (w && (Math.abs(w.dx) >= 1 || Math.abs(w.dy) >= 1)) this.emit({ kind: 'scroll', x: w.x, y: w.y, dx: Math.round(w.dx), dy: Math.round(w.dy) });
  }

  dispose() {
    if (this.wheelTimer) clearTimeout(this.wheelTimer);
    this.wheelTimer = null;
    this.wheel = null;
    this.gesture = null;
  }

  private begin(id: number | 'mouse', x: number, y: number) {
    this.gesture = { id, points: [{ x: num(x), y: num(y), t: this.now() }] };
  }

  private move(x: number, y: number) {
    const g = this.gesture;
    if (!g) return;
    if (g.points.length >= MAX_POINTS) g.points.splice(1, 1);
    g.points.push({ x: num(x), y: num(y), t: this.now() });
  }

  private finish() {
    const g = this.gesture;
    this.gesture = null;
    if (!g) return;
    g.points.push({ ...g.points[g.points.length - 1], t: this.now() });
    this.emit({ kind: 'gesture', gesture: { points: g.points } });
  }
}

/* ------------------------------------------------------------------ */
/* W3C actions (safaridriver)                                          */
/* ------------------------------------------------------------------ */

/** Keep at most `max` points, evenly spaced, always including the first and last. */
export function simplify(points: GesturePoint[], max = 40): GesturePoint[] {
  if (points.length <= max) return points;
  const out: GesturePoint[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round((i * (points.length - 1)) / (max - 1))]);
  return out;
}

const clampTo = (v: number, size: number) => Math.max(0, Math.min(Math.max(0, Math.floor(size) - 1), Math.round(v)));

/**
 * One finger: move to the start, press, follow the path with the original timing
 * (bounded), keep a long press long, lift. Coordinates are viewport CSS px,
 * clamped inside the viewport (WebDriver rejects out-of-bounds moves).
 */
export function gestureToActions(g: Gesture, viewport: { width: number; height: number }): W3CActionSource {
  const pts = simplify(g.points);
  const first = pts[0];
  const actions: Record<string, unknown>[] = [
    { type: 'pointerMove', duration: 0, origin: 'viewport', x: clampTo(first.x, viewport.width), y: clampTo(first.y, viewport.height) },
    { type: 'pointerDown', button: 0 },
  ];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const dt = Math.max(0, Math.min(1000, Math.round(p.t - pts[i - 1].t)));
    const moved = p.x !== pts[i - 1].x || p.y !== pts[i - 1].y;
    if (moved) actions.push({ type: 'pointerMove', duration: dt, origin: 'viewport', x: clampTo(p.x, viewport.width), y: clampTo(p.y, viewport.height) });
    else if (dt > 0) actions.push({ type: 'pause', duration: Math.min(2000, dt) });
  }
  actions.push({ type: 'pointerUp', button: 0 });
  return { type: 'pointer', id: 'ifdy-finger', parameters: { pointerType: 'touch' }, actions };
}

/** WebDriver's code points for non-printable keys (W3C WebDriver §17.4.2). */
export const WEBDRIVER_KEYS: Record<string, string> = {
  Cancel: '',
  Help: '',
  Backspace: '',
  Tab: '',
  Clear: '',
  Enter: '',
  Shift: '',
  Control: '',
  Alt: '',
  Pause: '',
  Escape: '',
  ' ': '',
  PageUp: '',
  PageDown: '',
  End: '',
  Home: '',
  ArrowLeft: '',
  ArrowUp: '',
  ArrowRight: '',
  ArrowDown: '',
  Insert: '',
  Delete: '',
  Meta: '',
};

const MODIFIER_KEYS: [number, string][] = [
  [MOD.shift, WEBDRIVER_KEYS.Shift],
  [MOD.ctrl, WEBDRIVER_KEYS.Control],
  [MOD.alt, WEBDRIVER_KEYS.Alt],
  [MOD.meta, WEBDRIVER_KEYS.Meta],
];

const isPrintable = (key: string) => [...key].length === 1;

/** A key press as one key-source sequence, wrapped in its modifiers. Unknown named keys -> null. */
export function keyToActions(key: string, modifiers: number): W3CActionSource | null {
  if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta' || key === 'CapsLock') return null;
  const value = WEBDRIVER_KEYS[key] ?? (isPrintable(key) ? key : null);
  if (!value) return null;
  // Shift is already folded into printable characters ("A", "!").
  const mods = MODIFIER_KEYS.filter(([bit, k]) => modifiers & bit && !(isPrintable(key) && k === WEBDRIVER_KEYS.Shift)).map(([, k]) => k);
  const actions: Record<string, unknown>[] = [];
  for (const m of mods) actions.push({ type: 'keyDown', value: m });
  actions.push({ type: 'keyDown', value }, { type: 'keyUp', value });
  for (const m of [...mods].reverse()) actions.push({ type: 'keyUp', value: m });
  return { type: 'key', id: 'ifdy-keyboard', actions };
}

/** Typed text as key sequences, chunked so no single WebDriver call runs too long. */
export function textToActions(text: string, chunk = 200): W3CActionSource[] {
  const chars = [...text];
  const out: W3CActionSource[] = [];
  for (let i = 0; i < chars.length; i += chunk) {
    const actions: Record<string, unknown>[] = [];
    for (const c of chars.slice(i, i + chunk)) {
      const v = c === '\n' ? WEBDRIVER_KEYS.Enter : c;
      actions.push({ type: 'keyDown', value: v }, { type: 'keyUp', value: v });
    }
    out.push({ type: 'key', id: 'ifdy-keyboard', actions });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* idb (simctl fallback)                                               */
/* ------------------------------------------------------------------ */

/** USB HID usage ids for `idb ui key`. */
const HID_KEYS: Record<string, number> = {
  Enter: 40,
  Escape: 41,
  Backspace: 42,
  Tab: 43,
  ' ': 44,
  Delete: 76,
  ArrowRight: 79,
  ArrowLeft: 80,
  ArrowDown: 81,
  ArrowUp: 82,
};

const TAP_SLOP = 8;
const LONG_PRESS_MS = 500;
const r1 = (n: number) => String(Math.round(n));
const secs = (ms: number) => (Math.max(0.05, ms / 1000)).toFixed(2);

/** `idb` argument arrays (never a shell string) for one job. Coordinates are screen points. */
export function jobToIdb(job: InputJob, udid: string): string[][] {
  const target = ['--udid', udid];
  switch (job.kind) {
    case 'gesture': {
      const pts = job.gesture.points;
      const a = pts[0];
      const b = pts[pts.length - 1];
      const ms = b.t - a.t;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (dist < TAP_SLOP) {
        return [['ui', 'tap', r1(a.x), r1(a.y), ...(ms >= LONG_PRESS_MS ? ['--duration', secs(ms)] : []), ...target]];
      }
      return [['ui', 'swipe', r1(a.x), r1(a.y), r1(b.x), r1(b.y), '--duration', secs(Math.min(ms, 2000)), ...target]];
    }
    case 'scroll': {
      // Content follows the finger: scrolling down means swiping up. Kept short and on-screen.
      const dx = Math.max(-300, Math.min(300, job.dx));
      const dy = Math.max(-300, Math.min(300, job.dy));
      return [['ui', 'swipe', r1(job.x), r1(job.y), r1(job.x - dx), r1(job.y - dy), '--duration', '0.15', ...target]];
    }
    case 'key': {
      const code = HID_KEYS[job.key];
      if (code !== undefined) return [['ui', 'key', String(code), ...target]];
      if (isPrintable(job.key) && !(job.modifiers & (MOD.ctrl | MOD.meta | MOD.alt))) return [['ui', 'text', ...target, '--', job.key]];
      return [];
    }
    case 'text':
      // `--` so text starting with "-" is never read as an option.
      return [['ui', 'text', ...target, '--', job.text]];
  }
}
