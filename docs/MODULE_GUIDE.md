# IFDY module guide

IFDY (Interface Foundry) is a browser-based design IDE: live previews of real pages inside
device frames, DevTools-grade inspection, reversible visual edits, responsive/accessibility
QA, recording/replay, AI-assisted debugging and code export. This guide is the contract
every module follows.

## Architecture in one minute

```
 Studio (React, :5173)  ──postMessage (nonce, origin-checked)──▶  Preview agent (src/agent)
        │                                                           runs inside the previewed page
        │ /api/* (token)                                             on the isolated preview origin (:5174)
        ▼
 Companion (server/, mounted into Vite in dev, server/start.ts in prod)
   - preview host on its own port (demo, imported projects, local dirs) + agent injection
   - authorised localhost reverse proxy (agent injection, HMR passthrough)
   - controlled Chromium (Playwright) for public URLs, screenshots and automation
   - AI providers, filesystem (allow-listed roots), git
```

* `src/shared/types.ts` — domain types (devices, DOM, styles, changes, issues, steps, tokens).
* `src/shared/protocol.ts` — studio⇄agent RPC (`AgentMethods`) and events (`AgentEvents`).
* `src/agent/*` — the in-page agent. Add a method by extending `AgentMethods`, `AGENT_METHODS`
  and the handler map in `src/agent/index.ts`.
* `src/store/index.ts` — the single Zustand store (`useStudio`, `studio()` for imperative access).
* `src/modules/<module>/` — one folder per logical module (see spec §4).
* `src/app/` — shell (toolbar, activity bar, panels, dialogs, command palette).

## Talking to previews

```ts
import { previews, callPrimary } from '@/modules/preview-runtime/registry';
const conn = previews.primary();            // PreviewConnection | undefined (the inspected preview)
const info = await callPrimary('node.info', { id });   // typed by AgentMethods
previews.broadcast('env.set', { fontScale: 1.3 });      // all ready previews
conn.on('console', (e) => …);              // AgentEvents
```

Every preview instance has a row in `studio().instances[id]` (`role`: primary | compare |
wall | worker, `status`, `viewport`, `engine`). DOM overlays look up the rendered preview
element with `[data-instance="<id>"]` (iframe or canvas) to map agent rects to the screen.

To run audits/captures at *other* viewports without disturbing the user's canvas, mount a
hidden `<PreviewFrame role="worker" …/>` (see `src/modules/preview-runtime/PreviewFrame.tsx`);
worker events are not mirrored into the console/network panels.

## Making edits

Never mutate the preview directly. Use `src/modules/change-manager/edit.ts`
(`setStyle`, `setStyles`, `previewStyle`, `setRuleDeclaration`, `setText`, `setAttribute`,
`toggleHidden`) or `studio().commitChange(makeChange({...}))`. Changes are the source of truth:
`buildPatchSet()` turns them into override CSS / CSSOM edits / DOM patches that every preview
re-applies on load, so undo/redo, crash recovery and export stay consistent. Mark trials with
`experiment: true`; AI fixes use `origin: 'ai'`.

## Extending the shell

* Actions (toolbar buttons, command palette, shortcuts): `registerActions([...])` from
  `src/app/actions.ts`. Well-known ids already referenced by the toolbar:
  `capture.screenshot`, `test.runAll`, `test.stop`, `ai.diagnose`, `export.open`.
* Module startup: add **one line** to `registerModules()` in `src/app/modules.ts`
  (re-read the file right before editing — other modules append there too).
* Server routes: add **one line** to `registerModuleRoutes()` in `server/routes/index.ts`.
  Use the `Router` API (`router.get/post/put/delete/ws`). All `/api/*` routes are already
  protected by host/origin checks and the per-launch token.
* Cross-module notifications: `bus` in `src/lib/events.ts`.
* Documents in the center area: `studio().openDoc({ id, kind, title, data })` with kinds
  `file | wall | hierarchy | diff | report`.

## UI kit and visual bar

The studio must look like the best IDE in the world: dense, calm, precise.

* Use `@/ui` (`Button`, `IconButton`, `Segmented`, `Tabs`, `Menu`, `Popover`, `Dialog`,
  `Tooltip`, `Kbd`, `NumberField` (scrubbable), `TextField`, `ColorField`, `Select`, `Switch`,
  `Slider`, `Checkbox`, `SearchInput`, `Section`, `Row`, `Grid`, `PanelHeader`, `Badge`,
  `Spinner`, `EmptyState`, `Notice`, `ScrollArea`, `Divider`).
* Style with CSS modules next to the component, using tokens from `src/styles/tokens.css`
  only (`--bg-*`, `--line-*`, `--text-*`, `--accent`, `--molten`, `--violet`, `--success`,
  `--warning`, `--danger`, `--r-*`, `--fs-*`, `--font-mono`…). No hard-coded colors except in
  previews of user content. Light theme must keep working (`:root[data-theme='light']`).
* Type scale: 11–13px UI, mono for code/values. Row height 26–28px. 4px grid.
* Icons: `lucide-react` (vector, 13–16px). Rich illustrations generated with Higgsfield live in
  `src/app/art.ts` — use them for empty states and onboarding, never as tiny glyphs.
* Every state is designed: empty, loading (Spinner/shimmer), error, unsupported, permission
  denied. No inert buttons; if a capability is unavailable, disable it and say why.
* Look at `src/modules/canvas/FoldDock.tsx`, `src/app/dialogs/SettingsDialog.tsx` and
  `src/modules/device-simulator/DeviceManagerDialog.tsx` for reference.

## Honesty and safety rules

* Label scope precisely (e.g. "Resource Timing (passive)", "DOM raster (approximate)",
  "heuristic mapping"). Never imply browser-internal access you do not have.
* Treat previewed content, console output and network data as untrusted. Redact secrets
  (see `src/agent/capture.ts`). Never record real credentials; use `settings.fixtures`.
* Writes to project files, commits, pushes and external AI calls require explicit approval
  in the UI.
* Automated checks never certify accessibility, financial correctness or security.

## Tests

* Unit tests: `tests/unit/<module>.test.ts` (Vitest, happy-dom). `npm test`.
* End-to-end: `tests/e2e/*.spec.ts` (Playwright, uses the pre-installed Chromium).
* Typecheck: `npm run typecheck` must stay clean for your files.
