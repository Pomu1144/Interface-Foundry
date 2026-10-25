# IFDY security & privacy model

IFDY renders untrusted pages next to a privileged editing UI. This document is the
security boundary between the studio and the preview, and the rules every module follows.

## Processes and origins

| Component | Origin (dev defaults) | Trust |
|---|---|---|
| Studio UI (React) | `http://localhost:5173` | trusted UI, holds the per-launch companion token in memory |
| Companion API (`/api/*`, same server as the studio) | `http://localhost:5173` | trusted, local only |
| Preview host (demo, imported projects, local dirs) | `http://localhost:5174` | **untrusted content** |
| Local dev-server proxies | `http://localhost:<ephemeral>` | **untrusted content** (your own app, still treated as untrusted) |
| Controlled Chromium | separate OS process, isolated browser context | **untrusted content** |

The preview always runs on a *different origin* from the studio. Ports are part of the
origin, so the same-origin policy prevents previewed code from reading the studio's DOM,
storage, IndexedDB projects or the companion token.

## Preview isolation

* Frames: `<iframe sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads
  allow-popups-to-escape-sandbox allow-same-origin" referrerpolicy="no-referrer">`.
  `allow-same-origin` is granted **only** when the frame's origin differs from the studio's
  (checked in `PreviewFrame.tsx`); content that would share the studio's origin gets an
  opaque origin instead. Browsers warn that this combination "can escape its sandboxing" —
  that applies to same-origin frames; ours are cross-origin by construction.
* An iframe is not a complete security boundary on every deployment. Do not serve the studio
  and previews from the same host:port, and keep the preview origin on a separate
  site when deploying behind a reverse proxy (`IFDY_PREVIEW_ORIGIN`).
* Public websites are **never** proxied and their framing/CSP headers are **never** stripped.
  They open either in the controlled Chromium (a normal browser visit, isolated context)
  or as a plain embed when the site allows framing (read-only, no inspection).

## Studio ⇄ agent protocol

* The studio passes a random session nonce and its origin to the preview through the
  iframe's `name` (`ifdy:<nonce>|<studio-origin>|<flags>`).
* The agent only posts to `window.parent` with `targetOrigin = studio origin`, and only
  accepts messages whose `source` is `window.parent`, whose `origin` is the studio origin
  and whose envelope carries the nonce.
* The studio only accepts messages whose `source` is the exact iframe `contentWindow`,
  whose `origin` is the expected preview origin and whose nonce matches.
* Only methods listed in `AGENT_METHODS` can be invoked; everything else is rejected.
* In controlled-browser mode the same envelopes travel over a Playwright binding and the
  authenticated companion websocket.

## Companion API

* Binds to loopback. Requests must have a loopback `Host` (DNS-rebinding defence) or one
  explicitly listed in `IFDY_ALLOWED_HOSTS`.
* Requests with an `Origin` header must be same-origin; `Sec-Fetch-Site` must be
  `same-origin`/`none`. No CORS headers are ever sent, so other sites cannot read responses.
* Every endpoint except `/api/bootstrap` requires the random per-launch token in
  `x-ifdy-token`. The token can only be read by same-origin script.
* Websockets require the same host/origin checks plus the token in the query string.

## Filesystem, Git and source writes

* Disabled unless `IFDY_ALLOWED_ROOTS` lists absolute directories. Paths are normalised,
  traversal is rejected, and real paths are checked so symlinks cannot escape a root.
* Writes and commits are two-step: a prepare call returns the exact files/diff and a
  one-time approval token; the write requires that token. Nothing is written silently.
* IFDY never pushes or opens pull requests automatically; it shows the commands to run.
* Imported static projects live in the companion's memory and in this browser's IndexedDB.

## Data handling

* Console arguments, errors and URLs are redacted in the agent before leaving the page
  (passwords, tokens, API keys, session ids, SSNs; sensitive query parameters).
* The network inspector never captures headers, cookies or bodies.
* Recording masks password/card/OTP fields always, and every field when
  "Mask all typed input" is on. Masked steps store `{{secret:name}}` placeholders that are
  resolved from synthetic fixtures at replay time and never persisted.
* AI: the offline engine is the default. External providers require explicit consent;
  the exact JSON payload can be reviewed before sending; form values are never included,
  long digit runs are masked. API keys stay on the companion and are never sent to the
  browser. Request context is never logged or persisted.
* Projects are stored locally (IndexedDB). Settings → "Clear all data" removes everything.
  Fixtures and AI consent are not written to project files.
* No telemetry is sent anywhere. The optional event log stays in memory.

## Instrumentation (opt-in)

* Console capture wraps `console.*` and always calls the original method.
* Event-listener and fetch/XHR instrumentation wrap `addEventListener`, `fetch` and
  `XMLHttpRequest` inside the preview only, are off by default, and require a preview
  reload; the UI labels exactly what is and is not visible without them.

## Reporting

Treat imported sites, source files, console output and browser messages as untrusted in
every new module. If you find a way for previewed content to reach the studio, the companion
API or the filesystem, that is a security bug.
