/**
 * Pure layout math for the device wall and its contact sheet.
 */

export type Box = { width: number; height: number };

export type WallCell = { index: number; x: number; y: number; scale: number; width: number; height: number };
export type WallLayout = { cells: WallCell[]; width: number; height: number; frameHeight: number };

export type WallOptions = {
  gap: number;
  rowGap: number;
  /** Height reserved above each frame for its label. */
  labelHeight: number;
  /** Frames are never shown larger than their true CSS size × this. */
  maxScale: number;
};

export const WALL_DEFAULTS: WallOptions = { gap: 40, rowGap: 36, labelHeight: 46, maxScale: 1 };

/**
 * Line up frames at a common on-screen height `frameHeight` (a device "line-up"),
 * wrapping into centred rows that fit `containerWidth`.
 */
export function wallLayout(frames: Box[], containerWidth: number, frameHeight: number, opts: WallOptions = WALL_DEFAULTS): WallLayout {
  const avail = Math.max(1, containerWidth);
  const sized = frames.map((f, index) => {
    const scale = Math.max(0.02, Math.min(opts.maxScale, frameHeight / f.height, avail / f.width));
    return { index, scale, width: f.width * scale, height: f.height * scale };
  });
  const rows: (typeof sized)[] = [];
  let row: typeof sized = [];
  let rowW = 0;
  for (const s of sized) {
    const next = row.length ? rowW + opts.gap + s.width : s.width;
    if (row.length && next > avail) {
      rows.push(row);
      row = [s];
      rowW = s.width;
    } else {
      row.push(s);
      rowW = next;
    }
  }
  if (row.length) rows.push(row);

  const cells: WallCell[] = [];
  let y = 0;
  let maxW = 0;
  rows.forEach((r, ri) => {
    const width = r.reduce((sum, s, i) => sum + s.width + (i ? opts.gap : 0), 0);
    const rowH = Math.max(...r.map((s) => s.height));
    maxW = Math.max(maxW, width);
    let x = (avail - width) / 2;
    for (const s of r) {
      // Bottom-align frames within the row so devices stand on a common baseline.
      cells.push({ index: s.index, x, y: y + opts.labelHeight + (rowH - s.height), scale: s.scale, width: s.width, height: s.height });
      x += s.width + opts.gap;
    }
    y += opts.labelHeight + rowH + (ri < rows.length - 1 ? opts.rowGap : 0);
  });
  cells.sort((a, b) => a.index - b.index);
  return { cells, width: maxW, height: y, frameHeight };
}

/** Split `weights` (in order) into `k` contiguous groups minimising the largest group sum. */
export function linearPartition(weights: number[], k: number): number[][] {
  const n = weights.length;
  if (k <= 1 || n <= 1) return [weights.map((_, i) => i)];
  if (k >= n) return weights.map((_, i) => [i]);
  const prefix = [0];
  for (const w of weights) prefix.push(prefix[prefix.length - 1] + w);
  const sum = (a: number, b: number) => prefix[b] - prefix[a];
  // cost[i][j]: best max-sum splitting the first i items into j groups.
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(Infinity));
  const cut: number[][] = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(0));
  for (let i = 1; i <= n; i++) cost[i][1] = sum(0, i);
  for (let j = 2; j <= k; j++) {
    for (let i = j; i <= n; i++) {
      for (let x = j - 1; x < i; x++) {
        const c = Math.max(cost[x][j - 1], sum(x, i));
        if (c < cost[i][j]) {
          cost[i][j] = c;
          cut[i][j] = x;
        }
      }
    }
  }
  const groups: number[][] = [];
  let i = n;
  for (let j = k; j >= 1; j--) {
    const x = j === 1 ? 0 : cut[i][j];
    groups.unshift(Array.from({ length: i - x }, (_, q) => x + q));
    i = x;
  }
  return groups;
}

/**
 * "Fit" layout: justified rows. Frames keep their order; each row is scaled so it
 * spans the width, then everything shrinks uniformly if it is too tall. The row
 * count that shows the most device area wins, so the wall fills the screen.
 */
