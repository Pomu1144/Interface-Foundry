/** Pure helpers for the responsive sweep (unit-tested). */

/** One measurement of the selected element at a viewport width (CSS px). */
export type SweepPoint = {
  vw: number;
  /** Element is in the DOM at this width. */
  present: boolean;
  visible: boolean;
  x: number;
  width: number;
  right: number;
  height: number;
};

/** Contiguous width ranges where the element's right edge passes the viewport edge. */
export function overflowZones(points: SweepPoint[], tolerance = 1): { from: number; to: number; max: number }[] {
  const zones: { from: number; to: number; max: number }[] = [];
  let cur: { from: number; to: number; max: number } | null = null;
  for (const p of points) {
    const over = p.visible ? p.right - p.vw : 0;
    if (p.visible && over > tolerance) {
      if (!cur) cur = { from: p.vw, to: p.vw, max: over };
      else {
        cur.to = p.vw;
        cur.max = Math.max(cur.max, over);
      }
    } else if (cur) {
      zones.push(cur);
      cur = null;
    }
  }
  if (cur) zones.push(cur);
  return zones;
}
