import type { DocTab } from '@/store';
import { EmptyState } from '@/ui';

export default function ReportDoc({ doc }: { doc: DocTab }) {
  return <EmptyState title={doc.title}>Not available yet.</EmptyState>;
}