export function fitWallLayout(frames: Box[], container: Box, opts: WallOptions = WALL_DEFAULTS, maxFrameHeight = 900): WallLayout {
  if (!frames.length) return { cells: [], width: 0, height: 0, frameHeight: 0 };
  const W = Math.max(1, container.width);
  const H = Math.max(1, container.height);
  const aspects = frames.map((f) => f.width / f.height);
  let best: WallLayout | null = null;
  let bestArea = -1;
  for (let k = 1; k <= frames.length; k++) {
    const rows = linearPartition(aspects, k);
    // Row height that makes the row exactly as wide as the container.
    let heights = rows.map((r) => {
      const a = r.reduce((sum, i) => sum + aspects[i], 0);
      const cap = Math.min(maxFrameHeight, ...r.map((i) => frames[i].height * opts.maxScale));
      return Math.min(cap, (W - opts.gap * (r.length - 1)) / a);
    });
    const chrome = k * opts.labelHeight + (k - 1) * opts.rowGap;
    const total = heights.reduce((a, b) => a + b, 0);
    if (total + chrome > H) {
      const k2 = Math.max(0.01, (H - chrome) / total);
      heights = heights.map((h) => h * k2);
    }
    const cells: WallCell[] = [];
    let y = 0;
    let maxW = 0;
    let area = 0;
    rows.forEach((r, ri) => {
      const h = heights[ri];
      const widths = r.map((i) => aspects[i] * h);
      const rowW = widths.reduce((a, b) => a + b, 0) + opts.gap * (r.length - 1);
      maxW = Math.max(maxW, rowW);
      let x = (W - rowW) / 2;
      r.forEach((i, q) => {
        const scale = h / frames[i].height;
        cells.push({ index: i, x, y: y + opts.labelHeight, scale, width: widths[q], height: h });
        area += widths[q] * h;
        x += widths[q] + opts.gap;
      });
      y += opts.labelHeight + h + (ri < rows.length - 1 ? opts.rowGap : 0);
    });
    // Penalise layouts whose smallest tile gets too small to read.
    const minH = Math.min(...heights);
    const score = area * (minH < 140 ? minH / 140 : 1);
    if (score > bestArea) {
      bestArea = score;
      cells.sort((a, b) => a.index - b.index);
      best = { cells, width: maxW, height: y, frameHeight: Math.max(...heights) };
    }
  }
  return best!;
}

/** Largest common frame height (within bounds) whose layout fits in the container. */
export function fitFrameHeight(frames: Box[], container: Box, opts: WallOptions = WALL_DEFAULTS, bounds = { min: 160, max: 900 }): number {
  if (!frames.length) return bounds.max;
  let lo = bounds.min;
  let hi = bounds.max;
  if (wallLayout(frames, container.width, lo, opts).height > container.height) return lo;
  for (let i = 0; i < 24 && hi - lo > 1; i++) {
    const mid = (lo + hi) / 2;
    if (wallLayout(frames, container.width, mid, opts).height <= container.height) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo);
}

/* ------------------------------------------------------------------ */
/* Contact sheet                                                       */
/* ------------------------------------------------------------------ */

export type SheetOptions = {
  cellHeight: number;
  maxWidth: number;
  minWidth: number;
  gap: number;
  padding: number;
  header: number;
  label: number;
  footer: number;
};

export const SHEET_DEFAULTS: SheetOptions = { cellHeight: 720, maxWidth: 3200, minWidth: 1400, gap: 56, padding: 72, header: 136, label: 70, footer: 64 };

export type SheetCell = { x: number; y: number; width: number; height: number; labelY: number };
export type SheetLayout = { width: number; height: number; cells: SheetCell[] };

/**
 * Contact-sheet layout: every capture scaled to a common height (never upscaled),
 * flowed into centred rows under a header, with a label strip below each image.
 */
export function contactSheetLayout(images: Box[], opts: SheetOptions = SHEET_DEFAULTS): SheetLayout {
  const inner = opts.maxWidth - opts.padding * 2;
  const sized = images.map((im) => {
    const k = Math.min(1, opts.cellHeight / Math.max(1, im.height), inner / Math.max(1, im.width));
    return { width: Math.round(im.width * k), height: Math.round(im.height * k) };
  });
  const rows: number[][] = [];
  let row: number[] = [];
  let rowW = 0;
  sized.forEach((s, i) => {
    const next = row.length ? rowW + opts.gap + s.width : s.width;
    if (row.length && next > inner) {
      rows.push(row);
      row = [i];
      rowW = s.width;
    } else {
      row.push(i);
      rowW = next;
    }
  });
  if (row.length) rows.push(row);

  const rowWidths = rows.map((r) => r.reduce((sum, i, j) => sum + sized[i].width + (j ? opts.gap : 0), 0));
  const width = Math.max(opts.minWidth, Math.min(opts.maxWidth, Math.max(0, ...rowWidths) + opts.padding * 2));
  const cells: SheetCell[] = new Array(images.length);
  let y = opts.padding + opts.header;
  rows.forEach((r, ri) => {
    const rowH = Math.max(...r.map((i) => sized[i].height));
    let x = (width - rowWidths[ri]) / 2;
    for (const i of r) {
      const s = sized[i];
      const top = y + (rowH - s.height);
      cells[i] = { x: Math.round(x), y: Math.round(top), width: s.width, height: s.height, labelY: Math.round(y + rowH + 18) };
      x += s.width + opts.gap;
    }
    y += rowH + opts.label + (ri < rows.length - 1 ? opts.gap : 0);
  });
  return { width, height: Math.round(y + opts.footer + opts.padding / 2), cells };
}
