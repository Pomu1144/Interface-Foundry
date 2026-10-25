import { toast } from 'sonner';
import type { NodeId, ViewportContext } from '@shared/types';
import { studio } from '@/store';
import { RESPONSIVE_ID } from '@/modules/device-simulator/devices';
import { currentViewportContext } from '@/modules/device-simulator/context';
import { previews } from '@/modules/preview-runtime/registry';
import { refreshSelection, watchOverlayIds } from '@/modules/preview-runtime/sync';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isCurrentViewport(v: Pick<ViewportContext, 'deviceId' | 'posture' | 'orientation' | 'width'>): boolean {
  const c = currentViewportContext();
  return c.deviceId === v.deviceId && c.posture === v.posture && c.orientation === v.orientation && c.width === v.width;
}

/**
 * Select an element on the canvas by selector (falling back to a known node id),
 * scroll it into view and show the canvas. Returns false if it is not in the page.
 */
export async function revealSelector(selector: string, opts: { nodeId?: NodeId; quiet?: boolean } = {}): Promise<boolean> {
  const conn = previews.primary();
  if (!conn?.ready) {
    if (!opts.quiet) toast.error('No preview is connected.');
    return false;
  }
  let id: NodeId | null = null;
  if (selector && selector !== 'document') id = await conn.call('dom.resolve', { selector }).catch(() => null);
  if (id === null && opts.nodeId !== undefined) id = opts.nodeId;
  if (id === null) {
    if (!opts.quiet) toast.warning('That element is not in the current page', { description: selector });
    return false;
  }
  const s = studio();
  s.setActiveDoc('canvas');
  s.select(conn.id, id, selector || null);
  conn.tell('node.scrollIntoView', { id });
  watchOverlayIds();
  await refreshSelection();
  // Scrolling is smooth: refresh geometry once it settles.
  setTimeout(() => {
    watchOverlayIds();
    void refreshSelection();
  }, 450);
  return true;
}

/** Put the canvas device into the issue's viewport and wait for the page to re-layout. */
export async function switchToViewport(v: ViewportContext): Promise<void> {
  const s = studio();
  s.setActiveDoc('canvas');
  if (v.deviceId === RESPONSIVE_ID) {
    s.setViewport({ deviceId: RESPONSIVE_ID });
    s.setResponsiveSize({ width: v.width, height: v.height });
  } else {
    s.setViewport({ deviceId: v.deviceId, posture: v.posture, orientation: v.orientation });
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 3000) {
    const vp = studio().instances.primary?.viewport;
    if (vp && vp.width === v.width) break;
    await sleep(80);
  }
  await sleep(160);
}

export async function revealIn(v: ViewportContext, selector: string, nodeId?: NodeId): Promise<boolean> {
  if (!isCurrentViewport(v)) {
    await switchToViewport(v);
    return revealSelector(selector);
  }
  return revealSelector(selector, { nodeId });
}
