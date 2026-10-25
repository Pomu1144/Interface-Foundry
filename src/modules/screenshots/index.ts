import { Camera } from 'lucide-react';
import { toast } from 'sonner';
import { registerActions } from '@/app/actions';
import { studio } from '@/store';
import { openDiff } from '@/modules/responsive-diff/open';
import { captureCurrent } from './capture';

export { captureCurrent, captureProfiles, captureFoldPair, chromiumStatus, baselineKey } from './capture';
export { getLayout } from './layouts';

let busy = false;

/** Toolbar camera / Mod+Shift+S: capture the canvas preview. */
export async function captureScreenshotAction() {
  if (busy) return;
  busy = true;
  const id = toast.loading('Capturing the preview…');
  try {
    const { captures, warnings } = await captureCurrent();
    const kinds = captures.map((c) => (c.kind === 'chromium' ? 'Chromium' : 'DOM raster (approximate)')).join(' + ');
    toast.success(`Screenshot saved · ${kinds}`, {
      id,
      description: warnings.join(' ') || `${captures[0].viewport.deviceName} · ${captures[0].viewport.width}×${captures[0].viewport.height}`,
      action: { label: 'Open', onClick: () => openDiff({ b: captures[captures.length - 1].id }) },
    });
  } catch (err) {
    toast.error('Capture failed', { id, description: err instanceof Error ? err.message : String(err) });
  } finally {
    busy = false;
  }
}

export function registerScreenshots() {
  registerActions([
    {
      id: 'capture.screenshot',
      label: 'Capture screenshot of the preview',
      group: 'Test',
      shortcut: 'Mod+Shift+S',
      icon: Camera,
      keywords: 'screenshot raster chromium baseline',
      enabled: () => Boolean(studio().project && studio().instances.primary?.status === 'ready'),
      run: captureScreenshotAction,
    },
  ]);
}
