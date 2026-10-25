import type { ComponentType } from 'react';

/**
 * Central action registry shared by the toolbar, command palette, menus and
 * keyboard shortcuts. Modules register their actions at startup.
 */
export type StudioAction = {
  id: string;
  label: string;
  group: 'Project' | 'Edit' | 'View' | 'Device' | 'Inspect' | 'Test' | 'AI' | 'Export' | 'Navigate' | 'Help';
  shortcut?: string;
  icon?: ComponentType<{ size?: number }>;
  keywords?: string;
  run: () => void | Promise<void>;
  enabled?: () => boolean;
};

const registry = new Map<string, StudioAction>();
const listeners = new Set<() => void>();
const runListeners = new Set<(id: string) => void>();

/** Observe action executions (used by the local, opt-in telemetry log). */
export function onActionRun(fn: (id: string) => void): () => void {
  runListeners.add(fn);
  return () => {
    runListeners.delete(fn);
  };
}

export function registerActions(actions: StudioAction[]) {
  for (const a of actions) registry.set(a.id, a);
  listeners.forEach((l) => l());
}

export function getAction(id: string) {
  return registry.get(id);
}

export function allActions(): StudioAction[] {
  return [...registry.values()];
}

export function runAction(id: string) {
  const a = registry.get(id);
  if (!a) {
    console.warn('[ifdy] unknown action', id);
    return;
  }
  if (a.enabled && !a.enabled()) return;
  runListeners.forEach((l) => l(id));
  void a.run();
}

export function onActionsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Match a keyboard event against a shortcut string like "Mod+Shift+K". */
export function matchesShortcut(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean }, shortcut: string): boolean {
  const parts = shortcut.split('+');
  const key = parts.pop()!;
  const want = { mod: parts.includes('Mod'), shift: parts.includes('Shift'), alt: parts.includes('Alt') };
  const meta = e.metaKey ?? e.meta ?? false;
  const ctrl = e.ctrlKey ?? e.ctrl ?? false;
  const shift = e.shiftKey ?? e.shift ?? false;
  const alt = e.altKey ?? e.alt ?? false;
  const mod = isMac ? meta : ctrl;
  if (mod !== want.mod || shift !== want.shift || alt !== want.alt) return false;
  if (!want.mod && (meta || ctrl)) return false;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const target = key.length === 1 ? key.toLowerCase() : key;
  if (target === '=' && (k === '=' || k === '+')) return true;
  if (shift && /^[0-9]$/.test(target)) {
    // Shift+digit produces symbols on most layouts.
    const map: Record<string, string> = { '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0' };
    return k === target || map[k] === target;
  }
  return k === target;
}
