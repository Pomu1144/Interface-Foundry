/**
 * WCAG 2.x contrast math (sRGB relative luminance) and a helper that finds the
 * nearest text colour reaching a target ratio. Pure; used by the A11y tab's
 * quick fix and unit tests.
 */

export type RGB = { r: number; g: number; b: number };

export function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

export function toHex({ r, g, b }: RGB): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

export function luminance(c: RGB): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const mix = (a: RGB, b: RGB, t: number): RGB => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });

/**
 * Smallest change to `fg` (mixing toward black or white, whichever needs less)
 * that reaches `target` against `bg`. Returns null if neither direction can.
 */
export function adjustForContrast(fgHex: string, bgHex: string, target = 4.5): { hex: string; ratio: number; direction: 'darker' | 'lighter' } | null {
  const fg = parseHex(fgHex);
  const bg = parseHex(bgHex);
  if (!fg || !bg) return null;
  if (contrastRatio(fg, bg) >= target) return { hex: toHex(fg), ratio: contrastRatio(fg, bg), direction: luminance(fg) < luminance(bg) ? 'darker' : 'lighter' };
  const candidates: { hex: string; ratio: number; t: number; direction: 'darker' | 'lighter' }[] = [];
  for (const [toward, direction] of [
    [{ r: 0, g: 0, b: 0 }, 'darker'],
    [{ r: 255, g: 255, b: 255 }, 'lighter'],
  ] as const) {
    if (contrastRatio(toward, bg) < target) continue;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (contrastRatio(mix(fg, toward, mid), bg) >= target) hi = mid;
      else lo = mid;
    }
    // Round to hex, then nudge until the rounded colour still passes.
    let t = hi;
    let c = parseHex(toHex(mix(fg, toward, t)))!;
    while (contrastRatio(c, bg) < target && t < 1) {
      t = Math.min(1, t + 0.005);
      c = parseHex(toHex(mix(fg, toward, t)))!;
    }
    candidates.push({ hex: toHex(c), ratio: contrastRatio(c, bg), t, direction });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.t - b.t);
  const best = candidates[0];
  return { hex: best.hex, ratio: Math.round(best.ratio * 100) / 100, direction: best.direction };
}

/** Required ratio for AA / AAA given text size (px) and weight. */
export function requiredRatio(level: 'AA' | 'AAA', fontSize: number, bold: boolean): number {
  const large = fontSize >= 24 || (bold && fontSize >= 18.66);
  if (level === 'AA') return large ? 3 : 4.5;
  return large ? 4.5 : 7;
}
