import type { AgentMethod, AgentMethods } from '@shared/protocol';
import { studio } from '@/store';
import type { PreviewConnection } from './connection';

/** Live preview connections keyed by instance id (non-serialisable, kept outside the store). */
const connections = new Map<string, PreviewConnection>();
const listeners = new Set<() => void>();

export const previews = {
  register(conn: PreviewConnection) {
    connections.set(conn.id, conn);
    listeners.forEach((l) => l());
  },
  unregister(id: string) {
    connections.delete(id);
    listeners.forEach((l) => l());
  },
  get(id: string | null | undefined): PreviewConnection | undefined {
    return id ? connections.get(id) : undefined;
  },
  /** The connection the inspector works against. */
  primary(): PreviewConnection | undefined {
    const s = studio();
    const selected = s.selection.instanceId ? connections.get(s.selection.instanceId) : undefined;
    if (selected?.ready) return selected;
    for (const [id, c] of connections) if (s.instances[id]?.role === 'primary' && c.ready) return c;
    return connections.get('primary');
  },
  all(): PreviewConnection[] {
    return [...connections.values()];
  },
  ready(): PreviewConnection[] {
    return [...connections.values()].filter((c) => c.ready);
  },
  broadcast<M extends AgentMethod>(method: M, params?: AgentMethods[M][0], filter?: (c: PreviewConnection) => boolean) {
    for (const c of connections.values()) if (c.ready && (!filter || filter(c))) c.tell(method, params);
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

/** Call the primary preview, throwing a readable error when nothing is connected. */
export async function callPrimary<M extends AgentMethod>(method: M, params?: AgentMethods[M][0], timeoutMs?: number): Promise<AgentMethods[M][1]> {
  const conn = previews.primary();
  if (!conn || !conn.ready) throw new Error('No preview is connected. Open a project first.');
  return conn.call(method, params, timeoutMs);
}
