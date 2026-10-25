import type { DeviceProfile, Orientation, Posture } from '@shared/types';
import { foldInViewport, resolveViewport } from '@/modules/device-simulator/viewport';
import type { RemoteDevice, RemoteFold } from './protocol';

/** Whether a profile should get mobile viewport semantics (meta viewport, overlay scrollbars). */
export function isMobileProfile(device: DeviceProfile): boolean {
  if (device.platform === 'ios' || device.platform === 'android') return true;
  if (device.category === 'phone' || device.category === 'foldable' || device.category === 'tablet') return true;
  return device.category === 'custom' && device.touch;
}

/**
 * Chromium emulation parameters for a device at a posture/orientation.
 *
 * `size` is the viewport actually rendered (it differs from the resolved geometry while a
 * fold transition animates); the fold is only emulated when the size matches the resting
 * expanded geometry, because a half-open hinge has no well-defined viewport segments.
 */
export function remoteEmulation(
  device: DeviceProfile,
  posture: Posture,
  orientation: Orientation,
  size?: { width: number; height: number },
): { device: RemoteDevice; fold: RemoteFold | null } {
  const g = resolveViewport(device, posture, orientation).geometry;
  const width = Math.round(size?.width ?? g.viewport.width);
  const height = Math.round(size?.height ?? g.viewport.height);
  const resting = Math.abs(width - g.viewport.width) < 1 && Math.abs(height - g.viewport.height) < 1;
  const f = resting ? foldInViewport(g) : null;
  const extent = f?.axis === 'vertical' ? width : height;
  const fold: RemoteFold | null =
    f && f.offset > 0 && f.offset + f.maskLength < extent ? { axis: f.axis, offset: Math.round(f.offset), maskLength: Math.round(f.maskLength) } : null;
  return {
    device: {
      width,
      height,
      dpr: device.pixelRatio,
      mobile: isMobileProfile(device),
      touch: device.touch,
      userAgent: device.userAgent,
      screen: { width: Math.max(width, Math.round(g.screen.width)), height: Math.max(height, Math.round(g.screen.height)) },
      orientation,
    },
    fold,
  };
}

/** Viewport + fold in the shape `captureChromium` expects. */
export function chromiumViewportFor(device: DeviceProfile, posture: Posture, orientation: Orientation, dprCap = 4) {
  const e = remoteEmulation(device, posture, orientation);
  const { width, height, dpr, mobile, touch, userAgent } = e.device;
  return { viewport: { width, height, dpr: Math.min(dpr, dprCap), mobile, touch, userAgent }, fold: e.fold };
}
