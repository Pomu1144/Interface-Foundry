import { openDB, type IDBPDatabase } from 'idb';
import type { LayoutSnapshotEntry } from '@shared/protocol';
import type { FoldGeometry } from '@shared/types';

/**
 * Layout snapshots taken at capture time, keyed by capture id, so structural
 * diffs work for any pair of captures. Kept in a small IndexedDB store of this
 * module (captures themselves live in the project store).
 */
export type CaptureLayout = {
  id: string;
  entries: LayoutSnapshotEntry[];
  viewport: { width: number; height: number };
  fold: FoldGeometry | null;
  scroll: { x: number; y: number };
  /** Image px per CSS px of the capture's bitmap. */
  scale: number;
  /** Where the layout was measured. */
  measuredOn: 'canvas' | 'background';
  at: number;
};

const cache = new Map<string, CaptureLayout | null>();
let dbp: Promise<IDBPDatabase> | null = null;

function db() {
  if (!dbp) {
    dbp = openDB('ifdy-captures', 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('layouts')) d.createObjectStore('layouts');
      },
    });
  }
  return dbp;
}

export async function saveLayout(l: CaptureLayout): Promise<void> {
  cache.set(l.id, l);
  try {
    await (await db()).put('layouts', l, l.id);
  } catch {
    /* IndexedDB unavailable: in-memory only */
  }
}

export async function getLayout(id: string): Promise<CaptureLayout | null> {
  if (cache.has(id)) return cache.get(id) ?? null;
  try {
    const l = ((await (await db()).get('layouts', id)) as CaptureLayout | undefined) ?? null;
    cache.set(id, l);
    return l;
  } catch {
    return null;
  }
}

export async function deleteLayout(id: string): Promise<void> {
  cache.delete(id);
  try {
    await (await db()).delete('layouts', id);
  } catch {
    /* ignore */
  }
}
