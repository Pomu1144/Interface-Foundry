import { bus } from '@/lib/events';

/** Latest scroll offset reported by each preview (agents only report changes). */
export const lastScroll = new Map<string, { x: number; y: number }>();

let started = false;
export function startScrollTracking() {
  if (started) return;
  started = true;
  bus.on('agent-scroll', (e) => lastScroll.set(e.instanceId, { x: e.x, y: e.y }));
  // A (re)loaded page starts at the top.
  bus.on('preview-hello', ({ instanceId }) => lastScroll.set(instanceId, { x: 0, y: 0 }));
}
