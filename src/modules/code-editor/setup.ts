import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { css, cssLanguage } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap, search } from '@codemirror/search';
import { Compartment, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, crosshairCursor, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, rectangularSelection, type DecorationSet } from '@codemirror/view';
import { studio } from '@/store';
import { ifdyHighlightStyle, type LanguageId } from './syntax';

/**
 * CodeMirror 6 configuration for IFDY: a theme built from the studio's design
 * tokens (so dark/light follow the app), language support, and IFDY extras
 * (design-token completion in CSS, flash-to-line for "reveal in editor").
 */

export const ifdyEditorTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--text-0)', backgroundColor: 'var(--bg-1)', fontSize: '12.5px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65', overscrollBehavior: 'contain' },
  '.cm-content': { padding: '10px 0 40vh', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 16px 0 6px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--accent-soft) !important' },
  '.cm-content ::selection': { backgroundColor: 'var(--accent-soft)' },
  '.cm-gutters': { backgroundColor: 'var(--bg-1)', color: 'var(--text-3)', border: 'none', borderRight: '1px solid var(--line-1)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 14px', minWidth: '44px', fontVariantNumeric: 'tabular-nums', fontSize: '11px' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 4px', color: 'var(--text-3)', cursor: 'pointer' },
  '.cm-foldGutter .cm-gutterElement:hover': { color: 'var(--text-0)' },
  '.cm-activeLine': { backgroundColor: 'var(--bg-hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-0)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--molten-soft)', borderRadius: '2px' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--bg-active)', outline: '1px solid var(--line-3)', borderRadius: '2px', color: 'inherit' },
  '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--bg-4)', border: 'none', color: 'var(--text-2)', borderRadius: '4px', padding: '0 5px', margin: '0 3px' },
  '.cm-searchMatch': { backgroundColor: 'var(--warning-soft)', outline: '1px solid color-mix(in srgb, var(--warning) 45%, transparent)', borderRadius: '2px' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--accent-soft)', outlineColor: 'var(--accent)' },
  '.cm-panels': { backgroundColor: 'var(--bg-2)', color: 'var(--text-0)', fontFamily: 'var(--font-ui)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--line-2)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--line-2)' },
  '.cm-panel.cm-search': { padding: '6px 10px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 6px', fontSize: '11.5px' },
  '.cm-panel.cm-search br': { display: 'none' },
  '.cm-panel.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--text-2)', fontSize: '11px' },
  '.cm-panel.cm-search [name=close]': { position: 'static', marginLeft: 'auto', color: 'var(--text-2)', fontSize: '15px', padding: '0 4px', background: 'transparent', border: 'none' },
  '.cm-textfield': { height: '24px', padding: '0 8px', borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)', backgroundColor: 'var(--bg-inset)', color: 'var(--text-0)', fontFamily: 'var(--font-mono)', fontSize: '11.5px', margin: '0' },
  '.cm-textfield:focus': { borderColor: 'var(--accent)', outline: 'none', boxShadow: '0 0 0 3px var(--accent-softer)' },
  '.cm-button': { height: '24px', padding: '0 9px', borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)', backgroundImage: 'none', backgroundColor: 'var(--bg-3)', color: 'var(--text-1)', fontSize: '11px', margin: '0' },
  '.cm-button:hover': { backgroundColor: 'var(--bg-4)', color: 'var(--text-0)' },
  '.cm-tooltip': { backgroundColor: 'var(--bg-3)', color: 'var(--text-0)', border: 'none', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-pop)', overflow: 'hidden' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', fontSize: '11.5px', maxHeight: '16em', padding: '3px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '2px 8px', borderRadius: '4px', lineHeight: '1.6' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-soft)', color: 'var(--text-0)' },
  '.cm-completionDetail': { color: 'var(--text-3)', fontStyle: 'normal', marginLeft: '10px' },
  '.cm-completionMatchedText': { color: 'var(--accent-strong)', textDecoration: 'none', fontWeight: '600' },
  '.cm-completionIcon': { opacity: '0.7', width: '1.1em' },
  '.cm-completionInfo': { backgroundColor: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-md)', padding: '6px 8px', fontSize: '11.5px' },
  '.cm-ifdy-flash': { animation: 'ifdy-line-flash 1.8s var(--ease-out)' },
  '@keyframes ifdy-line-flash': {
    '0%': { backgroundColor: 'color-mix(in srgb, var(--molten) 34%, transparent)', boxShadow: 'inset 2px 0 0 var(--molten)' },
    '70%': { backgroundColor: 'color-mix(in srgb, var(--molten) 12%, transparent)', boxShadow: 'inset 2px 0 0 var(--molten)' },
    '100%': { backgroundColor: 'transparent', boxShadow: 'inset 2px 0 0 transparent' },
  },
});

