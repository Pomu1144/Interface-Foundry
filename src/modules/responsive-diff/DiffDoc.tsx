import type { DocTab } from '@/store';
import { EmptyState } from '@/ui';

export default function DiffDoc({ doc }: { doc: DocTab }) {
  return <EmptyState title={doc.title}>Not available yet.</EmptyState>;
}
