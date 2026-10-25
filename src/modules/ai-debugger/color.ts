/**
 * Colour maths for contrast fixes (WCAG 2.x relative luminance). Pure functions.
 */

export type RGB = { r: number; g: number; b: number; a: number };

export function parseColor(input: string): RGB | null {
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a] = [...h].map((c) => parseInt(c + c, 16));
      return { r, g, b, a: h.length === 4 ? a / 255 : 1 };
    }
    if (h.length === 6 || h.length === 8) {
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
    }
    return null;
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const ch = (p: string) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p));
    const a = parts[3] !== undefined ? (parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1;
    const rgb = { r: ch(parts[0]), g: ch(parts[1]), b: ch(parts[2]), a };
    return [rgb.r, rgb.g, rgb.b, rgb.a].every(Number.isFinite) ? rgb : null;
  }
  if (s === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (s === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  return null;
}

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

export function luminance(c: RGB): number {
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function toHex(c: RGB): string {
  return '#' + [c.r, c.g, c.b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}

type HSL = { h: number; s: number; l: number };

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255, a: 1 };
}

/**
 * The closest colour with the same hue and saturation whose contrast against
 * `bg` reaches `target`. Darkens on light backgrounds and lightens on dark ones;
 * returns null when no lightness reaches the target.
 */
export function adjustForContrast(fg: RGB, bg: RGB, target = 4.5): { color: string; ratio: number } | null {
  if (contrastRatio(fg, bg) >= target) return { color: toHex(fg), ratio: round2(contrastRatio(fg, bg)) };
  const hsl = rgbToHsl(fg);
  const darken = luminance(bg) > 0.18;
  // Binary search the lightness closest to the original that passes.
  let lo = darken ? 0 : hsl.l;
  let hi = darken ? hsl.l : 1;
  const passes = (l: number) => contrastRatio(hslToRgb({ ...hsl, l }), bg) >= target;
  if (!passes(darken ? 0 : 1)) return null;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (darken) {
      if (passes(mid)) lo = mid;
      else hi = mid;
    } else if (passes(mid)) hi = mid;
    else lo = mid;
  }
  let l = darken ? lo : hi;
  // Round to a hex colour that still passes after quantisation.
  for (let k = 0; k < 20; k++) {
    const rgb = hslToRgb({ ...hsl, l });
    const hex = toHex(rgb);
    const q = parseColor(hex)!;
    if (contrastRatio(q, bg) >= target) return { color: hex, ratio: round2(contrastRatio(q, bg)) };
    l = darken ? l - 0.004 : l + 0.004;
  }
  return null;
}

const round2 = (n: number) => Math.floor(n * 100) / 100;