export function languageExtension(id: LanguageId): Extension {
  switch (id) {
    case 'html':
      return html({ autoCloseTags: true });
    case 'css':
      return [css(), cssLanguage.data.of({ autocomplete: tokenCompletion })];
    case 'js':
      return javascript();
    case 'jsx':
      return javascript({ jsx: true });
    case 'ts':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ jsx: true, typescript: true });
    case 'json':
      return json();
    default:
      return [];
  }
}

/** Complete `--token` names in CSS from the project's design tokens. */
function tokenCompletion(ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/--[\w-]*/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  const tokens = studio().tokens;
  if (!tokens.length) return null;
  return {
    from: word.from,
    options: tokens.map((t) => ({ label: t.cssVar, detail: t.value.length > 28 ? t.value.slice(0, 27) + '…' : t.value, type: 'variable', info: `${t.name} · ${t.type}${t.description ? ` — ${t.description}` : ''}`, boost: 2 })),
    validFor: /^--[\w-]*$/,
  };
}

/* ------------------------------------------------------------------ */
/* Flash a line (reveal in editor)                                     */
/* ------------------------------------------------------------------ */

const flashEffect = StateEffect.define<number | null>();
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(flashEffect)) continue;
      if (e.value === null) next = Decoration.none;
      else {
        const line = tr.state.doc.line(Math.max(1, Math.min(tr.state.doc.lines, e.value)));
        next = Decoration.set([Decoration.line({ class: 'cm-ifdy-flash' }).range(line.from)]);
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function revealLine(view: EditorView, lineNo: number) {
  const line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, lineNo)));
  view.dispatch({
    selection: { anchor: line.from },
    effects: [EditorView.scrollIntoView(line.from, { y: 'center' }), flashEffect.of(null)],
  });
  requestAnimationFrame(() => view.dispatch({ effects: flashEffect.of(lineNo) }));
  setTimeout(() => {
    try {
      view.dispatch({ effects: flashEffect.of(null) });
    } catch {
      /* view destroyed */
    }
  }, 2000);
  view.focus();
}

/* ------------------------------------------------------------------ */
/* Editor state factory                                                */
/* ------------------------------------------------------------------ */

export type EditorHooks = { onSave: () => void; onChange: (doc: string) => void; onCursor: (line: number, col: number) => void };

export const readOnlyCompartment = new Compartment();
export const languageCompartment = new Compartment();
export const themeCompartment = new Compartment();

export function createEditorState(doc: string, opts: { language: LanguageId; readOnly: boolean; dark: boolean; hooks: () => EditorHooks }): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter({ openText: '▾', closedText: '▸' }),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(ifdyHighlightStyle),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ activateOnTyping: true, icons: true }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches({ minSelectionLength: 2 }),
      search({ top: true }),
      flashField,
      EditorState.tabSize.of(2),
      keymap.of([
        { key: 'Mod-s', preventDefault: true, run: () => (opts.hooks().onSave(), true) },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      languageCompartment.of(languageExtension(opts.language)),
      readOnlyCompartment.of([EditorState.readOnly.of(opts.readOnly)]),
      themeCompartment.of(EditorView.darkTheme.of(opts.dark)),
      ifdyEditorTheme,
      EditorView.updateListener.of((u) => {
        const hooks = opts.hooks();
        if (u.docChanged) hooks.onChange(u.state.doc.toString());
        if (u.selectionSet || u.docChanged) {
          const head = u.state.selection.main.head;
          const line = u.state.doc.lineAt(head);
          hooks.onCursor(line.number, head - line.from + 1);
        }
      }),
      EditorView.contentAttributes.of({ 'aria-label': 'Code editor' }),
    ],
  });
}
