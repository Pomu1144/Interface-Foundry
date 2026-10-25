import type { LayoutSnapshotEntry } from '@shared/protocol';
import type { FoldGeometry, Rect } from '@shared/types';

/**
 * Structural diff between two layout snapshots (from `layout.snapshot`).
 * Entries are matched by their unique selector; each change is classified as
 * expected responsive behaviour or suspicious (primary control hidden,
 * pushed off-screen, shrunk below the tap size, or split by a hinge/crease).
 * Pure: no DOM or store access.
 */

export type SnapshotSide = {
  entries: LayoutSnapshotEntry[];
  /** Layout viewport in CSS px. */
  viewport: { width: number; height: number };
  /** Fold relative to the viewport (see foldInViewport), if any. */
  fold?: FoldGeometry | null;
  /** Page scroll when the snapshot was taken (rects are document coordinates). */
  scroll?: { x: number; y: number };
};

export type StructuralKind = 'moved' | 'resized' | 'appeared' | 'disappeared' | 'shown' | 'hidden';

export type StructuralRow = {
  selector: string;
  label: string;
  role: string;
  primary: boolean;
  text?: string;
  kinds: StructuralKind[];
  a?: Rect;
  b?: Rect;
  visibleA?: boolean;
  visibleB?: boolean;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  classification: 'expected' | 'suspicious';
  reasons: string[];
};

export type StructuralSummary = Record<StructuralKind, number> & { total: number; suspicious: number; unchanged: number };

export const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'option',
  'switch',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'slider',
  'spinbutton',
]);

