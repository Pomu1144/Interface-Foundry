import { useEffect, useState } from 'react';
import type { StylesPayload } from '@shared/types';
import { useStudio } from '@/store';
import { previews } from '@/modules/preview-runtime/registry';

/** Matched rules / cascade for the selection, refreshed after edits. */
export function useNodeStyles(): { styles: StylesPayload | null; loading: boolean; error: string | null } {
  const nodeId = useStudio((st) => st.selection.nodeId);
  const instanceId = useStudio((st) => st.selection.instanceId);
  const info = useStudio((st) => st.selection.info);
  const changes = useStudio((st) => st.changes.length);
  const transient = useStudio((st) => st.transient.length);
  const [state, setState] = useState<{ styles: StylesPayload | null; loading: boolean; error: string | null }>({ styles: null, loading: false, error: null });
  useEffect(() => {
    if (nodeId === null) {
      setState({ styles: null, loading: false, error: null });
      return;
    }
    const conn = previews.get(instanceId) ?? previews.primary();
    if (!conn?.ready) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    const t = setTimeout(() => {
      conn
        .call('node.styles', { id: nodeId })
        .then((styles) => !cancelled && setState({ styles, loading: false, error: null }))
        .catch((e: Error) => !cancelled && setState({ styles: null, loading: false, error: e.message }));
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [nodeId, instanceId, info, changes, transient]);
  return state;
}

/** Full computed style map for the selection. */
export function useComputed(): Record<string, string> | null {
  const nodeId = useStudio((st) => st.selection.nodeId);
  const instanceId = useStudio((st) => st.selection.instanceId);
  const info = useStudio((st) => st.selection.info);
  const [computed, setComputed] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (nodeId === null) return setComputed(null);
    const conn = previews.get(instanceId) ?? previews.primary();
    if (!conn?.ready) return;
    let cancelled = false;
    conn
      .call('node.computed', { id: nodeId })
      .then((c) => !cancelled && setComputed(c))
      .catch(() => !cancelled && setComputed(null));
    return () => {
      cancelled = true;
    };
  }, [nodeId, instanceId, info]);
  return computed;
}

/** Whether IFDY has an active edit for a property on the current selection. */
export function useEdited(property: string): boolean {
  const selector = useStudio((st) => st.selection.info?.selector);
  return useStudio((st) => st.changes.some((c) => (c.kind === 'style' || c.kind === 'visibility') && c.property === property && c.target.selector === selector));
}
