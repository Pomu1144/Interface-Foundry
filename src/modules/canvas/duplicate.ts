import type { Orientation, Posture } from '@shared/types';
import { bus } from '@/lib/events';
import { studio } from '@/store';
import { previews } from '@/modules/preview-runtime/registry';

/**
 * "Duplicate into": open the current view on another device. The copy shares
 * the route and every edit (patches are applied to all previews); its scroll
 * position is copied from the board it was duplicated from once it loads.
 */

const lastScroll = new Map<string, { x: number; y: number }>();
const pendingScroll = new Map<string, { x: number; y: number }>();

bus.on('agent-scroll', ({ instanceId, ratioX, ratioY }) => lastScroll.set(instanceId, { x: ratioX, y: ratioY }));
bus.on('preview-hello', ({ instanceId }) => {
  const sc = pendingScroll.get(instanceId);
  if (!sc) return;
  pendingScroll.delete(instanceId);
  // Let the page lay out at its new size before scrolling.
  setTimeout(() => previews.get(instanceId)?.tell('scroll.set', { x: sc.x, y: sc.y, ratio: true }), 120);
});

export function duplicateInto(fromInstanceId: string | null, deviceId: string, posture: Posture, orientation?: Orientation) {
  const s = studio();
  const from = fromInstanceId?.startsWith('dup-') ? s.duplicates.find((d) => `dup-${d.id}` === fromInstanceId) : null;
  const id = s.addDuplicate({ deviceId, posture, orientation: orientation ?? from?.orientation ?? s.viewport.orientation });
  const sc = lastScroll.get(fromInstanceId ?? 'primary');
  if (sc) pendingScroll.set(`dup-${id}`, sc);
  return id;
}