/** Native controls by tag, for elements without an ARIA role mapping (e.g. input[type=password]). */
const NATIVE_CONTROL = /^(input|select|textarea|button|summary|a)(?=[#.[:]|$)/;

export const isInteractive = (e: Pick<LayoutSnapshotEntry, 'role' | 'primary'> & { label?: string }) => e.primary || INTERACTIVE_ROLES.has(e.role) || NATIVE_CONTROL.test(e.label ?? '');

/** Does a viewport-relative rect cross the fold line/mask? */
export function crossesFold(r: Rect, fold: FoldGeometry): boolean {
  const start = fold.offset;
  const end = fold.offset + Math.max(0, fold.maskLength);
  const [lo, size] = fold.axis === 'vertical' ? [r.x, r.width] : [r.y, r.height];
  if (size <= 0) return false;
  // A hinge hides a band: any overlap counts. A crease is a line: the element must straddle it.
  return end > start ? lo < end && lo + size > start : lo < start && lo + size > start;
}

const toViewport = (r: Rect, side: SnapshotSide): Rect => ({ ...r, x: r.x - (side.scroll?.x ?? 0), y: r.y - (side.scroll?.y ?? 0) });

/** Problems an entry has on one side, independent of the other side. */
function sideProblems(e: LayoutSnapshotEntry, side: SnapshotSide, name: string, minTap: number): string[] {
  const out: string[] = [];
  if (!e.visible) return out;
  const r = toViewport(e.rect, side);
  if (r.x + r.width > side.viewport.width + 1 || r.x < -1) {
    out.push(`${isInteractive(e) ? 'Control' : 'Element'} extends past the viewport edge in ${name} (x ${Math.round(r.x)}–${Math.round(r.x + r.width)} of ${side.viewport.width}px)`);
  }
  if (side.fold && isInteractive(e) && crossesFold(r, side.fold)) {
    const f = side.fold;
    const hinge = f.kind === 'hinge' && f.maskLength > 0;
    out.push(hinge ? `Split by the ${f.maskLength}px hinge in ${name} (${f.axis === 'vertical' ? 'x' : 'y'} ${f.offset}–${f.offset + f.maskLength})` : `Straddles the fold crease in ${name}`);
  }
  return out;
}

export function structuralDiff(a: SnapshotSide, b: SnapshotSide, opts: { tolerance?: number; minTapSize?: number; names?: [string, string] } = {}): { rows: StructuralRow[]; summary: StructuralSummary } {
  const tol = opts.tolerance ?? 2;
  const minTap = opts.minTapSize ?? 24;
  const [nameA, nameB] = opts.names ?? ['A', 'B'];
  const mapA = new Map<string, LayoutSnapshotEntry>();
  const mapB = new Map<string, LayoutSnapshotEntry>();
  for (const e of a.entries) if (!mapA.has(e.selector)) mapA.set(e.selector, e);
  for (const e of b.entries) if (!mapB.has(e.selector)) mapB.set(e.selector, e);

  const rows: StructuralRow[] = [];
  const summary: StructuralSummary = { moved: 0, resized: 0, appeared: 0, disappeared: 0, shown: 0, hidden: 0, total: 0, suspicious: 0, unchanged: 0 };
  const selectors = [...new Set([...mapA.keys(), ...mapB.keys()])];

  for (const sel of selectors) {
    const ea = mapA.get(sel);
    const eb = mapB.get(sel);
    const ref = (eb ?? ea)!;
    const kinds: StructuralKind[] = [];
    const reasons: string[] = [];
    let dx = 0;
    let dy = 0;
    let dw = 0;
    let dh = 0;

    if (ea && !eb) kinds.push('disappeared');
    else if (!ea && eb) kinds.push('appeared');
    else if (ea && eb) {
      if (ea.visible && !eb.visible) kinds.push('hidden');
      else if (!ea.visible && eb.visible) kinds.push('shown');
      if (ea.visible && eb.visible) {
        const ra = toViewport(ea.rect, a);
        const rb = toViewport(eb.rect, b);
        dx = rb.x - ra.x;
        dy = rb.y - ra.y;
        dw = rb.width - ra.width;
        dh = rb.height - ra.height;
        if (Math.abs(dx) > tol || Math.abs(dy) > tol) kinds.push('moved');
        if (Math.abs(dw) > tol || Math.abs(dh) > tol) kinds.push('resized');
      }
    }
    if (!kinds.length) {
      summary.unchanged++;
      continue;
    }

    // Suspicious signals.
    if (ref.primary) {
      if (kinds.includes('hidden') || kinds.includes('disappeared')) reasons.push(`Primary action is not rendered in ${nameB}`);
      if (kinds.includes('shown') || kinds.includes('appeared')) reasons.push(`Primary action is not rendered in ${nameA}`);
    }
    if (ea && eb && ea.visible && eb.visible && isInteractive(ref)) {
      const smallA = ea.rect.width < minTap || ea.rect.height < minTap;
      const smallB = eb.rect.width < minTap || eb.rect.height < minTap;
      if (smallB && !smallA) reasons.push(`Shrinks below the ${minTap}px tap size in ${nameB} (${Math.round(eb.rect.width)}×${Math.round(eb.rect.height)})`);
      if (smallA && !smallB) reasons.push(`Below the ${minTap}px tap size in ${nameA} (${Math.round(ea.rect.width)}×${Math.round(ea.rect.height)})`);
    }
    if (ea) reasons.push(...sideProblems(ea, a, nameA, minTap));
    if (eb) reasons.push(...sideProblems(eb, b, nameB, minTap));

    const row: StructuralRow = {
      selector: sel,
      label: ref.label,
      role: ref.role,
      primary: ref.primary,
      text: ref.text,
      kinds,
      a: ea?.rect,
      b: eb?.rect,
      visibleA: ea?.visible,
      visibleB: eb?.visible,
      dx: Math.round(dx),
      dy: Math.round(dy),
      dw: Math.round(dw),
      dh: Math.round(dh),
      classification: reasons.length ? 'suspicious' : 'expected',
      reasons,
    };
    for (const k of kinds) summary[k]++;
    summary.total++;
    if (row.classification === 'suspicious') summary.suspicious++;
    rows.push(row);
  }

  rows.sort((x, y) => (x.classification === y.classification ? Number(y.primary) - Number(x.primary) || Math.abs(y.dw) + Math.abs(y.dx) - (Math.abs(x.dw) + Math.abs(x.dx)) : x.classification === 'suspicious' ? -1 : 1));
  return { rows, summary };
}
