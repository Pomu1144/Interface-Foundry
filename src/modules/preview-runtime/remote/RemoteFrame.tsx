import type { DeviceProfile, Orientation, Posture } from '@shared/types';
import type { PreviewRole } from '../PreviewFrame';

/**
 * Controlled-browser preview (server-side Chromium streamed to the canvas).
 * Placeholder until the controlled browser engine is connected.
 */
export function RemoteFrame(props: {
  instanceId: string;
  role: PreviewRole;
  url: string;
  width: number;
  height: number;
  device: DeviceProfile;
  posture: Posture;
  orientation: Orientation;
  colorScheme?: 'light' | 'dark' | null;
  interactive: boolean;
}) {
  return (
    <div data-instance={props.instanceId} style={{ width: props.width, height: props.height, display: 'grid', placeItems: 'center', background: '#111', color: '#888', font: '12px system-ui' }}>
      Controlled browser engine not available.
    </div>
  );
}
