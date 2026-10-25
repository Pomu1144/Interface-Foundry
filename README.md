# IFDY — Interface Foundry

**Design, inspect, simulate, test, diagnose and ship from one workspace — against the real
rendering engine, never a screenshot.**

IFDY is a browser-based design IDE that combines a Figma-style canvas, browser DevTools,
an Xcode/Android-Studio-style device simulator with foldables, responsive and accessibility
QA, interaction recording/replay, an evidence-grounded AI layout debugger, and a
visual-change-to-code pipeline.

![IFDY](src/assets/brand/welcome-hero.webp)

## Quick start

```bash
npm install
npm run browsers:install   # optional: Chromium for URL simulation & deterministic screenshots
npm run dev                # studio on http://localhost:5173, isolated previews on :5174
```

Open the studio and click **Open the Harborline demo** (a synthetic mortgage-servicing app
with deliberate, documented defects — see `demo/DEFECTS.md`), or paste any website URL to
simulate it across devices.

Production: `npm run build && npm start` (studio on `IFDY_PORT`, default 4310).
Configuration is via environment variables — see `.env.example`.

## What you can do

| Area | Highlights |
|---|---|
| **Canvas** | Live, interactive pages in device frames; pan/zoom; selection & hover outlines, handles with CSS-aware resizing (flex-basis on flex items, unit preserving), Alt-measure redlines, spacing overlay, media-query bar, side-by-side compare with mirrored selection |
| **Device simulator** | iPhone, Pixel, Galaxy, iPad, tablets, desktops, **Surface Duo (provisional)**, Galaxy Z Fold 5, Pixel Fold; folded/expanded postures with animated hinge transitions (play, pause, scrub, duration, continuous reflow or midpoint snap, reduced motion); rotation; safe areas, status bars, hinge masks; Device Manager for custom profiles; responsive free-form viewport |
| **Simulate a URL** | Paste a link → Device Wall renders it on many devices at once (controlled Chromium with real device emulation, mirrored scrolling/interactions, contact-sheet capture) |
| **Inspector** | Design (Figma-like: size modes, auto layout, spacing, type, fill, stroke, effects), Layout (plain-language "why it looks like this"), Styles (full cascade with overridden/disabled declarations, rule edits, sources), Box model (editable), Computed, DOM, Accessibility, Events, Responsive, Component mapping |
| **DevTools** | Console (levels, regex, grouping), Network (scope-labelled, redacted), runtime errors, 3D view hierarchy |
| **QA** | Multi-viewport responsive audit (overflow, clipping, hinge splits, tap targets, line length, hidden primary actions…), responsive diff (side-by-side, swipe, onion skin, pixel and structural diff), axe-core accessibility lab + keyboard audit, recording & replay with timeline, financial UX scenario suite |
| **AI debugger** | Offline heuristic engine by default; Anthropic or local OpenAI-compatible providers via the companion with consent and payload review; facts vs inferences vs fixes vs assumptions; approve fixes as experiments, then re-run checks |
| **Ship** | Undoable change history with experiments, CSS export, source patches with reliability labels, tokens (W3C DTCG), screenshots ZIP, QA reports, approval-gated writes and Git |

## Documentation

* `docs/ARCHITECTURE.md` — runtimes, directory structure, shared state model, engines
* `docs/SECURITY.md` — studio ⇄ preview security boundary, companion API, data handling
* `docs/MODULE_GUIDE.md` — how to build a module (contracts, UI kit, rules)
* `docs/MILESTONES.md` — milestone report: features, tests, limitations, remaining work
* `docs/ASSETS.md` — Higgsfield-generated brand and illustration assets
* `demo/README.md`, `demo/DEFECTS.md` — the synthetic demo and its deliberate defects

## Tests

```bash
npm run typecheck
npm test            # unit tests (Vitest)
npm run test:e2e    # acceptance tests (Playwright, starts its own dev server)
```

## Honesty notes

Device profiles state their source and are marked *provisional* when not verified against
hardware. Automated accessibility checks do not prove compliance; the financial suite
evaluates UI behaviour only, not financial correctness or security. Public URLs grant no
source access and their security headers are never bypassed. Unsupported capabilities are
disabled and labelled in the UI.
