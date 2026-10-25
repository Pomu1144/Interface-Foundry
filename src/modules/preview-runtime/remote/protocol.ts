/**
 * Wire protocol between the studio and the companion's controlled Chromium
 * (`/api/ws/browser`). One websocket per studio tab, multiplexed by `pageId`.
 *
 *  - Text frames carry JSON `ClientMessage` / `ServerMessage` objects.
 *  - Binary frames carry screencast images: `[u32 BE header length][header JSON][JPEG bytes]`.
 *
 * Network entries never contain headers or bodies, and URLs are redacted on the
 * server before they leave it. This file is shared by the browser bundle and the
 * Node companion, so it must stay free of DOM- or Node-only imports.
 */

export const BROWSER_PROTOCOL_VERSION = 1;

/**
 * Rendering engines the companion can drive.
 *  - chromium: controlled Chromium (Blink), emulated over CDP.
 *  - webkit: Playwright's WebKit build — Safari's engine, any OS, but not iOS Safari.
 *  - ios-simulator: real Mobile Safari in Xcode's iOS Simulator (macOS companion only).
 */
export type RemoteEngine = 'chromium' | 'webkit' | 'ios-simulator';

export type EngineInfo = {
  id: RemoteEngine;
  available: boolean;
  /** Human label, e.g. "Chromium 140", "WebKit 26.6", "Safari · iOS 18.2 Simulator". */
  label: string;
  /** Why it is unavailable, or a caveat when available. */
  detail?: string;
  /** Features the engine supports; the studio disables/labels the rest. */
  features: { inspect: boolean; input: boolean; touch: boolean; foldEmulation: boolean; rotate: boolean };
};
export const BROWSER_WS_PATH = '/api/ws/browser';

/* ------------------------------------------------------------------ */
/* Emulation                                                           */
/* ------------------------------------------------------------------ */

export type RemoteDevice = {
  /** Layout viewport in CSS px (innerWidth × innerHeight). */
  width: number;
  height: number;
  /** Device pixel ratio. */
  dpr: number;
  /** Mobile viewport semantics (meta viewport, overlay scrollbars, text autosizing). */
  mobile: boolean;
  /** Touch input + `(pointer: coarse)` / `(hover: none)`. */
  touch: boolean;
  userAgent?: string;
  /** Physical screen in CSS px (`screen.width/height`). Defaults to the viewport. */
  screen?: { width: number; height: number };
  orientation?: 'portrait' | 'landscape';
};

/** Fold / hinge relative to the viewport, in CSS px. */
export type RemoteFold = { axis: 'vertical' | 'horizontal'; offset: number; maskLength: number };

export type EmulationParams = {
  device: RemoteDevice;
  fold: RemoteFold | null;
  colorScheme: 'light' | 'dark' | null;
  reducedMotion: boolean;
};

export type ScreencastOptions = {
  enabled: boolean;
  /** JPEG quality 20–95. */
  quality?: number;
  /** Maximum image size in physical pixels (displayed size × devicePixelRatio). */
  maxWidth?: number;
  maxHeight?: number;
};

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

/** Modifier bitmask, same as CDP: Alt=1, Ctrl=2, Meta=4, Shift=8. */
export const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 } as const;

export type MouseButtonName = 'none' | 'left' | 'middle' | 'right' | 'back' | 'forward';

export type RemoteInput =
  | { kind: 'mouse'; type: 'down' | 'up' | 'move'; x: number; y: number; button: MouseButtonName; buttons: number; clickCount: number; modifiers: number }
  | { kind: 'wheel'; x: number; y: number; deltaX: number; deltaY: number; modifiers: number }
  | { kind: 'key'; type: 'down' | 'up'; key: string; code: string; modifiers: number; repeat?: boolean; location?: number }
  /** A single typed character without key events (legacy keypress path). */
  | { kind: 'char'; text: string }
  /** Committed text from IME composition, dictation or paste. */
  | { kind: 'insertText'; text: string }
  | { kind: 'touch'; type: 'start' | 'move' | 'end' | 'cancel'; points: TouchPoint[]; modifiers: number };

export type TouchPoint = { x: number; y: number; id: number; radiusX?: number; radiusY?: number; force?: number };

/* ------------------------------------------------------------------ */
/* Client -> server                                                    */
/* ------------------------------------------------------------------ */

export type OpenMessage = {
  t: 'open';
  pageId: string;
  url: string;
  /** Agent session nonce (envelopes carry it; see src/agent/transport.ts). */
  session: string;
  /** Agent instrumentation flags (e.g. 'ev', 'net'). */
  flags: string[];
  screencast?: ScreencastOptions;
  /** Engine to open the page in (default chromium). */
  engine?: RemoteEngine;
  /** Device profile id (lets engines such as the iOS Simulator pick matching hardware). */
  deviceId?: string;
} & EmulationParams;

export type ClientMessage =
  | OpenMessage
  /** Resize / re-emulate in place. Never reloads: page state survives fold, unfold and rotation. */
  | ({ t: 'emulate'; pageId: string } & EmulationParams)
  | { t: 'navigate'; pageId: string; url: string }
  | { t: 'reload'; pageId: string }
  | { t: 'history'; pageId: string; direction: 'back' | 'forward' }
  | { t: 'close'; pageId: string }
  | { t: 'input'; pageId: string; event: RemoteInput }
  | ({ t: 'screencast'; pageId: string } & ScreencastOptions)
  /** Studio -> agent envelope (see src/shared/protocol.ts). */
  | { t: 'agent'; pageId: string; env: unknown }
  | { t: 'ping'; ts: number };

