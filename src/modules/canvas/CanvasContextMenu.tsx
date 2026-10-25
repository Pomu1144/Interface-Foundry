import { ContextMenu } from 'radix-ui';
import { ChevronRight, Copy, FlipHorizontal2, Maximize, RotateCw, TabletSmartphone, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { DeviceProfile, Posture } from '@shared/types';
import { bus } from '@/lib/events';
import { studio, useStudio } from '@/store';
import { flipDevice, rotateDevice } from '@/modules/device-simulator/rotate';
import { BUILT_IN_DEVICES } from '@/modules/device-simulator/devices';
import { duplicateInto } from './duplicate';
import s from '@/ui/overlay.module.css';

const GROUPS: { id: DeviceProfile['category']; label: string }[] = [
  { id: 'phone', label: 'Phones' },
  { id: 'foldable', label: 'Foldables' },
  { id: 'tablet', label: 'Tablets' },
  { id: 'desktop', label: 'Desktop' },
];

/**
 * Right-click menu for the canvas. Opens on the canvas and device hardware,
 * and (in Inspect mode) on the page itself: the preview agent forwards the
 * right-click, which is replayed here at the matching screen position.
 */
export function CanvasContextMenu({ children }: { children: ReactElement }) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const customDevices = useStudio((st) => st.customDevices);
  const duplicates = useStudio((st) => st.duplicates);
  const project = useStudio((st) => st.project);

  useEffect(
    () =>
      bus.on('agent-contextmenu', ({ instanceId, x, y }) => {
        const frame = document.querySelector<HTMLElement>(`iframe[data-instance="${instanceId}"]`);
        const trigger = triggerRef.current;
        if (!frame || !trigger) return;
        const r = frame.getBoundingClientRect();
        const k = frame.offsetWidth ? r.width / frame.offsetWidth : 1;
        setSource(instanceId);
        trigger.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + x * k, clientY: r.top + y * k, button: 2 }));
      }),
    [],
  );

  const devices = [...BUILT_IN_DEVICES, ...customDevices].filter((d) => d.frameStyle !== 'bare' || d.id.startsWith('custom-'));
  const st = studio();
  const sourceDup = source?.startsWith('dup-') ? duplicates.find((d) => `dup-${d.id}` === source) : null;
  const sourceOrientation = sourceDup?.orientation ?? st.viewport.orientation;
  const primary = st.device();
  const go = (deviceId: string, posture: Posture) => duplicateInto(source, deviceId, posture);

  return (
    <ContextMenu.Root modal={false}>
      <ContextMenu.Trigger
        asChild
        ref={triggerRef as never}
        onContextMenu={(e) => {
          // Native right-clicks on the canvas: remember which board was clicked.
          if (e.isTrusted) setSource((e.target as HTMLElement).closest<HTMLElement>('[data-board]')?.dataset.board ?? 'primary');
        }}
        disabled={!project}
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={s.menu} style={{ minWidth: 220 }} data-testid="canvas-menu">
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={s.item}>
              <span className={s.itemIcon}>
                <Copy size={13} />
              </span>
              <span className={s.itemLabel}>Duplicate into</span>
              <ChevronRight size={13} style={{ marginLeft: 'auto', opacity: 0.6 }} />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={s.menu} style={{ minWidth: 240, maxHeight: 'min(70vh, 560px)', overflowY: 'auto' }} sideOffset={4}>
                {GROUPS.map((g) => {
                  const list = devices.filter((d) => d.category === g.id);
                  if (!list.length) return null;
                  return (
                    <ContextMenu.Group key={g.id}>
                      <ContextMenu.Label className={s.menuLabel}>{g.label}</ContextMenu.Label>
                      {list.flatMap((d) =>
                        d.expanded
                          ? (['folded', 'expanded'] as const).map((p) => (
                              <ContextMenu.Item key={`${d.id}-${p}`} className={s.item} onSelect={() => go(d.id, p)}>
                                <span className={s.itemLabel}>{d.name}</span>
                                <span className={s.itemHint}>{p === 'folded' ? 'Folded' : 'Unfolded'}</span>
                              </ContextMenu.Item>
                            ))
                          : [
                              <ContextMenu.Item key={d.id} className={s.item} onSelect={() => go(d.id, 'folded')}>
                                <span className={s.itemLabel}>{d.name}</span>
                                <span className={s.itemHint}>
                                  {d.folded.viewport.width}×{d.folded.viewport.height}
                                </span>
                              </ContextMenu.Item>,
                            ],
                      )}
                    </ContextMenu.Group>
                  );
                })}
                <ContextMenu.Separator className={s.separator} />
                <ContextMenu.Item className={s.item} onSelect={() => duplicateInto(source, sourceDup?.deviceId ?? primary.id, sourceDup?.posture ?? st.viewport.posture, sourceOrientation === 'portrait' ? 'landscape' : 'portrait')}>
                  <span className={s.itemLabel}>Same device, {sourceOrientation === 'portrait' ? 'landscape' : 'portrait'}</span>
                </ContextMenu.Item>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>
          {sourceDup && (
            <ContextMenu.Item className={s.item} onSelect={() => studio().removeDuplicate(sourceDup.id)}>
              <span className={s.itemIcon}>
                <X size={13} />
              </span>
              <span className={s.itemLabel}>Remove this duplicate</span>
            </ContextMenu.Item>
          )}
          {duplicates.length > 0 && (
            <ContextMenu.Item className={s.item} onSelect={() => studio().clearDuplicates()}>
              <span className={s.itemIcon}>
                <Trash2 size={13} />
              </span>
              <span className={s.itemLabel}>Remove all duplicates</span>
              <span className={s.itemHint}>{duplicates.length}</span>
            </ContextMenu.Item>
          )}
          {(!source || source === 'primary') && (
            <>
              <ContextMenu.Separator className={s.separator} />
              {primary.expanded && (
                <ContextMenu.Item className={s.item} onSelect={() => studio().toggleFold()}>
                  <span className={s.itemIcon}>
                    <TabletSmartphone size={13} />
                  </span>
                  <span className={s.itemLabel}>{st.viewport.posture === 'expanded' ? 'Fold' : 'Unfold'}</span>
                  <span className={s.itemHint}>F</span>
                </ContextMenu.Item>
              )}
              <ContextMenu.Item className={s.item} onSelect={() => void rotateDevice()}>
                <span className={s.itemIcon}>
                  <RotateCw size={13} />
                </span>
                <span className={s.itemLabel}>Rotate</span>
                <span className={s.itemHint}>R</span>
              </ContextMenu.Item>
              <ContextMenu.Item className={s.item} onSelect={() => void flipDevice()}>
                <span className={s.itemIcon}>
                  <FlipHorizontal2 size={13} />
                </span>
                <span className={s.itemLabel}>Show back / front</span>
                <span className={s.itemHint}>B</span>
              </ContextMenu.Item>
            </>
          )}
          <ContextMenu.Item className={s.item} onSelect={() => studio().fitCamera()}>
            <span className={s.itemIcon}>
              <Maximize size={13} />
            </span>
            <span className={s.itemLabel}>Fit all on screen</span>
            <span className={s.itemHint}>⇧1</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
