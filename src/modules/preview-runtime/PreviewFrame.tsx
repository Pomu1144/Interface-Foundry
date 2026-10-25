import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { encodeWindowName } from '@shared/protocol';
import { studio, useStudio } from '@/store';
import { previewOrigin } from '@/modules/project-adapter/server-api';
import { createFrameTransport, newSession, PreviewConnection } from './connection';
import { previews } from './registry';
import { wireConnection } from './wire';

export type PreviewRole = 'primary' | 'compare' | 'wall' | 'worker';

/**
 * A live, sandboxed preview. The iframe element is never remounted for
 * viewport changes, so page state (focus, typed input, scroll) survives
 * folding, rotation and device switches exactly as on real hardware.
 */
export function PreviewFrame({
  instanceId,
  role,
  src,
  width,
  height,
  colorScheme,
  interactive = true,
  title,
  style,
  engine = 'frame',
}: {
  instanceId: string;
  role: PreviewRole;
  src: string;
  width: number;
  height: number;
  colorScheme?: 'light' | 'dark' | null;
  interactive?: boolean;
  title: string;
  style?: CSSProperties;
  /** 'embed' = third-party page without the agent (read-only). */
  engine?: 'frame' | 'embed';
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const session = useMemo(() => newSession(), []);
  const settings = useStudio((s) => s.settings);
  const reloadNonce = useStudio((s) => s.reloadNonce);
  const flags = [settings.instrumentEvents ? 'ev' : '', settings.instrumentNetwork ? 'net' : ''].filter(Boolean).join(',');

  const srcOrigin = useMemo(() => {
    try {
      return new URL(src, location.href).origin;
    } catch {
      return previewOrigin();
    }
  }, [src]);
  // Never grant allow-same-origin to content served from the studio's own origin.
  const sameAsStudio = srcOrigin === location.origin;
  const sandbox = ['allow-scripts', 'allow-forms', 'allow-modals', 'allow-popups', 'allow-downloads', 'allow-popups-to-escape-sandbox', sameAsStudio ? '' : 'allow-same-origin']
    .filter(Boolean)
    .join(' ');

  // Connection lifecycle (one per mounted frame).
  useEffect(() => {
    if (engine === 'embed') {
      studio().upsertInstance(instanceId, { role, status: 'loading', url: src, engine: 'embed', title: '' });
      return () => studio().removeInstance(instanceId);
    }
    const transport = createFrameTransport(session, () => ref.current, () => (sameAsStudio ? 'null' : srcOrigin));
    const conn = new PreviewConnection(instanceId, session, transport);
    previews.register(conn);
    const unwire = wireConnection(conn, role);
    studio().upsertInstance(instanceId, { role, status: 'loading', url: src, engine: 'frame', error: undefined });
    return () => {
      unwire();
      conn.dispose();
      previews.unregister(instanceId);
      studio().removeInstance(instanceId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, session, engine]);

  // Source changes navigate the existing frame.
  const lastSrc = useRef<string | null>(null);
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    if (lastSrc.current === src) return;
    lastSrc.current = src;
    // Hash-only change of the loaded document (hash routes): a fragment navigation never
    // reloads the page, so no new hello would follow. Route it through the agent instead.
    const live = studio().instances[instanceId];
    const conn = previews.get(instanceId);
    if (conn?.ready && live?.status === 'ready' && live.url && src.includes('#') && live.url.split('#')[0] === src.split('#')[0]) {
      if (live.url !== src) conn.tell('nav.go', { url: src.slice(src.indexOf('#')) });
      return;
    }
    previews.get(instanceId)?.resetPending('Navigating');
    studio().upsertInstance(instanceId, { status: 'loading', url: src, error: undefined });
    frame.src = src;
  }, [src, instanceId]);

  // Explicit reloads keep the session; the agent says hello again and state is re-applied.
  const firstReload = useRef(true);
  useEffect(() => {
    if (firstReload.current) {
      firstReload.current = false;
      return;
    }
    const frame = ref.current;
    if (!frame) return;
    previews.get(instanceId)?.resetPending('Reloading');
    studio().upsertInstance(instanceId, { status: 'loading', error: undefined });
    frame.src = frame.src;
  }, [reloadNonce, instanceId]);

  // Instrumentation flags are read by the agent at document start: update name and reload.
  const lastFlags = useRef(flags);
  useEffect(() => {
    const frame = ref.current;
    if (!frame || lastFlags.current === flags) return;
    lastFlags.current = flags;
    frame.name = `${encodeWindowName(session, location.origin)}|${flags}`;
    frame.src = frame.src;
  }, [flags, session]);

  // Detect pages that load without the agent answering.
  const onLoad = () => {
    const inst = studio().instances[instanceId];
    if (engine === 'embed') {
      studio().upsertInstance(instanceId, { status: 'ready' });
      return;
    }
    setTimeout(() => {
      const now = studio().instances[instanceId];
      if (now && now.status === 'loading' && inst) {
        studio().upsertInstance(instanceId, {
          status: 'error',
          error: 'The page loaded, but the IFDY agent did not respond. Inspection requires a page served through IFDY (demo, imported project, or a connected local dev server).',
        });
      }
    }, 6000);
  };

  return (
    <iframe
      ref={ref}
      name={`${encodeWindowName(session, location.origin)}|${flags}`}
      title={title}
      sandbox={engine === 'embed' ? 'allow-scripts allow-forms allow-popups allow-same-origin' : sandbox}
      referrerPolicy="no-referrer"
      allow="clipboard-write"
      onLoad={onLoad}
      data-instance={instanceId}
      style={{
        display: 'block',
        width,
        height,
        border: 0,
        background: '#fff',
        colorScheme: colorScheme ?? 'normal',
        pointerEvents: interactive ? 'auto' : 'none',
        ...style,
      }}
    />
  );
}
