# IFDY architecture

IFDY (Interface Foundry) is a single TypeScript codebase with three runtimes:

```
┌──────────────────────────── Studio (browser, React 19) ────────────────────────────┐
│ app shell · canvas · inspectors · QA · AI · export          Zustand store (src/store) │
│        ▲ postMessage (nonce + origin checked)            ▲ fetch/ws (token)          │
└────────┼─────────────────────────────────────────────────┼──────────────────────────┘
         │                                                 │
┌────────┴─────── Preview agent (src/agent) ───────┐  ┌────┴──── Companion (server/) ──────┐
│ runs inside the previewed page:                   │  │ Vite plugin in dev / server/start.ts │
│ DOM snapshot, styles cascade, box model, patches, │  │ preview host (separate origin)       │
│ audits (responsive + axe), recorder/replayer,     │  │ localhost proxy + agent injection    │
│ raster capture, console/error/network capture     │  │ controlled Chromium (Playwright)     │
└───────────────────────────────────────────────────┘  │ AI providers · fs · git · capture    │
                                                       └──────────────────────────────────────┘
```

## Directory structure

```
src/
  shared/            types.ts (domain model) · protocol.ts (studio⇄agent RPC + events)
  agent/             in-page agent, bundled to a classic script by server/agent-bundle.ts
  store/             single Zustand store: project, workspace, devices, preview instances,
                     selection, changes (+ undo/redo), diagnostics, tokens, assets,
                     scenarios, runs, captures, baselines, settings
  app/               shell: Toolbar, ActivityBar, LeftSidebar, RightInspector, BottomPanel,
                     DocumentArea, StatusBar, Welcome, CommandPalette, dialogs, actions
  ui/                design-system primitives (controls, fields, overlay, layout)
  styles/            tokens.css (dark graphite + light theme), global.css
  modules/
    canvas/                pan/zoom world, artboards, selection overlay, fold dock, zoom HUD
    preview-runtime/       PreviewFrame (iframe engine), remote/ (Chromium engine), connection,
                           registry, wire (events → store), sync (store → previews)
    device-simulator/      device registry, viewport math, DeviceFrame, transitions, Device Manager
    element-inspector/     Layers + DOM trees, events tab, context menu
    style-inspector/       Design, Layout, Styles (cascade), Computed, Box model
    diagnostics/           console, network, runtime errors
    change-manager/        change model, patch-set builder, edit API, history panel
    responsive-audit/      multi-viewport audit runner, sweep chart, issues panel
    responsive-diff/       captures, pixel/structural diff, DiffDoc
    accessibility-lab/     axe findings, keyboard audit, checklist, A11y tab
    interaction-recorder/  recording, scenarios, timeline
    interaction-replayer/  replay engine
    financial-ux-suite/    Harborline scenario library, test runner, reports
    ai-debugger/           context builder, consent, offline heuristic engine, AI panel
    design-tokens/ asset-manager/ component-mapper/ code-editor/ export-engine/ git-integration/
    device-wall/           multi-device simulation of one URL/route
    view-hierarchy-3d/     exploded 3D layer inspector
    project-adapter/       sources (demo, static import, localhost, local dir, URL), projects
    project-storage/       IndexedDB persistence and autosave
server/
  app.ts router.ts services.ts http.ts config.ts
  preview-host.ts vfs.ts local-proxy.ts agent-bundle.ts
  routes/  browser/  ai/  fs.ts  git.ts
demo/                Harborline synthetic mortgage-servicing app (vanilla ES modules)
tests/unit           Vitest (happy-dom)
tests/e2e            Playwright acceptance tests
```

## Shared state model

The store is the single source of truth for everything the user can see or persist.
Previews are *derived*: the change list (`changes`) is compiled by
`buildPatchSet()` into one override stylesheet, CSSOM rule edits and DOM patches, which
`sync.ts` pushes to every connected preview. Because each preview re-applies the full set
on load, undo/redo, crash recovery, multi-device comparisons and exports always agree.

High-frequency geometry (hover/selection rects) lives in a separate tiny store
(`overlay-store.ts`) so pointer movement never re-renders the shell.

### Change lifecycle

```
inspector / canvas / tokens / AI ──edit.ts──▶ Change (before, after, target, viewport, origin)
        │                                              │
        └── previewChange (transient, scrubbing)       ├─▶ undo/redo stacks (snapshots)
                                                       ├─▶ buildPatchSet ─▶ all previews
                                                       ├─▶ autosave (IndexedDB)
                                                       └─▶ export (CSS patch, source diff, report)
```

Experiments are Changes with `experiment: true`: applied live, listed separately and
promotable to committed changes.

## Preview engines

| Engine | Used for | Inspection | Notes |
|---|---|---|---|
| frame | demo, imported static projects, local dirs, localhost proxy | full (agent) | sandboxed iframe on the preview origin |
| remote | public URLs | full (agent injected via init script) | Chromium screencast + forwarded input, CDP device emulation incl. display features |
| embed | public URLs without Chromium | none | read-only, only when the site allows framing |

## Fold / unfold

`device-simulator/viewport.ts` resolves geometry per posture and orientation and
interpolates between postures. `useTransitionDriver` advances one shared progress value;
the canvas renders the interpolated frame while the live viewport either reflows
continuously or switches at the midpoint. The iframe element is never remounted, so page
state (focus, typed values, scroll) survives exactly as on hardware.

## Extending

See `docs/MODULE_GUIDE.md` for the module contract (actions, routes, documents, UI kit,
honesty and safety rules).
