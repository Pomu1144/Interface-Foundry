import type { Hierarchy3DNode, LayoutSnapshotEntry, ResponsiveAuditOptions } from '@shared/protocol';
import type { IssueSeverity, ResponsiveIssue } from '@shared/types';
import { accessibleName, roleOf } from './a11y';
import { parsePx } from './css-utils';
import { idOf, isIfdyNode, isVisible, labelFor, rectOf, uniqueSelector, textPreview } from './nodes';

const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';

function elementsIn(selector: string, ignore: string[]): Element[] {
  const all = [...(document.body?.querySelectorAll(selector) ?? [])];
  return all.filter((el) => !isIfdyNode(el) && !ignore.some((s) => safeClosest(el, s)));
}

function safeClosest(el: Element, sel: string) {
  try {
    return el.closest(sel) !== null;
  } catch {
    return false;
  }
}

export function isPrimaryAction(el: Element): boolean {
  if (el.matches('[data-primary], [data-testid*="submit"], button[type="submit"], input[type="submit"]')) return true;
  const cls = (el.getAttribute('class') ?? '').toLowerCase();
  return /\b(primary|cta|btn-primary|button--primary)\b/.test(cls);
}

/** Ancestors that clip horizontally, so overflow inside them is contained. */
function containedHorizontally(el: Element): boolean {
  let cur = el.parentElement;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    const ox = getComputedStyle(cur).overflowX;
    if (ox === 'hidden' || ox === 'auto' || ox === 'scroll' || ox === 'clip') return true;
    cur = cur.parentElement;
  }
  return false;
}

