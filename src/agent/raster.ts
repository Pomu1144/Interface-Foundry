import type { CaptureOptions } from '@shared/protocol';
import { domToCanvas } from 'modern-screenshot';

/**
 * DOM rasterisation of the live page (including in-progress form state).
 * This is an approximation produced by re-rendering the DOM through SVG
 * foreignObject; use the companion's Chromium capture for pixel-exact baselines.
 */
export async function captureRaster(opts: CaptureOptions): Promise<{ dataUrl: string; width: number; height: number }> {
  const scale = Math.min(3, Math.max(0.25, opts.scale ?? 1));
  const root = document.documentElement;
  const width = opts.fullPage ? root.scrollWidth : innerWidth;
  const height = opts.fullPage ? root.scrollHeight : innerHeight;
  const bg = getComputedStyle(document.body ?? root).backgroundColor;
  const canvas = await domToCanvas(root, {
    width,
    height,
    scale,
    backgroundColor: bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#ffffff',
    filter: (node) => !(node instanceof Element && (node.hasAttribute('data-ifdy') || node.hasAttribute('data-ifdy-agent'))),
    style: opts.fullPage ? undefined : { transform: `translate(${-scrollX}px, ${-scrollY}px)` },
    timeout: 8000,
  });
  let out = canvas;
  if (opts.maxWidth && canvas.width > opts.maxWidth) {
    const k = opts.maxWidth / canvas.width;
    out = document.createElement('canvas');
    out.width = Math.round(canvas.width * k);
    out.height = Math.round(canvas.height * k);
    out.getContext('2d')!.drawImage(canvas, 0, 0, out.width, out.height);
  }
  return { dataUrl: out.toDataURL('image/png'), width: out.width, height: out.height };
}
