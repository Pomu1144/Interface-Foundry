/**
 * Imperative scene controller for the 3D view hierarchy.
 *
 * React renders the planes once (memoised); everything that changes per
 * frame — camera, layer spacing, screen-space labels, tooltip position, HUD —
 * is written straight to the DOM from a requestAnimationFrame loop that only
 * runs while something is moving.
 */
import type { Hierarchy3DNode } from '@shared/protocol';
import {
  approach,
  boundsCorners,
  clampPitch,
  clampZoom,
  decay,
  fitBounds,
  fitPoints,
  hairline,
  matrixCss,
  nearestAngle,
  PRESETS,
  projectWith,
  worldMatrix,
  wrapAngle,
  wrapperCss,
  zoomAbout,
  type Angles,
  type Bounds,
  type Camera,
  type Insets,
  type Mat4,
  type PresetName,
  type Vec3,
} from './math';

export type LabelSpec = { i: number; x: number; y: number; w: number; depth: number };

type Drag = {
  mode: 'orbit' | 'pan';
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastT: number;
  moved: boolean;
  target: number | null;
};

type Callbacks = {
  onPick: (index: number | null) => void;
  onFocusRequest: (index: number | null) => void;
  onHover: (index: number | null) => void;
};

const TAU_CAMERA = 120;
const TAU_SPACING = 140;
const TAU_INERTIA = 340;
const ORBIT_SPEED = 0.32; // degrees per px
const DEFAULT_SPACING = 36;
/** Floating chrome over the stage that fits should avoid. */
export const STAGE_INSETS: Insets = { top: 40, right: 8, bottom: 58, left: 8 };

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class HierarchyEngine {
  cam: Camera = { yaw: PRESETS.right.yaw, pitch: PRESETS.right.pitch, zoom: 0.5, panX: 0, panY: 0, tx: 0, ty: 0, td: 0 };
  /** Last non-front angles, restored by "Explode". */
  lastAngles: Angles = { ...PRESETS.right };
  spacing = 0;
  private spacingGoal = DEFAULT_SPACING;
  private goal: Camera | null = null;
  private vel = { yaw: 0, pitch: 0 };
  private perspective = 2400;
  private bounds: Bounds | null = null;
  private baseDepth = -1;
  private sceneKey = '';
  private hasCamera = false;
  noMotion = false;

  private stage: HTMLElement | null = null;
  private pan: HTMLElement | null = null;
  private world: HTMLElement | null = null;
  private tip: HTMLElement | null = null;
  private hudZoom: HTMLElement | null = null;
  private hudAngles: HTMLElement | null = null;
  private base: HTMLElement | null = null;
  private grid: HTMLElement | null = null;
  private layers = new Map<number, HTMLElement>();
  private labelSpecs: LabelSpec[] = [];
  private labelEls: HTMLElement[] = [];
  private labelSizes: { w: number; h: number }[] = [];
  private labelState: string[] = [];

  private nodes: readonly Hierarchy3DNode[] = [];
  private cb: Callbacks = { onPick: () => {}, onFocusRequest: () => {}, onHover: () => {} };
  private view = { width: 1, height: 1, left: 0, top: 0 };
  private raf = 0;
  private lastT = 0;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private written = { pan: '', world: '', persp: '', spacing: NaN, bw: '', detail: '', zoom: '', angles: '' };
  private drag: Drag | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; zoom: number; panX: number; panY: number; mx: number; my: number } | null = null;
  private hoverIndex: number | null = null;
  private hoverEl: HTMLElement | null = null;
  private hlDepth: number | null = null;
  private spaceDown = false;
  private ro: ResizeObserver | null = null;
  private detach: (() => void) | null = null;

  /* ---------------------------------------------------------------- */
  /* Wiring                                                            */
  /* ---------------------------------------------------------------- */

  attach(els: { stage: HTMLElement; pan: HTMLElement; world: HTMLElement; tip: HTMLElement; hudZoom: HTMLElement | null; hudAngles: HTMLElement | null }, cb: Callbacks) {
    this.detach?.();
    Object.assign(this, els);
    this.cb = cb;
    this.written = { pan: '', world: '', persp: '', spacing: NaN, bw: '', detail: '', zoom: '', angles: '' };
    this.labelState = [];
    const stage = els.stage;
    const measure = () => {
      const r = stage.getBoundingClientRect();
      this.view = { width: Math.max(1, r.width), height: Math.max(1, r.height), left: r.left, top: r.top };
    };
    measure();
    this.ro = new ResizeObserver(() => {
      measure();
      this.kick();
    });
    this.ro.observe(stage);

    const down = (e: PointerEvent) => this.onPointerDown(e);
    const move = (e: PointerEvent) => this.onPointerMove(e);
    const up = (e: PointerEvent) => this.onPointerUp(e);
    const leave = () => this.setHover(null, null);
    const wheel = (e: WheelEvent) => this.onWheel(e);
    const dbl = (e: MouseEvent) => {
      const i = this.indexAt(e.target);
      this.cb.onFocusRequest(i);
    };
    const keydown = (e: KeyboardEvent) => {
      if (e.key === ' ') this.spaceDown = true;
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.key === ' ') this.spaceDown = false;
    };
    const ctx = (e: MouseEvent) => e.preventDefault();
    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('pointerleave', leave);
    stage.addEventListener('wheel', wheel, { passive: false });
    stage.addEventListener('dblclick', dbl);
    stage.addEventListener('contextmenu', ctx);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    this.detach = () => {
      stage.removeEventListener('pointerdown', down);
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      stage.removeEventListener('pointercancel', up);
      stage.removeEventListener('pointerleave', leave);
      stage.removeEventListener('wheel', wheel);
      stage.removeEventListener('dblclick', dbl);
      stage.removeEventListener('contextmenu', ctx);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
    };
    this.kick();
  }

  release() {
    this.detach?.();
    this.detach = null;
    this.ro?.disconnect();
    this.ro = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.lastT = 0;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    // Layers, base and grid are owned by their own ref callbacks.
    this.stage = this.pan = this.world = this.tip = this.hudZoom = this.hudAngles = null;
    this.labelEls = [];
    this.hoverEl = null;
    this.hoverIndex = null;
    this.drag = null;
    this.pointers.clear();
  }

  /** Ref callback for a depth layer (returns the React 19 ref cleanup). */
  layerRef(depth: number, el: HTMLElement | null) {
    if (!el) return;
    this.layers.set(depth, el);
    el.style.transform = `translate3d(0,0,${this.round(depth * this.spacing)}px)`;
    if (this.hlDepth === depth) el.setAttribute('data-hl', '');
    return () => {
      if (this.layers.get(depth) === el) this.layers.delete(depth);
    };
  }

  baseRef(el: HTMLElement | null) {
    if (!el) return;
    this.base = el;
    this.written.spacing = NaN;
    this.kick();
    return () => {
      if (this.base === el) this.base = null;
    };
  }

  gridRef(el: HTMLElement | null) {
    if (!el) return;
    this.grid = el;
    this.written.spacing = NaN;
    this.kick();
    return () => {
      if (this.grid === el) this.grid = null;
    };
  }

  setNodes(nodes: readonly Hierarchy3DNode[]) {
    this.nodes = nodes;
    this.setHover(null, null);
  }

  /** Labels drawn in screen space; `els` and `sizes` are in the same order as `specs`. */
  setLabels(specs: LabelSpec[], els: HTMLElement[], sizes: { w: number; h: number }[]) {
    this.labelSpecs = specs;
    this.labelEls = els;
    this.labelSizes = sizes;
    this.labelState = [];
    this.kick();
  }

  /**
   * New scene bounds. Frames it on first use (with the "explode" intro) or when
   * the page changed substantially; otherwise keeps the user's camera.
   */
  setScene(bounds: Bounds, baseDepth: number, key: string, perspective: number, opts: { intro: boolean; exploded: boolean; spacing: number }) {
    const prev = this.bounds;
    this.bounds = bounds;
    this.baseDepth = baseDepth;
    this.perspective = perspective;
    this.written.persp = '';
    this.written.spacing = NaN;
    const changed =
      key !== this.sceneKey ||
      !prev ||
      Math.abs(bounds.x1 - bounds.x0 - (prev.x1 - prev.x0)) > 0.25 * (prev.x1 - prev.x0 || 1) ||
      Math.abs(bounds.y1 - bounds.y0 - (prev.y1 - prev.y0)) > 0.25 * (prev.y1 - prev.y0 || 1);
    this.sceneKey = key;
    const target = opts.exploded ? opts.spacing : 0;
    if (!this.hasCamera) {
      this.hasCamera = true;
      const angles = opts.exploded ? this.lastAngles : PRESETS.front;
      if (opts.intro && opts.exploded && !this.motionOff()) {
        // Open flat and front-on, then explode into the ¾ view.
        this.spacing = 0;
        this.cam = fitBounds(PRESETS.front, bounds, 0, perspective, this.view, STAGE_INSETS, 40);
        this.spacingGoal = target;
        this.goal = fitBounds(angles, bounds, target, perspective, this.view, STAGE_INSETS, 40);
      } else {
        this.spacing = this.spacingGoal = target;
        this.cam = fitBounds(angles, bounds, target, perspective, this.view, STAGE_INSETS, 40);
      }
    } else if (changed) {
      this.goal = fitBounds({ yaw: this.cam.yaw, pitch: this.cam.pitch }, bounds, this.spacingGoal, perspective, this.view, STAGE_INSETS, 40);
    }
    this.kick();
  }

  /* ---------------------------------------------------------------- */
  /* Commands                                                          */
  /* ---------------------------------------------------------------- */

  private motionOff() {
    return this.noMotion || reducedMotion();
  }

  private animateTo(cam: Camera) {
    this.vel = { yaw: 0, pitch: 0 };
    const goal = { ...cam, yaw: nearestAngle(this.cam.yaw, cam.yaw) };
    if (this.motionOff()) {
      this.cam = { ...goal, yaw: wrapAngle(goal.yaw) };
      this.goal = null;
    } else this.goal = goal;
    this.kick();
  }

  /** Current target state (end of any running tween). */
  private settled(): Camera {
    return this.goal ?? this.cam;
  }

  setSpacing(spacing: number, animate: boolean) {
    this.spacingGoal = spacing;
    if (!animate || this.motionOff()) this.spacing = spacing;
    this.kick();
  }

  /** Animate to flat (front, spacing 0) or exploded (last ¾ angles, `spacing`). */
  setExploded(exploded: boolean, spacing: number) {
    if (!this.bounds) return;
    const cur = this.settled();
    if (!exploded) {
      if (Math.abs(cur.yaw) > 1 || Math.abs(cur.pitch) > 1) this.lastAngles = { yaw: wrapAngle(cur.yaw), pitch: cur.pitch };
      this.setSpacing(0, true);
      this.animateTo(fitBounds(PRESETS.front, this.bounds, 0, this.perspective, this.view, STAGE_INSETS, 40));
    } else {
      this.setSpacing(spacing, true);
      const angles = Math.abs(cur.yaw) < 1 && Math.abs(cur.pitch) < 1 ? this.lastAngles : { yaw: cur.yaw, pitch: cur.pitch };
      this.animateTo(fitBounds(angles, this.bounds, spacing, this.perspective, this.view, STAGE_INSETS, 40));
    }
  }

  preset(name: PresetName) {
    if (!this.bounds) return;
    const a = PRESETS[name];
    if (name !== 'front') this.lastAngles = { ...a };
    this.animateTo(fitBounds(a, this.bounds, this.spacingGoal, this.perspective, this.view, STAGE_INSETS, 40));
  }

  /** Frame `b` (defaults to the whole scene) from the current angles, orbiting around its centre. */
  fit(b: Bounds | null = this.bounds) {
    if (!b) return;
    const cur = this.settled();
    this.animateTo(fitBounds({ yaw: cur.yaw, pitch: cur.pitch }, b, this.spacingGoal, this.perspective, this.view, STAGE_INSETS, 40));
  }

  reset() {
    if (!this.bounds) return;
    this.lastAngles = { ...PRESETS.right };
    this.animateTo(fitBounds(PRESETS.right, this.bounds, this.spacingGoal, this.perspective, this.view, STAGE_INSETS, 40));
  }

  /** Orbit around and zoom onto one plane. */
  focusNode(i: number) {
    const n = this.nodes[i];
    if (!n) return;
    const cur = this.settled();
    const z = n.depth * this.spacingGoal;
    const { x, y, width, height } = n.rect;
    const pts: Vec3[] = [
      [x, y, z],
      [x + width, y, z],
      [x, y + height, z],
      [x + width, y + height, z],
    ];
    const base: Camera = { ...cur, tx: x + width / 2, ty: y + height / 2, td: n.depth, zoom: 1, panX: 0, panY: 0 };
    const view = fitPoints(base, this.spacingGoal, this.perspective, pts, this.view, STAGE_INSETS, 72, 6);
    this.animateTo({ ...base, ...view });
  }

  rotateBy(dYaw: number, dPitch: number) {
    const cur = this.settled();
    const next = { ...cur, yaw: cur.yaw + dYaw, pitch: clampPitch(cur.pitch + dPitch) };
    if (Math.abs(next.yaw) > 1 || Math.abs(next.pitch) > 1) this.lastAngles = { yaw: wrapAngle(next.yaw), pitch: next.pitch };
    this.animateTo(next);
  }

  zoomBy(factor: number) {
    const cur = this.settled();
    const my = (STAGE_INSETS.top - STAGE_INSETS.bottom) / 2;
    this.animateTo({ ...cur, ...zoomAbout(cur, factor, 0, my) });
  }

  /** Hover-highlight one depth level (from the rail). */
  highlightDepth(depth: number | null) {
    if (this.hlDepth === depth) return;
    if (this.hlDepth !== null) this.layers.get(this.hlDepth)?.removeAttribute('data-hl');
    this.hlDepth = depth;
    if (depth !== null) this.layers.get(depth)?.setAttribute('data-hl', '');
    if (this.stage) {
      if (depth === null) this.stage.removeAttribute('data-hl');
      else this.stage.setAttribute('data-hl', '');
    }
  }

  /* ---------------------------------------------------------------- */
  /* Input                                                             */
  /* ---------------------------------------------------------------- */

  private local(e: { clientX: number; clientY: number }) {
    const r = this.stage!.getBoundingClientRect();
    this.view.left = r.left;
    this.view.top = r.top;
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private indexAt(target: EventTarget | null): number | null {
    const el = (target as Element | null)?.closest?.('[data-i]') as HTMLElement | null;
    if (!el || !this.stage?.contains(el)) return null;
    const i = Number(el.dataset.i);
    return Number.isFinite(i) ? i : null;
  }

  private onPointerDown(e: PointerEvent) {
    if ((e.target as Element).closest('[data-ui]')) return;
    this.stage?.focus({ preventScroll: true });
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      // Two-finger pinch (touch).
      const [a, b] = [...this.pointers.values()];
      const p = this.local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this.cam.zoom, panX: this.cam.panX, panY: this.cam.panY, mx: p.x - this.view.width / 2, my: p.y - this.view.height / 2 };
      this.drag = null;
      return;
    }
    if (e.button !== 0 && e.button !== 1) return;
    this.goal = null;
    this.vel = { yaw: 0, pitch: 0 };
    const mode = e.button === 1 || e.shiftKey || this.spaceDown ? 'pan' : 'orbit';
    this.drag = { mode, id: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), moved: false, target: this.indexAt(e.target) };
    if (e.button === 1) e.preventDefault();
  }

  private onPointerMove(e: PointerEvent) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const f = Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.dist;
      Object.assign(this.cam, zoomAbout({ zoom: this.pinch.zoom, panX: this.pinch.panX, panY: this.pinch.panY }, f, this.pinch.mx, this.pinch.my));
      this.kick();
      return;
    }
    const d = this.drag;
    if (d && d.id === e.pointerId) {
      const dx = e.clientX - d.lastX;
      const dy = e.clientY - d.lastY;
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 3) return;
      if (!d.moved) {
        d.moved = true;
        this.stage?.setPointerCapture(e.pointerId);
        this.stage?.setAttribute('data-drag', d.mode);
        this.setHover(null, null);
      }
      const now = performance.now();
      const dt = Math.max(1, now - d.lastT);
      if (d.mode === 'orbit') {
        const dyaw = dx * ORBIT_SPEED;
        const dpitch = -dy * ORBIT_SPEED;
        this.cam.yaw += dyaw;
        this.cam.pitch = clampPitch(this.cam.pitch + dpitch);
        // Smoothed angular velocity (deg/ms) for inertia.
        this.vel.yaw = this.vel.yaw * 0.6 + (dyaw / dt) * 0.4;
        this.vel.pitch = this.vel.pitch * 0.6 + (dpitch / dt) * 0.4;
        if (Math.abs(this.cam.yaw) > 1 || Math.abs(this.cam.pitch) > 1) this.lastAngles = { yaw: wrapAngle(this.cam.yaw), pitch: this.cam.pitch };
      } else {
        this.cam.panX += dx;
        this.cam.panY += dy;
      }
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      d.lastT = now;
      this.kick();
      return;
    }
    if (!this.drag) {
      const i = this.indexAt(e.target);
      this.setHover(i, i === null ? null : ((e.target as Element).closest('[data-i]') as HTMLElement));
      if (i !== null) this.placeTip(e);
    }
  }

  private onPointerUp(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    this.stage?.removeAttribute('data-drag');
    if (this.stage?.hasPointerCapture(e.pointerId)) this.stage.releasePointerCapture(e.pointerId);
    if (!d.moved) {
      if (e.button === 0) this.cb.onPick(d.target);
      this.vel = { yaw: 0, pitch: 0 };
      return;
    }
    // Keep spinning only if the pointer was still moving at release.
    if (d.mode !== 'orbit' || performance.now() - d.lastT > 60 || this.motionOff()) this.vel = { yaw: 0, pitch: 0 };
    this.kick();
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    if (!this.stage) return;
    this.goal = null;
    this.vel = { yaw: 0, pitch: 0 };
    const p = this.local(e);
    if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
      this.cam.panX -= e.deltaX || e.deltaY;
      this.cam.panY -= e.deltaX ? e.deltaY : 0;
    } else {
      const unit = e.deltaMode === 1 ? 0.05 : e.ctrlKey || e.metaKey ? 0.01 : 0.0018;
      const f = Math.exp(-Math.max(-60, Math.min(60, e.deltaY * unit * 10)) / 10);
      Object.assign(this.cam, zoomAbout(this.cam, f, p.x - this.view.width / 2, p.y - this.view.height / 2));
    }
    this.kick();
  }

  private setHover(i: number | null, el: HTMLElement | null) {
    if (this.hoverEl && this.hoverEl !== el) this.hoverEl.removeAttribute('data-hover');
    if (el && el !== this.hoverEl) el.setAttribute('data-hover', '');
    this.hoverEl = el;
    if (i === this.hoverIndex) return;
    this.hoverIndex = i;
    this.cb.onHover(i);
    const tip = this.tip;
    if (!tip) return;
    if (i === null) {
      tip.removeAttribute('data-show');
      return;
    }
    const n = this.nodes[i];
    const set = (k: string, v: string) => {
      const t = tip.querySelector<HTMLElement>(`[data-tip="${k}"]`);
      if (t) t.textContent = v;
    };
    set('label', n.label);
    set('dims', `${Math.round(n.rect.width)} × ${Math.round(n.rect.height)}`);
    set('depth', `depth ${n.depth}`);
    set('pos', `${Math.round(n.rect.x)}, ${Math.round(n.rect.y)}`);
    set('text', n.text ? `“${n.text}”` : '');
    set('kind', n.isImage ? 'image' : n.bg === 'image' ? 'bg image' : n.text ? 'text' : '');
    tip.style.setProperty('--tip-t', el?.closest<HTMLElement>('[data-depth]')?.style.getPropertyValue('--t') ?? '0');
    const fill = tip.querySelector<HTMLElement>('[data-tip="fill"]');
    if (fill) fill.style.background = n.bg && n.bg !== 'image' ? n.bg : 'transparent';
    tip.setAttribute('data-show', '');
  }

  private placeTip(e: PointerEvent) {
    const tip = this.tip;
    if (!tip) return;
    const p = this.local(e);
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = p.x + 16;
    let y = p.y + 18;
    if (x + w > this.view.width - 8) x = p.x - w - 12;
    if (y + h > this.view.height - 8) y = p.y - h - 12;
    tip.style.transform = `translate3d(${Math.round(Math.max(8, x))}px,${Math.round(Math.max(8, y))}px,0)`;
  }

  /* ---------------------------------------------------------------- */
  /* Frame loop                                                        */
  /* ---------------------------------------------------------------- */

  kick() {
    if (!this.raf && this.stage) this.raf = requestAnimationFrame(this.frame);
  }

  private round(n: number) {
    return Math.round(n * 100) / 100;
  }

  private frame = (t: number) => {
    this.raf = 0;
    const dt = this.lastT ? Math.min(64, Math.max(1, t - this.lastT)) : 16;
    this.lastT = t;
    let active = false;

    // Inertial orbit after a flick.
    if (!this.drag && (Math.abs(this.vel.yaw) > 0.002 || Math.abs(this.vel.pitch) > 0.002)) {
      this.cam.yaw += this.vel.yaw * dt;
      const p = clampPitch(this.cam.pitch + this.vel.pitch * dt);
      if (p !== this.cam.pitch + this.vel.pitch * dt) this.vel.pitch = 0;
      this.cam.pitch = p;
      this.vel.yaw = decay(this.vel.yaw, dt, TAU_INERTIA);
      this.vel.pitch = decay(this.vel.pitch, dt, TAU_INERTIA);
      if (Math.abs(this.cam.yaw) > 1 || Math.abs(this.cam.pitch) > 1) this.lastAngles = { yaw: wrapAngle(this.cam.yaw), pitch: this.cam.pitch };
      active = true;
    } else if (!this.drag) this.vel = { yaw: 0, pitch: 0 };

    // Camera tween.
    const g = this.goal;
    if (g) {
      const c = this.cam;
      c.yaw = approach(c.yaw, g.yaw, dt, TAU_CAMERA);
      c.pitch = approach(c.pitch, g.pitch, dt, TAU_CAMERA);
      c.zoom = Math.exp(approach(Math.log(c.zoom), Math.log(g.zoom), dt, TAU_CAMERA));
      c.panX = approach(c.panX, g.panX, dt, TAU_CAMERA);
      c.panY = approach(c.panY, g.panY, dt, TAU_CAMERA);
      c.tx = approach(c.tx, g.tx, dt, TAU_CAMERA);
      c.ty = approach(c.ty, g.ty, dt, TAU_CAMERA);
      c.td = approach(c.td, g.td, dt, TAU_CAMERA);
      const done =
        Math.abs(c.yaw - g.yaw) < 0.02 &&
        Math.abs(c.pitch - g.pitch) < 0.02 &&
        Math.abs(c.zoom / g.zoom - 1) < 0.0005 &&
        Math.abs(c.panX - g.panX) < 0.1 &&
        Math.abs(c.panY - g.panY) < 0.1 &&
        Math.abs(c.tx - g.tx) < 0.1 &&
        Math.abs(c.ty - g.ty) < 0.1 &&
        Math.abs(c.td - g.td) < 0.002;
      if (done) {
        this.cam = { ...g, yaw: wrapAngle(g.yaw) };
        this.goal = null;
      } else active = true;
    }

    // Layer spacing tween (explode / flatten).
    if (this.spacing !== this.spacingGoal) {
      this.spacing = approach(this.spacing, this.spacingGoal, dt, TAU_SPACING);
      if (Math.abs(this.spacing - this.spacingGoal) < 0.05) this.spacing = this.spacingGoal;
      else active = true;
    }

    this.cam.zoom = clampZoom(this.cam.zoom);
    this.write();
    if (active || this.drag) {
      if (active) this.kick();
    } else {
      this.lastT = 0;
    }
    this.scheduleSettle();
  };

  private scheduleSettle() {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (this.raf || this.drag) return this.scheduleSettle();
      this.writeHairline();
    }, 140);
  }

  /** Border width that stays ≈1 device px; changed only when idle (it repaints the planes). */
  private writeHairline() {
    if (!this.stage) return;
    const bw = `${hairline(this.cam.zoom)}px`;
    if (bw !== this.written.bw) {
      this.written.bw = bw;
      this.stage.style.setProperty('--bw', bw);
    }
  }

  private write() {
    const { pan, world, stage } = this;
    if (!pan || !world || !stage) return;
    const w = this.written;
    const panCss = wrapperCss(this.cam);
    if (panCss !== w.pan) pan.style.transform = w.pan = panCss;
    const persp = `${this.perspective}px`;
    if (persp !== w.persp) pan.style.perspective = w.persp = persp;
    const m = worldMatrix(this.cam, this.spacing);
    const worldCss = matrixCss(m);
    if (worldCss !== w.world) world.style.transform = w.world = worldCss;
    if (this.spacing !== w.spacing) {
      w.spacing = this.spacing;
      for (const [d, el] of this.layers) el.style.transform = `translate3d(0,0,${this.round(d * this.spacing)}px)`;
      const baseZ = this.round(this.baseDepth * this.spacing);
      if (this.base) this.base.style.transform = `translate3d(0,0,${baseZ}px)`;
      if (this.grid) this.grid.style.transform = `translate3d(0,0,${this.round(baseZ - Math.max(this.spacing * 0.6, 0))}px)`;
      stage.toggleAttribute('data-flat', this.spacing < 0.5);
    }
    const detail = this.cam.zoom >= 1.15 ? '1' : '';
    if (detail !== w.detail) {
      w.detail = detail;
      stage.toggleAttribute('data-detail', Boolean(detail));
    }
    if (!w.bw) this.writeHairline();
    const zoomText = `${Math.round(this.cam.zoom * 100)}%`;
    if (this.hudZoom && zoomText !== w.zoom) this.hudZoom.textContent = w.zoom = zoomText;
    const anglesText = `${Math.round(wrapAngle(this.cam.yaw))}° · ${Math.round(this.cam.pitch)}°`;
    if (this.hudAngles && anglesText !== w.angles) this.hudAngles.textContent = w.angles = anglesText;
    this.layoutLabels(m);
  }

  /** Project label anchors, cull tiny planes and greedily avoid overlaps. */
  private layoutLabels(m: Mat4) {
    const specs = this.labelSpecs;
    if (!specs.length) return;
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const cx = this.view.width / 2;
    const cy = this.view.height / 2;
    for (let k = 0; k < specs.length; k++) {
      const el = this.labelEls[k];
      if (!el) continue;
      const sp = specs[k];
      const z = sp.depth * this.spacing;
      const a = projectWith(m, this.cam, this.perspective, [sp.x, sp.y, z]);
      const b = projectWith(m, this.cam, this.perspective, [sp.x + sp.w, sp.y, z]);
      const size = this.labelSizes[k] ?? { w: 80, h: 18 };
      const screenW = Math.hypot(b.x - a.x, b.y - a.y);
      let state = 'h';
      if (screenW >= 44) {
        const x = Math.round(cx + Math.min(a.x, b.x));
        const y = Math.round(cy + (a.x <= b.x ? a.y : b.y) - size.h - 4);
        const r = { x0: x - 2, y0: y - 2, x1: x + size.w + 2, y1: y + size.h + 2 };
        const inView = r.x1 > 0 && r.y1 > 0 && r.x0 < this.view.width && r.y0 < this.view.height;
        if (inView && !placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) {
          placed.push(r);
          state = `${x},${y}`;
        }
      }
      if (state === this.labelState[k]) continue;
      if (state === 'h') el.style.visibility = 'hidden';
      else {
        if (this.labelState[k] === 'h' || this.labelState[k] === undefined) el.style.visibility = 'visible';
        el.style.transform = `translate3d(${state.replace(',', 'px,')}px,0)`;
      }
      this.labelState[k] = state;
    }
  }
}

/** One engine per studio session so the camera survives switching documents. */
export const engine = new HierarchyEngine();
export { DEFAULT_SPACING };