export function responsiveAudit(opts: ResponsiveAuditOptions): ResponsiveIssue[] {
  const issues: ResponsiveIssue[] = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let n = 0;
  const push = (
    el: Element | null,
    rule: string,
    severity: IssueSeverity,
    title: string,
    message: string,
    evidence: ResponsiveIssue['evidence'],
    suggestion?: string,
  ) => {
    issues.push({
      id: `${rule}-${n++}`,
      rule,
      title,
      severity,
      message,
      selector: el ? uniqueSelector(el) : 'document',
      nodeId: el ? idOf(el) : undefined,
      rect: el ? rectOf(el) : undefined,
      viewport: opts.viewport,
      evidence,
      suggestion,
      classification: 'suspicious',
    });
  };

  // 1. Page-level horizontal overflow and its outermost culprits.
  const docW = document.documentElement.scrollWidth;
  if (docW > vw + 1) {
    const culprits: Element[] = [];
    for (const el of elementsIn('*', opts.ignoreSelectors)) {
      if (!isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 + window.scrollX || r.left < -1 - window.scrollX) {
        if (containedHorizontally(el)) continue;
        if (culprits.some((c) => c.contains(el))) continue;
        for (let i = culprits.length - 1; i >= 0; i--) if (el.contains(culprits[i])) culprits.splice(i, 1);
        culprits.push(el);
      }
    }
    const top = culprits.filter((c) => c !== document.body).slice(0, 8);
    if (!top.length) {
      push(null, 'horizontal-overflow', 'serious', 'Page scrolls horizontally', `The document is ${docW}px wide in a ${vw}px viewport.`, { documentWidth: docW, viewportWidth: vw });
    }
    for (const el of top) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const fixed = /px$/.test(cs.width) && el.getAttribute('style')?.includes('width') ? 'inline width' : '';
      push(
        el,
        'horizontal-overflow',
        'serious',
        'Element overflows the viewport',
        `${labelFor(el)} extends ${Math.round(r.right - vw)}px past the right edge, so the page scrolls horizontally (document ${docW}px vs viewport ${vw}px).`,
        {
          right: Math.round(r.right),
          viewportWidth: vw,
          overflowBy: Math.round(r.right - vw),
          width: cs.width,
          minWidth: cs.minWidth,
          maxWidth: cs.maxWidth,
          flexShrink: cs.flexShrink,
          source: fixed || 'stylesheet',
        },
        `Avoid fixed widths wider than small viewports: use max-width: 100% (or width: auto) and let it shrink; check min-width (${cs.minWidth}).`,
      );
    }
  }

  // 2. Clipped / truncated content.
  for (const el of elementsIn('*', opts.ignoreSelectors)) {
    if (issues.length > 200) break;
    const cs = getComputedStyle(el);
    if (!/(hidden|clip)/.test(cs.overflowX + cs.overflowY)) continue;
    if (!isVisible(el) || el.tagName === 'HTML' || el.tagName === 'BODY') continue;
    const he = el as HTMLElement;
    const clipsX = he.scrollWidth > he.clientWidth + 1 && /(hidden|clip)/.test(cs.overflowX);
    const clipsY = he.scrollHeight > he.clientHeight + 1 && /(hidden|clip)/.test(cs.overflowY);
    if (!clipsX && !clipsY) continue;
    const hasText = (el.textContent ?? '').trim().length > 0;
    if (!hasText) continue;
    const ellipsis = cs.textOverflow === 'ellipsis';
    push(
      el,
      'clipped-content',
      ellipsis ? 'minor' : 'moderate',
      ellipsis ? 'Text truncated with ellipsis' : 'Content is clipped',
      `${labelFor(el)} hides ${clipsX ? `${he.scrollWidth - he.clientWidth}px horizontally` : ''}${clipsX && clipsY ? ' and ' : ''}${clipsY ? `${he.scrollHeight - he.clientHeight}px vertically` : ''}.`,
      { scrollWidth: he.scrollWidth, clientWidth: he.clientWidth, scrollHeight: he.scrollHeight, clientHeight: he.clientHeight, overflow: `${cs.overflowX}/${cs.overflowY}` },
      ellipsis ? 'Confirm the full text is available elsewhere (title, tooltip, or expanded view).' : 'Allow the container to grow, wrap the content, or make it scrollable.',
    );
  }

  const interactive = elementsIn(INTERACTIVE, opts.ignoreSelectors);

  // 3. Primary actions hidden or off-screen.
  for (const el of interactive) {
    if (!isPrimaryAction(el)) continue;
    const r = el.getBoundingClientRect();
    if (!isVisible(el) || r.width === 0 || r.height === 0) {
      push(el, 'hidden-primary-action', 'serious', 'Primary action is hidden', `${labelFor(el)} (“${accessibleName(el) || textPreview(el, 40)}”) is not rendered at ${vw}×${vh}.`, { display: getComputedStyle(el).display, visibility: getComputedStyle(el).visibility }, 'Keep primary actions available at every breakpoint, possibly in a different position.');
    } else if (r.right > vw + 1 || r.left < -1) {
      push(el, 'offscreen-primary-action', 'serious', 'Primary action is off-screen', `${labelFor(el)} is positioned outside the viewport horizontally.`, { left: Math.round(r.left), right: Math.round(r.right), viewportWidth: vw });
    }
  }

  // 4. Hinge / fold intersection.
  if (opts.fold) {
    const f = opts.fold;
    const start = f.offset;
    const end = f.offset + Math.max(f.maskLength, 0);
    const crosses = (r: DOMRect) =>
      f.axis === 'vertical' ? r.left < end && r.right > start && r.width > 0 : r.top < end && r.bottom > start && r.height > 0;
    for (const el of interactive) {
      if (!isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      if (!crosses(r)) continue;
      const hinge = f.kind === 'hinge' && f.maskLength > 0;
      push(
        el,
        'fold-intersection',
        hinge ? 'serious' : 'moderate',
        hinge ? 'Control is split by the hinge' : 'Control straddles the fold crease',
        `${labelFor(el)} spans ${f.axis === 'vertical' ? `x ${Math.round(r.left)}–${Math.round(r.right)}` : `y ${Math.round(r.top)}–${Math.round(r.bottom)}`}, crossing the ${f.kind} at ${start}${hinge ? `–${end}` : ''}px.${hinge ? ' Part of it is physically not displayed.' : ''}`,
        { foldStart: start, foldEnd: end, left: Math.round(r.left), right: Math.round(r.right), axis: f.axis, kind: f.kind },
        'Lay content out per screen segment with @media (horizontal-viewport-segments: 2) and env(viewport-segment-*) so controls sit entirely on one side of the fold.',
      );
    }
    if (f.kind === 'hinge' && f.maskLength > 0) {
      for (const el of elementsIn('p, h1, h2, h3, h4, li, label, td, th, span', opts.ignoreSelectors)) {
        if (el.children.length > 2 || !isVisible(el) || !(el.textContent ?? '').trim()) continue;
        const r = el.getBoundingClientRect();
        if (crosses(r) && r.width < vw * 0.95) {
          push(el, 'fold-intersection', 'moderate', 'Text runs under the hinge', `${labelFor(el)} crosses the ${f.maskLength}px hinge; some characters are not visible.`, { foldStart: start, foldEnd: end, left: Math.round(r.left), right: Math.round(r.right) });
        }
      }
    }
  }

  // 5. Small tap targets (WCAG 2.5.8 minimum 24×24, inline links excepted).
  for (const el of interactive) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const inlineLink = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.parentElement && /^(P|LI|SPAN|TD)$/.test(el.parentElement.tagName);
    if (inlineLink) continue;
    // A label wrapping a small checkbox enlarges its target.
    if (el instanceof HTMLInputElement && el.labels?.length) {
      const lr = el.labels[0].getBoundingClientRect();
      if (lr.width >= opts.minTapSize && lr.height >= opts.minTapSize && el.labels[0].contains(el)) continue;
    }
    if (r.width < opts.minTapSize || r.height < opts.minTapSize) {
      push(el, 'tap-target', r.width < 24 || r.height < 24 ? 'moderate' : 'minor', 'Tap target is too small', `${labelFor(el)} is ${Math.round(r.width)}×${Math.round(r.height)}px; minimum is ${opts.minTapSize}×${opts.minTapSize}px.`, { width: Math.round(r.width), height: Math.round(r.height), minimum: opts.minTapSize }, 'Increase the hit area with padding or min-width/min-height, or wrap the control in its label.');
    }
  }

  // 6. Tiny text and 7. long line length.
  for (const el of elementsIn('p, li, span, a, label, td, th, dd, dt, small, button', opts.ignoreSelectors)) {
    if (issues.length > 300) break;
    if (!isVisible(el)) continue;
    const ownText = [...el.childNodes].some((c) => c.nodeType === 3 && (c.textContent ?? '').trim().length > 2);
    if (!ownText) continue;
    const cs = getComputedStyle(el);
    const size = parsePx(cs.fontSize);
    if (size && size < opts.minFontSize) {
      push(el, 'small-text', 'minor', 'Text is very small', `${labelFor(el)} renders at ${size}px.`, { fontSize: size, minimum: opts.minFontSize });
    }
    if (/^(P|LI|DD)$/.test(el.tagName)) {
      const r = el.getBoundingClientRect();
      const chars = r.width / (size * 0.5);
      const lines = r.height / (parsePx(cs.lineHeight) || size * 1.4);
      if (chars > opts.maxLineLength && lines >= 1.5) {
        push(el, 'line-length', 'moderate', 'Lines are too long to read comfortably', `${labelFor(el)} is ${Math.round(r.width)}px wide (~${Math.round(chars)} characters per line).`, { width: Math.round(r.width), approxCharsPerLine: Math.round(chars), maxWidth: cs.maxWidth }, 'Constrain text blocks with max-width (e.g. 65–75ch) on wide viewports.');
      }
    }
  }

  // 8. Stretched form controls.
  for (const el of elementsIn('input:not([type="checkbox"]):not([type="radio"]), select, textarea, button', opts.ignoreSelectors)) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 720) {
      push(el, 'stretched-control', 'minor', 'Control is stretched very wide', `${labelFor(el)} is ${Math.round(r.width)}px wide.`, { width: Math.round(r.width) }, 'Cap form widths (e.g. max-width: 32rem) on expanded viewports.');
    }
  }

  // 9. Overlapping interactive elements.
  const vis = interactive.filter(isVisible).slice(0, 250);
  for (let i = 0; i < vis.length; i++) {
    const a = vis[i].getBoundingClientRect();
    for (let j = i + 1; j < vis.length; j++) {
      if (vis[i].contains(vis[j]) || vis[j].contains(vis[i])) continue;
      const b = vis[j].getBoundingClientRect();
      const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const overlap = ix * iy;
      const smaller = Math.min(a.width * a.height, b.width * b.height);
      if (smaller > 0 && overlap / smaller > 0.25) {
        push(vis[i], 'overlap', 'serious', 'Interactive elements overlap', `${labelFor(vis[i])} overlaps ${labelFor(vis[j])} by ${Math.round((overlap / smaller) * 100)}%.`, { other: uniqueSelector(vis[j]), overlapPct: Math.round((overlap / smaller) * 100) });
      }
    }
  }

  // 10. Distorted images.
  for (const img of elementsIn('img', opts.ignoreSelectors) as HTMLImageElement[]) {
    if (!img.complete || !img.naturalWidth || !isVisible(img)) continue;
    const cs = getComputedStyle(img);
    if (cs.objectFit !== 'fill') continue;
    const r = img.getBoundingClientRect();
    const natural = img.naturalWidth / img.naturalHeight;
    const rendered = r.width / r.height;
    if (Math.abs(natural - rendered) / natural > 0.06) {
      push(img, 'image-distortion', 'minor', 'Image is distorted', `${labelFor(img)} renders at ${rendered.toFixed(2)} aspect vs natural ${natural.toFixed(2)}.`, { natural: natural.toFixed(2), rendered: rendered.toFixed(2) }, 'Use object-fit: cover/contain or keep height: auto.');
    }
  }

  // 11. Viewport meta.
  if (!document.querySelector('meta[name="viewport"]')) {
    push(null, 'viewport-meta', 'serious', 'Missing viewport meta tag', 'Without <meta name="viewport"> mobile browsers render at a desktop width and scale down.', {}, 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.');
  }

  return issues;
}

