/**
 * Scripts IFDY runs inside Mobile Safari through WebDriver "Execute Script".
 *
 * WebDriver has no document-start hook (unlike Playwright's addInitScript), so
 * the agent is installed once each document has parsed: the bridge defines
 * `__IFDY_REMOTE__` + `__ifdyBridgeSend` (which queues envelopes in the page),
 * then runs the agent bundle. The companion drains the queue on every tick.
 * Documents served by IFDY's preview host already contain the agent tag; in a
 * top-level Safari window it finds no transport and stays inert, so this late
 * install is the one that runs.
 */

/** Marker the companion uses to recognise its own entries in the page's outbound queue. */
export const AXE_REQUEST_PREFIX = '\u0000axe:';
/** Upper bound on what one tick drains (envelopes can be large DOM snapshots). */
export const MAX_DRAIN_BYTES = 8 * 1024 * 1024;

/**
 * Body for Execute Script. arguments[0] = { session, flags }, arguments[1] = token.
 * The agent code is spliced into the body (not eval'd) so strict CSPs that forbid
 * eval do not matter.
 */
export function buildInstallScript(agent: string): string {
  return `var cfg = arguments[0], token = arguments[1];
if (window.top !== window) return 'frame';
if (window.__ifdyIos && window.__ifdyIos.token === token) return 'present';
if (window.__IFDY_AGENT__) return 'agent-present';
var q = [];
var state = { token: token, q: q, axe: {}, dropped: 0 };
try {
  Object.defineProperty(window, '__ifdyIos', { value: state, configurable: false, enumerable: false, writable: false });
  Object.defineProperty(window, '__IFDY_REMOTE__', { value: Object.freeze(cfg), configurable: false, enumerable: false, writable: false });
} catch (e) { return 'conflict'; }
window.__ifdyBridgeSend = function (json) {
  if (typeof json !== 'string') return;
  if (q.length >= 3000) { q.shift(); state.dropped++; }
  q.push(json);
};
window.__ifdyLoadAxe = function () {
  if (window.axe) return Promise.resolve();
  return new Promise(function (resolve, reject) {
    var id = Math.random().toString(36).slice(2);
    state.axe[id] = { resolve: resolve, reject: reject };
    q.push(${JSON.stringify(AXE_REQUEST_PREFIX)} + id);
  });
};
(function () {
${agent}
})();
return window.__IFDY_AGENT__ ? 'installed' : 'inert';`;
}

export type TickResult = {
  href: string;
  title: string;
  readyState: string;
  /** First tick in this document (navigation happened since the last tick). */
  fresh: boolean;
  /** The bridge is installed in this document. */
  bridge: boolean;
  queue: string[];
  dropped: number;
  innerWidth: number;
  innerHeight: number;
  dpr: number;
  visual: { width: number; height: number; scale: number; offsetX: number; offsetY: number } | null;
  httpStatus: number | null;
};

/** Body for Execute Script. arguments[0] = token, arguments[1] = byte budget. */
export const TICK_SCRIPT = `var token = arguments[0], budget = arguments[1];
var fresh = window.__ifdyIosSeen !== token;
if (fresh) { try { Object.defineProperty(window, '__ifdyIosSeen', { value: token, configurable: true }); } catch (e) {} }
var s = window.__ifdyIos, out = [], dropped = 0, used = 0;
if (s && s.token === token) {
  while (s.q.length && (out.length === 0 || used + s.q[0].length <= budget)) { used += s.q[0].length; out.push(s.q.shift()); }
  dropped = s.dropped; s.dropped = 0;
}
var vv = window.visualViewport;
var nav = null;
try { var e = performance.getEntriesByType('navigation')[0]; if (e && typeof e.responseStatus === 'number' && e.responseStatus > 0) nav = e.responseStatus; } catch (e2) {}
return {
  href: String(location.href), title: String(document.title || ''), readyState: document.readyState, fresh: fresh,
  bridge: !!(s && s.token === token), queue: out, dropped: dropped,
  innerWidth: window.innerWidth, innerHeight: window.innerHeight, dpr: window.devicePixelRatio || 1,
  visual: vv ? { width: vv.width, height: vv.height, scale: vv.scale, offsetX: vv.offsetLeft, offsetY: vv.offsetTop } : null,
  httpStatus: nav
};`;

/** Body for Execute Script. arguments[0] = envelope. */
export const DELIVER_SCRIPT = `if (typeof window.__ifdyReceive === 'function') window.__ifdyReceive(arguments[0]);`;

/** Body for Execute Script. arguments = [id, ok, error]. */
export const AXE_DONE_SCRIPT = `var s = window.__ifdyIos; if (!s) return;
var p = s.axe[arguments[0]]; if (!p) return; delete s.axe[arguments[0]];
if (arguments[1] && window.axe) p.resolve(); else p.reject(new Error(arguments[2] || 'axe-core could not be loaded into this page.'));`;

/** axe-core source followed by a check that it registered. */
export const buildAxeScript = (axe: string) => `${axe}\n;return typeof window.axe === 'object' || typeof window.axe === 'function';`;

/**
 * Body for Execute Script. arguments = [x, y, dx, dy]. Scrolls the nearest
 * scrollable ancestor under the point (else the page), like a wheel would.
 */
export const SCROLL_SCRIPT = `var x = arguments[0], y = arguments[1], dx = arguments[2], dy = arguments[3];
var el = document.elementFromPoint(x, y);
while (el && el !== document.body && el !== document.documentElement) {
  var cs = getComputedStyle(el);
  var canY = dy && /(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight;
  var canX = dx && /(auto|scroll|overlay)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth;
  if (canX || canY) { el.scrollBy(dx, dy); return 'element'; }
  el = el.parentElement;
}
window.scrollBy(dx, dy);
return 'window';`;
