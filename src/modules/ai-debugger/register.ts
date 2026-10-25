import { Sparkles } from 'lucide-react';
import { registerActions } from '@/app/actions';
import { bus } from '@/lib/events';
import { studio, useStudio } from '@/store';
import { previews } from '@/modules/preview-runtime/registry';
import { refreshSelection } from '@/modules/preview-runtime/sync';
import { currentViewportContext } from '@/modules/device-simulator/context';
import { diagnose, loadStatus, syncFixStates } from './engine';
import { ai, useAi } from './state';

let registered = false;

/** Open the AI tab and diagnose the given (or current) selection. */
export async function openAndDiagnose(nodeId?: number) {
  const s = studio();
  s.setRightTab('ai');
  if (nodeId !== undefined && nodeId !== s.selection.nodeId) {
    const instanceId = s.selection.instanceId ?? previews.primary()?.id ?? null;
    s.select(instanceId, nodeId, null);
    await refreshSelection();
  }
  if (!studio().selection.info) return;
  useAi.setState({ view: 'diagnose' });
  const key = `${studio().currentRoute}::${studio().selection.info!.selector}`;
  const thread = ai().threads[key];
  const running = thread?.turns.some((t) => t.status === 'collecting' || t.status === 'running');
  if (running) return;
  // A diagnosis of this element at this exact viewport is shown instead of re-run.
  const vp = currentViewportContext();
  const fresh = thread?.turns.some((t) => t.status === 'done' && t.context && t.context.viewport.width === vp.width && t.context.viewport.height === vp.height && t.context.viewport.posture === vp.posture && t.context.viewport.deviceId === vp.deviceId);
  if (fresh) return;
  await diagnose(defaultQuestion());
}

function defaultQuestion() {
  const s = studio();
  const info = s.selection.info;
  if (info && s.device().expanded && s.viewport.posture === 'expanded') return 'Why does it look different expanded?';
  return 'Why is this overflowing?';
}

export function registerAiDebugger() {
  if (registered) return;
  registered = true;
  registerActions([
    {
      id: 'ai.diagnose',
      label: 'Diagnose selection with AI',
      group: 'AI',
      shortcut: 'Mod+Shift+D',
      icon: Sparkles,
      keywords: 'ai anthropic model debug root cause layout overflow hinge fix',
      enabled: () => Boolean(studio().project),
      run: () => openAndDiagnose(),
    },
    {
      id: 'ai.debug',
      label: 'Root-cause debugging mode',
      group: 'AI',
      icon: Sparkles,
      keywords: 'ai debug experiments declarations media queries',
      enabled: () => Boolean(studio().project),
      run: () => {
        studio().setRightTab('ai');
        useAi.setState({ view: 'debug' });
      },
    },
  ]);
  bus.on('ai-diagnose', ({ nodeId }) => void openAndDiagnose(nodeId));
  useStudio.subscribe((s) => s.changes, () => syncFixStates());
  useStudio.subscribe(
    (s) => s.server.status,
    (st) => {
      if (st === 'online' || st === 'offline') void loadStatus();
    },
  );
  if (studio().server.status !== 'unknown') void loadStatus();
}
