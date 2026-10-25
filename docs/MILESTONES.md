# Milestone report

Status of IFDY (Interface Foundry) against the product specification. Every
statement here is backed by a test listed under **Tests** or was checked by hand
in the running studio.

## Setup

```bash
npm install
npm run browsers:install   # optional: controlled Chromium for public URLs, captures, device wall
npm run dev                # studio on http://localhost:5173, isolated preview origin on :5174
```

Optional configuration is in `.env.example`: AI keys stay on the companion, and
filesystem roots must be allowed explicitly. `npm run build` followed by
`npm start` runs the production server.

## Final acceptance (spec §23)

`tests/e2e/acceptance.spec.ts` runs the whole 15-step workflow in one test,
through the UI, against the synthetic Harborline mortgage login. The store is
only read for assertions. The test takes about 1.2 minutes.

| # | Step | What the test proves |
|---|------|----------------------|
| 1 | Open the studio | Welcome screen, companion connected, no project open |
| 2 | Load the synthetic mortgage login | Demo source on the isolated preview origin, `#/login`, preview ready |
| 3 | Inspect the real page in the simulator | Page reports 540×720 inside the Surface Duo frame; hover overlay matches the measured size |
| 4 | Switch compact / expanded | Iframe and `innerWidth` go 540 ↔ 1114; overflow only when compact |
| 5 | Animate the transition | Progress and page width pass through at least 5 intermediate values, only increasing |
| 6 | Select a problematic element | `.rate-banner` selected, inspector shows the RateBanner component |
| 7 | DOM, computed CSS, box model | `width 560px` traced to `login.css`, border box 560 × h |
| 8 | Identify a responsive defect | Audit reports the banner overflow at 540 only, and the hinge collision at 1114 |
| 9 | Apply and undo a fix | Rule edit `560px → 100%` removes the overflow; undo restores it, redo re-applies |
| 10 | Responsive diff and accessibility checks | Contrast, placeholder-label and target-size findings; folded vs expanded diff with structural changes |
| 11 | Record and replay | Two-step scenario with a masked secret; replay passes on the canvas device |
| 12 | Before/after screenshots | Before (0 edits) and after (1 edit) captures; the pixel diff reports a change |
| 13 | Review generated code | One exact hunk in `src/styles/login.css`: `− width: 560px; + width: 100%;` |
| 14 | Export a patch and QA report | Downloaded `.patch` and self-contained HTML report with matching counts |
| 15 | Reopen with saved configuration | After a reload: same device, posture, edit, scenario, captures and audits; the fix is re-applied |

## Working features

- **Shell:** toolbar with run status, activity bar, resizable docked panels,
  command palette, shortcuts, dark and light themes, and flat line icons.
- **Preview runtime:** cross-origin sandboxed previews with a nonce-checked
  agent. Covers the demo, imported static projects, local directories and an
  authorised localhost proxy with HMR. Public URLs run in a controlled Chromium
  stream, or as a read-only embed where framing is allowed.
- **Device simulator:** 15 profiles; foldables labelled provisional with their
  sources. Fold/unfold animation with scrubbing, rotation, safe areas, a Device
  Manager and a free-form responsive viewport.
- **Device wall:** the same page live on many devices, with mirrored scroll,
  input and selection, and a contact-sheet export.
- **Canvas:** selection and hover outlines, CSS-aware resize handles,
  measuring, rulers, media-query bar, and side-by-side compare.
- **Inspector:** Design, Layout, Styles (full cascade, editable), Box,
  Computed, DOM, Events, A11y, Responsive and Component tabs, plus reusable
  styles.
- **3D view hierarchy:** exploded layers with orbit, depth filtering, isolate
  and selection sync.
- **Diagnostics:** console, redacted network log, runtime errors, and a change
  history that keeps experiments separate from edits.
- **QA:** responsive audit and width sweep, accessibility lab (axe-core plus
  IFDY checks, keyboard tab order, manual checklist), screenshots and
  baselines, and a responsive diff with side-by-side, swipe, onion, pixel and
  structural views.
- **Recording and replay:** timeline, scenario navigator, device matrix runs,
  and a 26-scenario financial UX suite on synthetic data.
- **AI debugger:** an offline evidence engine, plus Anthropic and local
  providers behind a consent card. Fixes can be previewed and applied.
- **Code integration:** design tokens (DTCG import/export), assets, a component
  map, and a code editor. Source patches with reliability labels, CSS/patch/QA
  report export, and Git status/branch/apply/commit behind approvals. Push and
  PR are shown as commands and never executed.
- **Persistence:** IndexedDB autosave of the project, edits, scenarios,
  captures, audits, devices and settings.

## Tests

| Command | Result |
|---|---|
| `npm run typecheck` | clean (application, server and tests) |
| `npm test` | 308 unit tests in 29 files, all passing |
| `npm run test:e2e` | 6 specs passing in about 2.1 minutes: acceptance (15 steps), Phase 1 (3), device wall and controlled Chromium (2) |
| `npm run build` | succeeds |

## Known limitations

- **Foldables:** Surface Duo, Galaxy Z Fold 5 and Pixel Fold dimensions are
  provisional. Fold emulation in Chromium uses `displayFeature`, because
  `setDisplayFeaturesOverride` is accepted but has no effect in Chromium 153.
- **Browser engines:** only Blink is available. iPhone and iPad profiles do not
  reproduce Safari rendering, and the UI says so.
- **Hinge fixes:** fixes for the hinge include a pixel fallback that applies
  only at exactly 1114px wide, because previews cannot emulate viewport
  segments.
- **Screenshot speed:** a DOM-raster screenshot takes 8–12 seconds on image-heavy
  pages. Chromium captures are faster when available.
- **Heuristic findings:** some responsive findings are heuristic. The "text
  under the hinge" check is noisy.
- **Not persisted yet:** AI conversations and replay runs are not saved between
  sessions.
- **Not tested with a real key:** the Anthropic provider was tested against a
  mocked client only, because no API key was available.
- **Source mapping:** edits made in the Design tab export as an override
  stylesheet or an appended rule. Edits to a rule in the Styles tab map exactly
  to the source file.
- **Local directories:** there is no file watcher, so changes made outside IFDY
  are not picked up automatically.

## Remaining work

- Real-device verification of the foldable profiles, and WebKit/Firefox engines
  through Playwright.
- Persist AI conversations and replay history; add run trends over time.
- File watching for local directories, and React instance counts in the
  component map.
- Reduce DOM-raster capture time, for example with incremental image decoding.

## Where things live

- **Architecture:** `docs/ARCHITECTURE.md`
- **Security model:** `docs/SECURITY.md`
- **Module conventions:** `docs/MODULE_GUIDE.md`
- **Filesystem and Git companion:** `docs/COMPANION.md`
- **Asset provenance:** `docs/ASSETS.md`
- **Seeded demo defects:** `demo/DEFECTS.md`
