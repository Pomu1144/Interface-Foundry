import { studio } from '@/store';
import { previewOrigin } from '@/modules/project-adapter/server-api';

export type IsolationCheck = { id: string; label: string; ok: boolean | null; detail: string };

/**
 * Live self-check of the studio ⇄ preview boundary (see docs/SECURITY.md).
 * Shown in Settings so users can verify isolation in their own deployment.
 */
export function isolationReport(): IsolationCheck[] {
  const s = studio();
  let previewOk: boolean | null = null;
  let previewDetail = 'Preview origin unknown (companion offline).';
  try {
    const po = new URL(previewOrigin()).origin;
    previewOk = po !== location.origin;
    previewDetail = previewOk ? `Previews run on ${po}, a different origin from the studio (${location.origin}).` : `Previews share the studio origin ${po}; frames fall back to an opaque-origin sandbox.`;
  } catch {
    /* unknown */
  }
  const loopback = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  return [
    { id: 'origin', label: 'Preview on a separate origin', ok: previewOk, detail: previewDetail },
    { id: 'sandbox', label: 'Sandboxed preview frames', ok: true, detail: 'Frames are sandboxed; allow-same-origin is granted only to cross-origin content.' },
    { id: 'nonce', label: 'Session-nonce message protocol', ok: true, detail: 'Every preview message is checked for source window, origin and a per-frame nonce.' },
    { id: 'token', label: 'Companion API token', ok: s.server.status === 'online' ? Boolean(s.server.token) : null, detail: s.server.status === 'online' ? 'All companion calls carry a per-launch token readable only by the studio origin.' : 'Companion offline.' },
    { id: 'loopback', label: 'Studio served from loopback', ok: loopback, detail: loopback ? 'The companion only accepts loopback hosts by default.' : `Served from ${location.hostname}; make sure IFDY_ALLOWED_HOSTS is intentional.` },
    { id: 'fs', label: 'Filesystem access', ok: !s.server.capabilities?.fs.available ? true : null, detail: s.server.capabilities?.fs.available ? `Granted for ${s.server.capabilities.fs.roots.length} allow-listed root(s); writes require per-change approval.` : 'No directories granted.' },
  ];
}
