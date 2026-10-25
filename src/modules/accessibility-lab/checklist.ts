/**
 * Manual accessibility checks that automated tools cannot perform, persisted
 * per project in localStorage (viewer convenience; not part of exports).
 */

export type ChecklistStatus = 'untested' | 'pass' | 'fail' | 'na';
export type ChecklistEntry = { status: ChecklistStatus; note?: string; at?: number };
export type ChecklistState = Record<string, ChecklistEntry>;

export type ChecklistItem = { id: string; title: string; how: string; wcag: string };

export const CHECKLIST: ChecklistItem[] = [
  {
    id: 'keyboard-only',
    title: 'Complete key tasks with the keyboard only',
    how: 'Unplug the mouse. Use Tab / Shift+Tab, Enter, Space, arrow keys and Escape to sign in, make a payment and download a statement. Nothing should trap focus.',
    wcag: '2.1.1, 2.1.2',
  },
  {
    id: 'focus-order',
    title: 'Focus order is logical and focus is always visible',
    how: 'Tab through each page: the order should follow the visual reading order and every focused element needs a clearly visible indicator.',
    wcag: '2.4.3, 2.4.7, 2.4.11',
  },
  {
    id: 'screen-reader',
    title: 'Screen reader pass (VoiceOver, NVDA or TalkBack)',
    how: 'Navigate by headings, landmarks and form controls. Every control should announce a meaningful name, role and state; errors and status messages should be announced.',
    wcag: '1.3.1, 4.1.2, 4.1.3',
  },
  {
    id: 'zoom-200',
    title: 'Text resized to 200% / reflow at 320 CSS px',
    how: 'Zoom the browser to 200% (and use the 320px width). Content must not be cut off or overlap, and no two-dimensional scrolling should be needed except for data tables.',
    wcag: '1.4.4, 1.4.10',
  },
  {
    id: 'reduced-motion',
    title: 'Respects “reduce motion”',
    how: 'Enable the OS reduced-motion setting. Non-essential animation (parallax, auto-playing transitions) should stop or be minimised.',
    wcag: '2.3.3, 2.2.2',
  },
  {
    id: 'color-independent',
    title: 'Information is not conveyed by colour alone',
    how: 'View in greyscale. Errors, required fields, positive/negative amounts and statuses must also use text, icons or patterns.',
    wcag: '1.4.1',
  },
  {
    id: 'touch-targets',
    title: 'Touch targets are comfortable on a real device',
    how: 'On a phone or foldable, tap every control with a thumb. Targets should be at least 24px (ideally 44px) and not trigger neighbours.',
    wcag: '2.5.8',
  },
];

const key = (projectId: string) => `ifdy.a11y.checklist.${projectId}`;

export function loadChecklist(projectId: string | null | undefined): ChecklistState {
  if (!projectId) return {};
  try {
    const raw = localStorage.getItem(key(projectId));
    return raw ? (JSON.parse(raw) as ChecklistState) : {};
  } catch {
    return {};
  }
}

export function saveChecklist(projectId: string | null | undefined, state: ChecklistState) {
  if (!projectId) return;
  try {
    localStorage.setItem(key(projectId), JSON.stringify(state));
  } catch {
    /* storage unavailable: state stays in memory */
  }
}

export function checklistProgress(state: ChecklistState): { done: number; total: number; failed: number } {
  let done = 0;
  let failed = 0;
  for (const item of CHECKLIST) {
    const s = state[item.id]?.status ?? 'untested';
    if (s !== 'untested') done++;
    if (s === 'fail') failed++;
  }
  return { done, total: CHECKLIST.length, failed };
}
