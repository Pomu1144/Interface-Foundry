/**
 * IFDY preview agent.
 *
 * Injected as the first script of previewed documents (or via Playwright init
 * script in controlled-browser mode). It exposes a narrow, validated RPC surface
 * to the studio and reports console, errors, network timing, selection and
 * geometry. It never sends data anywhere except the studio that framed it.
 */
import { AGENT_METHODS, PROTOCOL_VERSION, type AgentEvents, type AgentMethod, type AgentMethods, type ListenerInfo, type PreviewEnv } from '@shared/protocol';
import type { Envelope } from '@shared/protocol';
import type { NodeId, NodeInfo } from '@shared/types';
import { a11yInfo, keyboardAudit, runAxe, setAgentOrigin } from './a11y';
import { hierarchy3d, layoutSnapshot, responsiveAudit } from './audit';
import { installConsoleCapture, installErrorCapture, installListenerInstrumentation, installNetworkCapture, instrumentedListeners, redactText } from './capture';
import { componentFor, hasReact } from './component';
import { children, find, snapshot } from './dom';
import { Inspector } from './inspect';
import { elementOf, idOf, isIfdyNode, labelFor, pathFor, rectOf, resolveSelector, textPreview, uniqueSelector } from './nodes';
import { applyPatchSet, reapplyAfterMutation } from './patches';
import { captureRaster } from './raster';
import { Recorder, isSensitiveField } from './recorder';
import { replayStep } from './recorder';
import { boxFor, breakpoints, computedFor, curatedComputed, layoutFor, scanTokens, stylesFor } from './styles';
import { createTransport } from './transport';