/** Significant elements and their geometry, for structural responsive diffs. */
export function layoutSnapshot(selectors?: string[]): LayoutSnapshotEntry[] {
  const query = selectors?.length
    ? selectors.join(',')
    : `${INTERACTIVE}, h1, h2, h3, img, header, nav, main, footer, form, [role="alert"], [data-testid], [data-ifdy-component], table`;
  const out: LayoutSnapshotEntry[] = [];
  let list: Element[] = [];
  try {
    list = [...document.querySelectorAll(query)];
  } catch {
    return out;
  }
  for (const el of list) {
    if (isIfdyNode(el) || out.length >= 400) continue;
    const r = el.getBoundingClientRect();
    const visible = isVisible(el) && r.width > 0 && r.height > 0;
    out.push({
      selector: uniqueSelector(el),
      label: labelFor(el),
      role: roleOf(el),
      rect: { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height },
      visible,
      inViewport: visible && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight,
      text: textPreview(el, 60) || undefined,
      primary: isPrimaryAction(el),
    });
  }
  return out;
}

/** Visible element boxes with depth, for the exploded 3D view hierarchy. */
export function hierarchy3d(maxNodes = 1500): Hierarchy3DNode[] {
  const out: Hierarchy3DNode[] = [];
  const walk = (el: Element, depth: number) => {
    if (out.length >= maxNodes || isIfdyNode(el)) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden') {
      const bg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent' ? cs.backgroundColor : cs.backgroundImage !== 'none' ? 'image' : null;
      const border = parsePx(cs.borderTopWidth) > 0 ? cs.borderTopColor : null;
      const ownText = [...el.childNodes].some((c) => c.nodeType === 3 && (c.textContent ?? '').trim());
      out.push({
        id: idOf(el),
        depth,
        rect: { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height },
        label: labelFor(el),
        bg,
        border,
        text: ownText ? textPreview(el, 40) : undefined,
        isImage: el.tagName === 'IMG' || el.tagName === 'SVG' || el.tagName === 'VIDEO' || el.tagName === 'CANVAS',
      });
    }
    for (const c of el.children) walk(c, depth + 1);
  };
  if (document.body) walk(document.body, 0);
  return out;
}
