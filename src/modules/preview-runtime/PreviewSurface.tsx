import type { CSSProperties } from 'react';
import type { DeviceProfile, Orientation, Posture, PreviewEngine } from '@shared/types';
import type { PreviewSource } from '@/store';
import { sourceUrl } from '@/modules/project-adapter/source';
import { PreviewFrame, type PreviewRole } from './PreviewFrame';
import { RemoteFrame } from './remote/RemoteFrame';

/**
 * Picks the preview engine for a source:
 *  - frame:  sandboxed iframe + agent (demo, imported projects, local dev servers)
 *  - remote: server-controlled Chromium streamed to the canvas (public URLs)
 *  - embed:  plain iframe for public URLs that allow framing (read-only)
 */
export function PreviewSurface({
  source,
  route,
  instanceId,
  role,
  width,
  height,
  device,
  posture,
  orientation,
  colorScheme,
  interactive,
  style,
  engine = 'auto',
}: {
  engine?: PreviewEngine;
  source: PreviewSource;
  route: string;
  instanceId: string;
  role: PreviewRole;
  width: number;
  height: number;
  device: DeviceProfile;
  posture: Posture;
  orientation: Orientation;
  colorScheme?: 'light' | 'dark' | null;
  interactive: boolean;
  style?: CSSProperties;
}) {
  const src = sourceUrl(source, route);
  const title = `Preview on ${device.name}`;
  // An explicit engine streams the page from the companion: any source, rendered by
  // Chromium, WebKit or Safari in the iOS Simulator.
  const remoteEngine = engine !== 'auto' ? engine : source.kind === 'url' && source.engine === 'remote' ? 'chromium' : null;
  if (remoteEngine) {
    return (
      <RemoteFrame
        engine={remoteEngine}
        instanceId={instanceId}
        role={role}
        url={src}
        width={width}
        height={height}
        device={device}
        posture={posture}
        orientation={orientation}
        colorScheme={colorScheme}
        interactive={interactive}
      />
    );
  }
  return (
    <PreviewFrame
      instanceId={instanceId}
      role={role}
      src={src}
      width={width}
      height={height}
      colorScheme={colorScheme}
      interactive={interactive}
      title={title}
      style={style}
      engine={source.kind === 'url' ? 'embed' : 'frame'}
    />
  );
}
