import { ContextMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import type { NodeId, NodeInfo } from '@shared/types';
import { bus } from '@/lib/events';
import { studio } from '@/store';
import { previews } from '@/modules/preview-runtime/registry';
import { refreshSelection, watchOverlayIds } from '@/modules/preview-runtime/sync';
import { toggleHidden } from '@/modules/change-manager/edit';
import { copyText, cssForInfo } from '@/modules/canvas/clipboard';
import s from '@/ui/overlay.module.css';

/** Right-click menu shared by the Layers and DOM trees. */
export function NodeContextMenu({ nodeId, children, disabled }: { nodeId: NodeId; children: ReactNode; disabled?: boolean }) {
  if (disabled) return <>{children}</>;
  const withInfo = async (fn: (info: NodeInfo) => void) => {
    const conn = previews.get('primary');
    const info = await conn?.call('node.info', { id: nodeId }).catch(() => null);
    if (info) fn(info);
  };
  const select = () => {
    studio().select('primary', nodeId, null);
    void refreshSelection();
    watchOverlayIds();
  };
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={s.menu}>
          <ContextMenu.Item className={s.item} onSelect={select}>
            <span className={s.itemLabel}>Select</span>
          </ContextMenu.Item>
          <ContextMenu.Item className={s.item} onSelect={() => previews.get('primary')?.tell('node.scrollIntoView', { id: nodeId })}>
            <span className={s.itemLabel}>Scroll into view</span>
          </ContextMenu.Item>
          <ContextMenu.Separator className={s.separator} />
          <ContextMenu.Item className={s.item} onSelect={() => withInfo((i) => copyText(i.selector, 'Selector copied'))}>
            <span className={s.itemLabel}>Copy selector</span>
          </ContextMenu.Item>
          <ContextMenu.Item className={s.item} onSelect={() => withInfo((i) => copyText(cssForInfo(i), 'CSS copied'))}>
            <span className={s.itemLabel}>Copy CSS</span>
          </ContextMenu.Item>
          <ContextMenu.Item className={s.item} onSelect={() => withInfo((i) => toggleHidden(i))}>
            <span className={s.itemLabel}>Hide / show in preview</span>
          </ContextMenu.Item>
          <ContextMenu.Separator className={s.separator} />
          <ContextMenu.Item
            className={s.item}
            onSelect={() => {
              select();
              studio().setRightTab('styles');
            }}
          >
            <span className={s.itemLabel}>Inspect styles</span>
          </ContextMenu.Item>
          <ContextMenu.Item
            className={s.item}
            onSelect={() => {
              select();
              bus.emit('ai-diagnose', { nodeId });
            }}
          >
            <span className={s.itemLabel}>Diagnose with AI</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
