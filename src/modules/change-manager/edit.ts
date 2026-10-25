import type { Change, ChangeOrigin, MatchedRule, NodeInfo } from '@shared/types';
import { studio } from '@/store';
import { currentViewportContext } from '@/modules/device-simulator/context';
import { changeId, makeChange, mediaForViewport } from './changes';

/**
 * The single entry point for edits made anywhere in the studio (inspector,
 * canvas handles, box model, tokens, AI fixes). Every edit becomes a Change and
 * is therefore undoable, exportable and re-applied after preview reloads.
 */

function selectionInfo(): NodeInfo | null {
  return studio().selection.info;
}

function classSelectorFor(info: NodeInfo): string {
  const stable = info.classes.filter((c) => /^[a-zA-Z_][\w-]*$/.test(c) && !/\d{4,}/.test(c));
  return stable.length ? info.tag + stable.map((c) => `.${c}`).join('') : info.selector;
}

function targetFor(info: NodeInfo, scope: 'element' | 'selector') {
  return { selector: scope === 'selector' ? classSelectorFor(info) : info.selector, label: info.label };
}

function mediaFor(): string | undefined {
  const { editTarget } = studio();
  if (editTarget.media === 'all') return undefined;
  return mediaForViewport(currentViewportContext(), editTarget.media);
}

export type StyleEdit = { property: string; value: string; before?: string | null };

/** Build style changes for the current selection without committing them. */
export function styleChanges(edits: StyleEdit[], origin: ChangeOrigin, opts: { info?: NodeInfo; experiment?: boolean; note?: string } = {}): Change[] {
  const info = opts.info ?? selectionInfo();
  if (!info) return [];
  const { editTarget } = studio();
  const groupId = edits.length > 1 ? changeId() : undefined;
  const viewport = currentViewportContext();
  return edits.map((e) =>
    makeChange({
      kind: 'style',
      target: targetFor(info, editTarget.scope),
      property: e.property,
      before: e.before !== undefined ? e.before : info.computed[e.property] ?? null,
      after: e.value,
      media: mediaFor(),
      scope: editTarget.scope,
      viewport,
      origin,
      experiment: opts.experiment ?? false,
      groupId,
      note: opts.note,
    }),
  );
}

export function setStyle(property: string, value: string, origin: ChangeOrigin = 'inspector') {
  const changes = styleChanges([{ property, value }], origin);
  if (changes.length) studio().commitChange(changes);
}

export function setStyles(edits: StyleEdit[], origin: ChangeOrigin = 'inspector') {
  const changes = styleChanges(edits, origin);
  if (changes.length) studio().commitChange(changes);
}

/** Live preview during scrubbing/dragging; committed later with setStyle. */
export function previewStyle(property: string, value: string, origin: ChangeOrigin = 'inspector') {
  studio().previewChange(styleChanges([{ property, value }], origin));
}

export function previewStyles(edits: StyleEdit[], origin: ChangeOrigin = 'canvas') {
  studio().previewChange(styleChanges(edits, origin));
}

export function cancelPreview() {
  studio().previewChange(null);
}

/** Edit (or disable with value=null) a declaration inside a stylesheet rule via the CSSOM. */
export function setRuleDeclaration(rule: MatchedRule, property: string, value: string | null, before: string | null, origin: ChangeOrigin = 'styles', experiment = false) {
  const info = selectionInfo();
  studio().commitChange(
    makeChange({
      kind: 'rule',
      target: {
        selector: info?.selector ?? rule.selector,
        label: info?.label ?? rule.selector,
        ruleKey: rule.key,
        ruleSelector: rule.selector,
        ruleSource: rule.source.label + (rule.source.line ? `:${rule.source.line}` : ''),
        ruleMedia: rule.media,
      },
      property,
      before,
      after: value,
      scope: 'selector',
      viewport: currentViewportContext(),
      origin,
      experiment,
    }),
  );
}

export function setText(selector: string, label: string, before: string, after: string, origin: ChangeOrigin = 'inspector') {
  studio().commitChange(
    makeChange({ kind: 'text', target: { selector, label }, property: 'textContent', before, after, viewport: currentViewportContext(), origin }),
  );
}

export function setAttribute(name: string, value: string | null, origin: ChangeOrigin = 'inspector', kind: 'attribute' | 'asset' = 'attribute') {
  const info = selectionInfo();
  if (!info) return;
  const before = info.attrs.find(([n]) => n === name)?.[1] ?? null;
  studio().commitChange(
    makeChange({ kind, target: { selector: info.selector, label: info.label }, property: name, before, after: value, viewport: currentViewportContext(), origin }),
  );
}

export function toggleHidden(info = selectionInfo()) {
  if (!info) return;
  const s = studio();
  const existing = [...s.changes].reverse().find((c) => c.kind === 'visibility' && c.target.selector === info.selector);
  const hidden = existing?.after === 'hidden';
  s.commitChange(
    makeChange({
      kind: 'visibility',
      target: { selector: info.selector, label: info.label },
      property: 'display',
      before: hidden ? 'hidden' : 'visible',
      after: hidden ? 'visible' : 'hidden',
      viewport: currentViewportContext(),
      origin: 'canvas',
    }),
  );
}

export function isHidden(selector: string): boolean {
  const last = [...studio().changes].reverse().find((c) => c.kind === 'visibility' && c.target.selector === selector);
  return last?.after === 'hidden';
}

/** The latest committed value of a style property for the selection (if IFDY edited it). */
export function editedValue(property: string, info = selectionInfo()): string | null {
  if (!info) return null;
  const s = studio();
  const all = [...s.changes, ...s.transient];
  for (let i = all.length - 1; i >= 0; i--) {
    const c = all[i];
    if (c.kind === 'style' && c.property === property && (c.target.selector === info.selector || c.target.selector === classSelectorFor(info))) return c.after;
  }
  return null;
}