/* ------------------------------------------------------------------ */
/* Server -> client                                                    */
/* ------------------------------------------------------------------ */

export type DisplayFeatureMethod = 'displayFeaturesOverride' | 'deviceMetrics' | 'none';

export type BrowserCapabilities = {
  engine: RemoteEngine;
  /** How foldable display features are emulated, verified with viewport-segment media queries. */
  displayFeatures: { supported: boolean; method: DisplayFeatureMethod; detail: string };
  touch: boolean;
  screencast: boolean;
  userAgentOverride: boolean;
};

export type ServerHello = {
  t: 'hello';
  version: number;
  browser: string;
  maxPages: number;
  capabilities: BrowserCapabilities;
  /** Every engine this companion knows about, available or not. */
  engines?: EngineInfo[];
};

export type PageStatus = 'opening' | 'loading' | 'ready' | 'error' | 'crashed' | 'closed';

export type WireConsoleEntry = { level: 'log' | 'info' | 'warn' | 'error' | 'debug'; args: string[]; ts: number; source?: string };
export type WirePageError = { message: string; stack?: string; ts: number; source?: string; line?: number; column?: number };

export type WireNetworkEntry = {
  url: string;
  method: string;
  status: number | null;
  /** Chromium resource type (document, stylesheet, script, image, font, fetch, xhr, …). */
  type: string;
  /** ms since the current document's navigation request started. */
  startTime: number;
  duration: number;
  /** Encoded response size incl. headers, in bytes (null if unknown). */
  transferSize: number | null;
  failed: boolean;
  failureReason?: string;
  initiator?: string;
  fromCache?: boolean;
  source: RemoteEngine;
};

export type ServerErrorCode = 'launch-failed' | 'page-limit' | 'invalid' | 'no-page' | 'forbidden' | 'internal';

export type ServerMessage =
  | ServerHello
  | { t: 'status'; pageId: string; status: PageStatus; url?: string; title?: string; error?: string; httpStatus?: number | null }
  /** Same-document navigation (hash / history API). */
  | { t: 'navigated'; pageId: string; url: string }
  | {
      t: 'emulated';
      pageId: string;
      viewport: { width: number; height: number; dpr: number };
      displayFeature: 'applied' | 'unsupported' | 'none';
      detail?: string;
      /** Touch support changed: touch event APIs only appear after the next load. */
      touchNeedsReload?: boolean;
    }
  /**
   * Visual viewport in CSS px. Differs from the device viewport when a mobile page has no
   * `<meta name=viewport>` (980px layout shown at scale ≈ 0.4) — the studio sizes the canvas
   * box accordingly so agent rects and input coordinates (both layout CSS px) line up.
   */
  | { t: 'metrics'; pageId: string; visual: VisualViewport }
  | { t: 'agent'; pageId: string; env: unknown }
  /** Chromium console, only for documents where the injected agent is not running. */
  | { t: 'console'; pageId: string; entry: WireConsoleEntry }
  /** Chromium page errors, only for documents where the injected agent is not running. */
  | { t: 'pageerror'; pageId: string; error: WirePageError }
  | { t: 'network'; pageId: string; entries: WireNetworkEntry[] }
  /** The page tried to open a new window; IFDY closed it and reports the URL. */
  | { t: 'popup'; pageId: string; url: string }
  | { t: 'dialog'; pageId: string; dialogType: string; message: string }
  | { t: 'error'; pageId?: string; code: ServerErrorCode; message: string }
  | { t: 'pong'; ts: number };

export type VisualViewport = { width: number; height: number; scale: number; offsetX: number; offsetY: number };

export type FrameHeader = {
  t: 'frame';
  pageId: string;
  /** CSS size the image represents. */
  width: number;
  height: number;
  /** Capture timestamp (s, Chromium clock). */
  ts: number;
  pageScale: number;
  seq: number;
};

/* ------------------------------------------------------------------ */
/* Binary frame codec                                                  */
/* ------------------------------------------------------------------ */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function encodeFrame(header: FrameHeader, image: Uint8Array): Uint8Array {
  const head = enc.encode(JSON.stringify(header));
  const out = new Uint8Array(4 + head.length + image.length);
  new DataView(out.buffer).setUint32(0, head.length, false);
  out.set(head, 4);
  out.set(image, 4 + head.length);
  return out;
}

export function decodeFrame(buf: ArrayBuffer | Uint8Array): { header: FrameHeader; image: Uint8Array } | null {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < 4) return null;
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
  if (len <= 0 || 4 + len > bytes.length) return null;
  try {
    const header = JSON.parse(dec.decode(bytes.subarray(4, 4 + len))) as FrameHeader;
    if (header?.t !== 'frame' || typeof header.pageId !== 'string') return null;
    return { header, image: bytes.subarray(4 + len) };
  } catch {
    return null;
  }
}

/** Only http(s) pages (and about:blank) may be opened in the controlled browser. */
export function isAllowedRemoteUrl(url: string): boolean {
  if (url === 'about:blank') return true;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
