import clsx from 'clsx';
import { X } from 'lucide-react';
import { Dialog as RDialog, DropdownMenu, Popover as RPopover, Tooltip as RTooltip } from 'radix-ui';
import { Fragment, type ReactElement, type ReactNode } from 'react';
import s from './overlay.module.css';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Render a shortcut like "Mod+Shift+K" as platform keycaps. */
export function Kbd({ keys }: { keys: string }) {
  const parts = keys.split('+').map((k) => {
    switch (k) {
      case 'Mod':
        return isMac ? '⌘' : 'Ctrl';
      case 'Shift':
        return '⇧';
      case 'Alt':
        return isMac ? '⌥' : 'Alt';
      case 'Enter':
        return '↵';
      case 'Backspace':
        return '⌫';
      case 'Escape':
        return 'Esc';
      default:
        return k.length === 1 ? k.toUpperCase() : k;
    }
  });
  return (
    <span className={s.tooltipShortcut}>
      {parts.map((p, i) => (
        <kbd key={i} className={s.kbd}>
          {p}
        </kbd>
      ))}
    </span>
  );
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={450} skipDelayDuration={250}>
      {children}
    </RTooltip.Provider>
  );
}

export function Tooltip({
  content,
  shortcut,
  side = 'bottom',
  children,
}: {
  content: ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactElement;
}) {
  if (!content) return children;
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content className={s.tooltip} side={side} sideOffset={6} collisionPadding={8}>
          {content}
          {shortcut && <Kbd keys={shortcut} />}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export type MenuEntry =
  | { type?: 'item'; label: string; icon?: ReactNode; hint?: string; shortcut?: string; disabled?: boolean; onSelect: () => void; checked?: boolean }
  | { type: 'separator' }
  | { type: 'label'; label: string };

export function Menu({
  trigger,
  items,
  align = 'start',
  side = 'bottom',
  width,
}: {
  trigger: ReactElement;
  items: MenuEntry[];
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  width?: number;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={s.menu} align={align} side={side} sideOffset={6} collisionPadding={8} style={width ? { width } : undefined}>
          {items.map((it, i) => (
            <Fragment key={i}>
              {it.type === 'separator' ? (
                <DropdownMenu.Separator className={s.separator} />
              ) : it.type === 'label' ? (
                <DropdownMenu.Label className={s.menuLabel}>{it.label}</DropdownMenu.Label>
              ) : (
                <DropdownMenu.Item className={s.item} disabled={it.disabled} onSelect={it.onSelect}>
                  <span className={s.itemIcon}>{it.checked ? '✓' : it.icon}</span>
                  <span className={s.itemLabel}>{it.label}</span>
                  {it.hint && <span className={s.itemHint}>{it.hint}</span>}
                  {it.shortcut && <Kbd keys={it.shortcut} />}
                </DropdownMenu.Item>
              )}
            </Fragment>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  align = 'center',
  side = 'bottom',
  className,
  width,
}: {
  trigger: ReactElement;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  width?: number;
}) {
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content className={clsx(s.popover, className)} align={align} side={side} sideOffset={8} collisionPadding={10} style={width ? { width } : undefined}>
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  icon,
  children,
  footer,
  width,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className={s.dialogOverlay} />
        <RDialog.Content className={s.dialog} style={width ? { width: `min(${width}px, calc(100vw - 32px))` } : undefined} aria-describedby={description ? undefined : undefined}>
          <div className={s.dialogHeader}>
            {icon}
            <div style={{ flex: 1, minWidth: 0 }}>
              <RDialog.Title className={s.dialogTitle}>{title}</RDialog.Title>
              {description ? <RDialog.Description className={s.dialogDescription}>{description}</RDialog.Description> : <RDialog.Description className="sr-only">{String(title)}</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <button className={s.kbd} style={{ width: 24, height: 24, background: 'transparent', boxShadow: 'none', border: 0 }} aria-label="Close">
                <X size={15} />
              </button>
            </RDialog.Close>
          </div>
          <div className={s.dialogBody}>{children}</div>
          {footer && <div className={s.dialogFooter}>{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
