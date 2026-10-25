import { studio } from '@/store';

export const DIFF_DOC_ID = 'responsive-diff';

export type DiffDocData = { a?: string; b?: string; view?: string };

/** Open (or focus) the responsive diff document, optionally comparing two captures. */
export function openDiff(data: DiffDocData = {}) {
  const s = studio();
  const existing = s.documents.find((d) => d.id === DIFF_DOC_ID);
  const prev = (existing?.data ?? {}) as DiffDocData;
  s.openDoc({ id: DIFF_DOC_ID, kind: 'diff', title: 'Responsive diff', data: { ...prev, ...data } });
}