(function bootstrap() {
  if (window.__IFDY_AGENT__) return;
  const transport = createTransport();
  if (!transport) return;
  window.__IFDY_AGENT__ = { version: PROTOCOL_VERSION };

  const script = document.currentScript as HTMLScriptElement | null;
  try {
    setAgentOrigin(script?.src ? new URL(script.src).origin : location.origin);
  } catch {
    setAgentOrigin(location.origin);
  }

  const emit = <E extends keyof AgentEvents>(event: E, payload: AgentEvents[E]) => transport.send({ kind: 'event', event, payload });

  // Instrumentation that must run before application code.
  if (transport.flags.has('ev')) installListenerInstrumentation();
  installConsoleCapture(emit);
  installErrorCapture(emit);
  installNetworkCapture(emit, transport.flags.has('net'));

  const inspector = new Inspector(emit);
  const recorder = new Recorder((step) => emit('record.step', { step }));

  /* ---------------------------- env ---------------------------- */
  const envStyles: Record<string, HTMLStyleElement> = {};
  const envCss = (key: string, css: string | null) => {
    let el = envStyles[key];
    if (!css) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement('style');
      el.setAttribute('data-ifdy', '');
      el.id = `__ifdy-env-${key}`;
      envStyles[key] = el;
    }
    el.textContent = css;
    (document.head ?? document.documentElement).appendChild(el);
  };
  let originalFontSize: string | null = null;
  const setEnv = (env: PreviewEnv) => {
    if (env.fontScale !== undefined) {
      if (originalFontSize === null) originalFontSize = document.documentElement.style.fontSize;
      document.documentElement.style.fontSize = env.fontScale === 1 ? originalFontSize : `${env.fontScale * 100}%`;
    }
    if (env.freezeAnimations !== undefined) {
      envCss('freeze', env.freezeAnimations ? '*,*::before,*::after{animation-play-state:paused!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}' : null);
    }
    if (env.focusRings !== undefined) {
      envCss('focus', env.focusRings ? ':focus-visible{outline:2px solid #FF7A45!important;outline-offset:2px!important}' : null);
    }
  };

  /* -------------------------- listeners -------------------------- */
  const listenersFor = (id: NodeId): ListenerInfo[] => {
    const el = elementOf(id);
    if (!el) return [];
    const out: ListenerInfo[] = [];
    const targets: EventTarget[] = [];
    for (let cur: Element | null = el; cur; cur = cur.parentElement) targets.push(cur);
    targets.push(document, window);
    for (const t of targets) {
      const on = t === window ? { id: -1, label: 'window' } : t === document ? { id: -2, label: 'document' } : { id: idOf(t as Element), label: labelFor(t as Element) };
      if (t instanceof Element) {
        for (const a of t.attributes) {
          if (a.name.startsWith('on')) out.push({ type: a.name.slice(2), source: 'attribute', handler: a.value.slice(0, 200), on });
        }
      }
      for (const l of instrumentedListeners.get(t) ?? []) {
        const fn = typeof l.listener === 'function' ? l.listener : l.listener.handleEvent;
        out.push({ type: l.type, source: 'instrumented', capture: l.capture, passive: l.passive, once: l.once, handler: redactText(String(fn).slice(0, 240)), on });
      }
    }
    return out;
  };

  /* --------------------------- node info --------------------------- */
  const nodeInfo = (id: NodeId): NodeInfo | null => {
    const el = elementOf(id);
    if (!el) return null;
    const isTextLeaf = el.children.length === 0 && (el.textContent ?? '').trim().length > 0;
    return {
      id,
      tag: el.tagName.toLowerCase(),
      label: labelFor(el),
      selector: uniqueSelector(el),
      path: pathFor(el),
      attrs: [...el.attributes].filter((a) => a.name !== 'style' || a.value.length < 300).map((a) => [a.name, isSensitiveField(el) && a.name === 'value' ? '•••' : a.value] as [string, string]),
      classes: [...el.classList],
      text: isTextLeaf ? textPreview(el, 200) : undefined,
      rect: rectOf(el),
      box: boxFor(el),
      layout: layoutFor(el),
      computed: curatedComputed(el),
      a11y: a11yInfo(el),
      component: componentFor(el) ?? undefined,
      editableText: isTextLeaf && !/^(INPUT|TEXTAREA|SELECT|SCRIPT|STYLE)$/.test(el.tagName),
      isImage: el.tagName === 'IMG' || el.tagName === 'PICTURE' || (el.tagName === 'svg'),
    };
  };

  /* ---------------------------- handlers ---------------------------- */
  type Handlers = { [M in AgentMethod]: (p: AgentMethods[M][0]) => AgentMethods[M][1] | Promise<AgentMethods[M][1]> };
  const handlers: Handlers = {
    'agent.ping': () => ({ ts: Date.now() }),
    'dom.snapshot': (p) => snapshot((p as { maxNodes?: number } | undefined)?.maxNodes),
    'dom.children': ({ id }) => children(id),
    'dom.find': ({ text, limit }) => find(text, limit),
    'dom.resolve': ({ selector }) => {
      const el = resolveSelector(selector);
      return el ? idOf(el) : null;
    },
    'node.info': ({ id }) => nodeInfo(id),
    'node.styles': ({ id }) => stylesFor(id),
    'node.computed': ({ id }) => computedFor(id),
    'node.box': ({ id }) => {
      const el = elementOf(id);
      return el ? boxFor(el) : null;
    },
    'node.component': ({ id }) => {
      const el = elementOf(id);
      return el ? componentFor(el) : null;
    },
    'node.listeners': ({ id }) => listenersFor(id),
    'node.scrollIntoView': ({ id }) => {
      elementOf(id)?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    },
    'node.focus': ({ id }) => {
      (elementOf(id) as HTMLElement | null)?.focus?.();
    },
    'overlay.watch': ({ ids }) => inspector.watch(ids),
    'mode.set': ({ mode }) => inspector.setMode(mode),
    'patch.apply': (set) => applyPatchSet(set),
    'text.beginEdit': ({ id }) => inspector.beginEdit(id),
    'layout.snapshot': (p) => layoutSnapshot((p as { selectors?: string[] } | undefined)?.selectors),
    'layout.breakpoints': () => breakpoints(),
    'layout.hierarchy3d': (p) => hierarchy3d((p as { maxNodes?: number } | undefined)?.maxNodes),
    'audit.responsive': (opts) => responsiveAudit(opts),
    'audit.a11y': (p) => runAxe((p as { viewport?: never } | undefined)?.viewport),
    'audit.keyboard': () => keyboardAudit(),
    'capture.raster': (opts) => captureRaster(opts ?? {}),
    'record.start': (opts) => recorder.start(opts),
    'record.stop': () => recorder.stop(),
    'replay.step': ({ action, timeout }) => replayStep(action, timeout),
    'tokens.scan': () => scanTokens(),
    'env.set': (env) => setEnv(env),
    'nav.go': ({ url }) => {
      if (url.startsWith('#')) location.hash = url;
      else location.href = new URL(url, location.href).href;
    },
    'nav.reload': () => {
      setTimeout(() => location.reload(), 0);
    },
    'scroll.set': ({ x, y, ratio }) => {
      if (ratio) {
        const se = document.scrollingElement ?? document.documentElement;
        window.scrollTo({ left: x * (se.scrollWidth - innerWidth), top: y * (se.scrollHeight - innerHeight), behavior: 'instant' as ScrollBehavior });
      } else window.scrollTo({ left: x, top: y, behavior: 'instant' as ScrollBehavior });
    },
    'state.form': () =>
      [...document.querySelectorAll<HTMLInputElement>('input, textarea, select')]
        .filter((el) => !isIfdyNode(el) && el.type !== 'hidden')
        .map((el) => ({
          selector: uniqueSelector(el),
          value: el.type === 'checkbox' || el.type === 'radio' ? String(el.checked) : isSensitiveField(el) ? (el.value ? `•••(${el.value.length})` : '') : el.value,
          focused: document.activeElement === el,
        })),
  };

  const allowed = new Set<string>(AGENT_METHODS);
  transport.onMessage(async (env: Envelope) => {
    if (env.kind !== 'request' || !env.method || env.id === undefined) return;
    if (!allowed.has(env.method)) {
      transport.send({ kind: 'response', id: env.id, error: `Unknown method ${env.method}` });
      return;
    }
    try {
      const fn = handlers[env.method as AgentMethod] as (p: unknown) => unknown;
      const result = await fn(env.payload);
      transport.send({ kind: 'response', id: env.id, payload: result });
    } catch (err) {
      transport.send({ kind: 'response', id: env.id, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /* ------------------------- lifecycle events ------------------------- */
  let lastUrl = location.href;
  let lastTitle = '';
  const hello = () =>
    emit('hello', {
      version: PROTOCOL_VERSION,
      url: location.href,
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      userAgent: navigator.userAgent,
      capabilities: { cssom: true, axe: true, raster: true, react: hasReact() },
    });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hello, { once: true });
  else hello();

  setInterval(() => {
    emit('heartbeat', { ts: Date.now() });
    if (location.href !== lastUrl || document.title !== lastTitle) {
      lastUrl = location.href;
      lastTitle = document.title;
      emit('navigation', { url: lastUrl, title: lastTitle });
    }
  }, 1000);
  window.addEventListener('hashchange', () => {
    lastUrl = location.href;
    emit('navigation', { url: location.href, title: document.title });
  });

  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => emit('viewport', { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }), 60);
  });

  let scrollPending = false;
  window.addEventListener(
    'scroll',
    () => {
      if (scrollPending) return;
      scrollPending = true;
      requestAnimationFrame(() => {
        scrollPending = false;
        const se = document.scrollingElement ?? document.documentElement;
        const maxX = Math.max(1, se.scrollWidth - innerWidth);
        const maxY = Math.max(1, se.scrollHeight - innerHeight);
        emit('scroll', { x: scrollX, y: scrollY, ratioX: scrollX / maxX, ratioY: scrollY / maxY });
      });
    },
    { passive: true },
  );

  // DOM changes: debounce notifications and keep patches applied.
  let mutTimer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver((records) => {
    if (records.every((r) => isIfdyNode(r.target) || [...r.addedNodes, ...r.removedNodes].every((n) => isIfdyNode(n)) && r.type === 'childList')) return;
    if (mutTimer) clearTimeout(mutTimer);
    mutTimer = setTimeout(() => {
      reapplyAfterMutation();
      emit('dom.changed', { reason: 'mutation' });
      inspector.scheduleRects();
    }, 200);
  });
  const startObserving = () =>
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-expanded'], characterData: true });
  if (document.documentElement) startObserving();
})();
