import type { Change, MatchedRule } from '@shared/types';
import { studio } from '@/store';
import { changeId, makeChange } from '@/modules/change-manager/changes';
import { currentViewportContext } from '@/modules/device-simulator/context';
import type { CssEdit, DiagnosisContext, ProposedFix } from './schema';
import { restoreSelector } from './redact';

/**
 * Turning proposed fixes and debug experiments into Change records. Previews are
 * experiments (`experiment: true`, origin 'ai'); Apply commits or promotes them.
 */

export function isValidSelector(selector: string): boolean {
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

/** The value a CSS edit replaces, looked up in the diagnosis context (for diff previews). */
export function beforeValue(ctx: DiagnosisContext | undefined, e: CssEdit): string | null {
  if (!ctx) return null;
  const rules = [...(ctx.styles?.inline ? [ctx.styles.inline] : []), ...(ctx.styles?.matched ?? [])];
  for (const r of rules) {
    if (r.selector !== e.selector) continue;
    const d = r.declarations.find((x) => x.property === e.property && !x.overridden);
    if (d) return d.value;
  }
  const el = ctx.element;
  if (!e.media && (e.selector === el.selector || e.selector === el.classSelector) && el.computed[e.property] !== undefined) return el.computed[e.property];
  const anc = ctx.ancestors.find((a) => a.selector === e.selector || a.classSelector === e.selector);
  if (!e.media && anc?.computed[e.property] !== undefined) return anc.computed[e.property];
  return null;
}

export function fixEdits(fix: ProposedFix, selectorMap: Record<string, string> = {}): CssEdit[] {
  return fix.css.map((e) => ({ ...e, selector: restoreSelector(e.selector, selectorMap) }));
}

export function invalidSelectors(fix: ProposedFix, selectorMap: Record<string, string> = {}): string[] {
  return [...new Set(fixEdits(fix, selectorMap).map((e) => e.selector))].filter((s) => !isValidSelector(s));
}

export function fixChanges(fix: ProposedFix, opts: { ctx?: DiagnosisContext; selectorMap?: Record<string, string>; experiment: boolean; groupId: string; provider: string }): Change[] {
  const viewport = currentViewportContext();
  return fixEdits(fix, opts.selectorMap).map((e) =>
    makeChange({
      kind: 'style',
      target: { selector: e.selector, label: e.selector },
      property: e.property,
      before: beforeValue(opts.ctx, e),
      after: e.value,
      media: e.media,
      scope: 'selector',
      viewport,
      origin: 'ai',
      experiment: opts.experiment,
      groupId: opts.groupId,
      note: `AI fix (${opts.provider}): ${fix.title}`,
    }),
  );
}

export function hasGroup(groupId: string): boolean {
  return studio().changes.some((c) => c.groupId === groupId || c.id === groupId);
}

export function isGroupExperiment(groupId: string): boolean {
  return studio().changes.some((c) => (c.groupId === groupId || c.id === groupId) && c.experiment);
}

/** Commit a fix as an experiment; returns the group id. */
export function previewFix(fix: ProposedFix, opts: { ctx?: DiagnosisContext; selectorMap?: Record<string, string>; provider: string }): string {
  const groupId = changeId();
  const changes = fixChanges(fix, { ...opts, experiment: true, groupId });
  if (changes.length) studio().commitChange(changes);
  return groupId;
}

/** Apply a fix: promote its preview if one exists, otherwise commit it as a normal change. */
export function applyFix(fix: ProposedFix, opts: { ctx?: DiagnosisContext; selectorMap?: Record<string, string>; provider: string; groupId?: string }): string {
  if (opts.groupId && hasGroup(opts.groupId)) {
    studio().promoteExperiment(opts.groupId);
    return opts.groupId;
  }
  const groupId = changeId();
  const changes = fixChanges(fix, { ...opts, experiment: false, groupId });
  if (changes.length) studio().commitChange(changes);
  return groupId;
}

export function discardGroup(groupId: string) {
  if (hasGroup(groupId)) studio().removeChange(groupId);
}

/* ------------------------------------------------------------------ */
/* Debug experiments                                                   */
/* ------------------------------------------------------------------ */

function ruleTarget(rule: MatchedRule) {
  const info = studio().selection.info;
  return {
    selector: info?.selector ?? rule.selector,
    label: info?.label ?? rule.selector,
    ruleKey: rule.key,
    ruleSelector: rule.selector,
    ruleSource: rule.source.label + (rule.source.line ? `:${rule.source.line}` : ''),
    ruleMedia: rule.media,
  };
}

/** Disable (value = null) or change a declaration inside a stylesheet rule, as an experiment. */
export function ruleExperiment(rule: MatchedRule, property: string, before: string, value: string | null): string {
  const groupId = changeId();
  if (rule.origin === 'inline') {
    const info = studio().selection.info;
    studio().commitChange(
      makeChange({
        kind: 'style',
        target: { selector: info?.selector ?? rule.selector, label: info?.label ?? rule.selector },
        property,
        before,
        after: value ?? 'revert-layer',
        viewport: currentViewportContext(),
        origin: 'experiment',
        experiment: true,
        groupId,
      }),
    );
    return groupId;
  }
  studio().commitChange(
    makeChange({ kind: 'rule', target: ruleTarget(rule), property, before, after: value, scope: 'selector', viewport: currentViewportContext(), origin: 'experiment', experiment: true, groupId }),
  );
  return groupId;
}

/** Style experiment(s) on a selector (try another width, remove min-width…). */
export function styleExperiment(selector: string, label: string, edits: { property: string; value: string; before: string | null; media?: string }[]): string {
  const groupId = changeId();
  const viewport = currentViewportContext();
  studio().commitChange(
    edits.map((e) =>
      makeChange({ kind: 'style', target: { selector, label }, property: e.property, before: e.before, after: e.value, media: e.media, scope: 'selector', viewport, origin: 'experiment', experiment: true, groupId }),
    ),
  );
  return groupId;
}

/** Re-apply a media rule's declarations under a different media query (the original block is disabled). */
export function breakpointExperiment(rule: MatchedRule, media: string): string {
  const groupId = changeId();
  const viewport = currentViewportContext();
  const decls = rule.declarations.filter((d) => !d.disabled);
  const changes: Change[] = [];
  for (const d of decls) {
    changes.push(makeChange({ kind: 'rule', target: ruleTarget(rule), property: d.property, before: d.value, after: null, scope: 'selector', viewport, origin: 'experiment', experiment: true, groupId }));
    changes.push(
      makeChange({ kind: 'style', target: { selector: rule.selector, label: rule.selector }, property: d.property, before: null, after: d.value, media, scope: 'selector', viewport, origin: 'experiment', experiment: true, groupId, note: `Moved from @media ${(rule.media ?? []).join(' and ')}` }),
    );
  }
  if (changes.length) studio().commitChange(changes);
  return groupId;
}
