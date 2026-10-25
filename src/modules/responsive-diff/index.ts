import { Columns2, GitCompare } from 'lucide-react';
import { toast } from 'sonner';
import { registerActions } from '@/app/actions';
import { studio } from '@/store';
import { captureFoldPair } from '@/modules/screenshots/capture';
import { openDiff } from './open';

export { openDiff, DIFF_DOC_ID } from './open';
export { buildDiffReport } from './report';
export { structuralDiff } from './structural';

let busy = false;

/** Capture the device folded and expanded in the background preview, then diff them. */
export async function compareFoldedExpanded() {
  if (busy) return;
  busy = true;
  const id = toast.loading('Capturing folded and expanded postures…');
  try {
    const { captures, warnings, deviceName } = await captureFoldPair();
    if (captures.length < 2) throw new Error('Expected two captures.');
    openDiff({ a: captures[0].id, b: captures[1].id, view: 'side' });
    toast.success(`${deviceName}: folded vs expanded`, { id, description: warnings.join(' ') || undefined });
  } catch (err) {
    toast.error('Compare failed', { id, description: err instanceof Error ? err.message : String(err) });
  } finally {
    busy = false;
  }
}

export function registerResponsiveDiff() {
  const hasProject = () => Boolean(studio().project);
  registerActions([
    { id: 'diff.open', label: 'Open responsive diff & screenshots', group: 'Test', icon: GitCompare, keywords: 'captures baseline compare screenshots', enabled: hasProject, run: () => openDiff() },
    {
      id: 'diff.compareFolds',
      label: 'Compare folded vs expanded (capture both postures + diff)',
      group: 'Test',
      icon: Columns2,
      keywords: 'fold hinge posture diff screenshot',
      enabled: hasProject,
      run: compareFoldedExpanded,
    },
  ]);
}
