import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Envelope } from '@shared/protocol';
import type { DeviceProfile, Orientation, Posture } from '@shared/types';
import { toast } from 'sonner';
import { Spinner } from '@/ui';
import { studio, useStudio } from '@/store';
import { newSession, PreviewConnection } from '../connection';
import type { PreviewRole } from '../PreviewFrame';
import { previews } from '../registry';
import { wireConnection } from '../wire';
import { remoteEmulation } from './emulation';
import { buttonName, ClickTracker, isComposingKey, isPasteShortcut, mapPoint, modifiersOf, normalizeWheel, screencastSize } from './input';
import type { EmulationParams, FrameHeader, RemoteInput, ScreencastOptions, TouchPoint, VisualViewport } from './protocol';
import { useRemoteInfo, type RemoteInfo } from './remote-store';
import { browserSocket, type PageEvent } from './socket';
import { createRemoteTransport, type RemoteTransport } from './transport';
import s from './remote.module.css';

type Phase = RemoteInfo['phase'];

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => matchMedia(query).matches,
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * Controlled-browser preview: a page running in the companion's Chromium,
 * streamed into a canvas sized exactly to the CSS viewport. Input is forwarded
 * through CDP (mouse, wheel, keyboard + IME, touch on touch devices) and the
 * injected agent makes the page fully inspectable through the regular
 * PreviewConnection. Viewport, fold and orientation changes re-emulate in
 * place, so page state survives folding and rotation.
 */
export function RemoteFrame({
  instanceId,
  role,
  url,
  width,
  height,
  device,
  posture,
  orientation,
  colorScheme,
  interactive,
}: {
  instanceId: string;
  role: PreviewRole;
  url: string;
  width: number;
  height: number;
  device: DeviceProfile;
  posture: Posture;
  orientation: Orientation;
  colorScheme?: 'light' | 'dark' | null;
  interactive: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const available = useStudio((st) => st.server.capabilities?.browser.available ?? null);
  const unavailableReason = useStudio((st) => st.server.capabilities?.browser.reason ?? '');
  const serverStatus = useStudio((st) => st.server.status);
  const reloadNonce = useStudio((st) => st.reloadNonce);
  const instrumentEvents = useStudio((st) => st.settings.instrumentEvents);
  const instrumentNetwork = useStudio((st) => st.settings.instrumentNetwork);
  const osDark = useMedia('(prefers-color-scheme: dark)');
  const osReduced = useMedia('(prefers-reduced-motion: reduce)');
  const [phase, setPhaseState] = useState<Phase>('connecting');
  const [hasFrame, setHasFrame] = useState(false);
  const [visual, setVisual] = useState<VisualViewport | null>(null);
  const [imePos, setImePos] = useState({ x: 0, y: 0 });
  const flags = useMemo(() => [instrumentEvents ? 'ev' : '', instrumentNetwork ? 'net' : ''].filter(Boolean), [instrumentEvents, instrumentNetwork]);

  // Previewed pages follow the studio's own OS preferences unless the studio overrides them
  // (an iframe would inherit them; a headless browser would not).
  const emulation = useMemo<EmulationParams>(() => {
    const e = remoteEmulation(device, posture, orientation, { width, height });
    return { device: e.device, fold: e.fold, colorScheme: colorScheme ?? (osDark ? 'dark' : null), reducedMotion: osReduced };
  }, [device, posture, orientation, width, height, colorScheme, osDark, osReduced]);

  /** Mutable state shared by socket callbacks and DOM handlers (never triggers renders). */
  const L = useRef({
    pageId: '',
    session: '',
    conn: null as PreviewConnection | null,
    transport: null as RemoteTransport | null,
    openedGen: -1,
    url,
    lastUrlProp: url,
    emu: emulation,
    screencast: { enabled: true, quality: 70, maxWidth: Math.round(width), maxHeight: Math.round(height) } as ScreencastOptions,
    screencastKey: '',
    hasFrame: false,
    width,
    height,
    visual: null as VisualViewport | null,
    decoding: false,
    pending: null as { header: FrameHeader; image: Uint8Array } | null,
    open: () => {},
    emuTimer: 0 as unknown as ReturnType<typeof setTimeout> | 0,
    emuSentAt: 0,
    phase: 'connecting' as Phase,
  }).current;
  L.width = width;
  L.height = height;
  L.emu = emulation;

  const setPhase = (p: Phase) => {
    L.phase = p;
    setPhaseState(p);
    useRemoteInfo.getState().patch(instanceId, { phase: p });
  };

  /* ------------------------------------------------------------------ */
  /* Connection lifecycle                                                */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (available === false) {
      studio().upsertInstance(instanceId, {
        role,
        status: 'error',
        url,
        engine: 'remote',
        error: `The controlled Chromium is unavailable: ${unavailableReason || 'the companion did not report a browser.'}`,
      });
      setPhase('unavailable');
      return () => {
        studio().removeInstance(instanceId);
        useRemoteInfo.getState().remove(instanceId);
      };
    }
    if (available === null) {
      studio().upsertInstance(instanceId, { role, status: 'loading', url, engine: 'remote', error: undefined });
      setPhase('connecting');
      return () => studio().removeInstance(instanceId);
    }

    const pageId = `${instanceId.replace(/[^\w.:-]/g, '_').slice(0, 60)}~${newSession().slice(0, 10)}`;
    const session = newSession();
    const transport = createRemoteTransport(pageId, session);
    const conn = new PreviewConnection(instanceId, session, transport);
    L.pageId = pageId;
    L.session = session;
    L.conn = conn;
    L.transport = transport;
    L.openedGen = -1;
    L.hasFrame = false;
    L.screencastKey = '';
    setHasFrame(false);
    previews.register(conn);
    const unwire = wireConnection(conn, role);
    studio().upsertInstance(instanceId, { role, status: 'loading', url: L.url, title: '', engine: 'remote', error: undefined, viewport: { width: L.width, height: L.height, dpr: device.pixelRatio } });
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const open = () => {
      if (disposed || browserSocket.state !== 'open' || L.openedGen === browserSocket.generation) return;
      const reopening = L.openedGen !== -1;
      L.openedGen = browserSocket.generation;
      if (reopening) conn.resetPending('Reconnected to Chromium');
      setPhase('opening');
      studio().upsertInstance(instanceId, { status: 'loading', error: undefined });
      browserSocket.send({ t: 'open', pageId, url: L.url, session, flags, ...L.emu, screencast: L.screencast });
    };
    L.open = () => {
      L.openedGen = -1;
      open();
    };

    const sync = () => {
      const st = browserSocket.state;
      if (st === 'open') open();
      else if (st === 'failed') {
        setPhase('error');
        studio().upsertInstance(instanceId, { status: 'error', error: browserSocket.lastError || 'Could not connect to the controlled browser.' });
      } else if (st === 'connecting' || st === 'reconnecting') {
        if (L.phase !== 'connecting') setPhase('connecting');
      }
    };

    const ev = (name: string, payload: unknown) => transport.deliver(transport.event(name, payload));

    const onEvent = (e: PageEvent) => {
      switch (e.t) {
        case 'frame':
          drawFrame(e.header, e.image);
          if (!L.hasFrame) {
            L.hasFrame = true;
            setHasFrame(true);
            useRemoteInfo.getState().patch(instanceId, { frames: 1 });
          }
          if (L.phase === 'opening') setPhase('loading');
          return;
        case 'status': {
          if (e.status === 'opening') return setPhase('opening');
          if (e.status === 'loading') {
            conn.resetPending('Navigating');
            setPhase('loading');
            studio().upsertInstance(instanceId, { status: 'loading', url: e.url ?? studio().instances[instanceId]?.url, error: undefined });
            return;
          }
          if (e.status === 'ready') {
            setPhase('streaming');
            useRemoteInfo.getState().patch(instanceId, { httpStatus: e.httpStatus ?? null });
            studio().upsertInstance(instanceId, { url: e.url, title: e.title ?? '' });
            // Pages where the agent cannot run (error pages, PDFs) still count as loaded.
            if (readyTimer) clearTimeout(readyTimer);
            readyTimer = setTimeout(() => {
              if (studio().instances[instanceId]?.status === 'loading') studio().upsertInstance(instanceId, { status: 'ready' });
            }, 2500);
            return;
          }
          if (e.status === 'error') {
            setPhase('error');
            studio().upsertInstance(instanceId, { status: 'error', url: e.url ?? studio().instances[instanceId]?.url, error: e.error ?? 'The page failed to load.' });
            return;
          }
          if (e.status === 'crashed') {
            setPhase('error');
            studio().upsertInstance(instanceId, { status: 'crashed', error: e.error });
            return;
          }
          if (e.status === 'closed') {
            L.openedGen = -1;
            setPhase('error');
            studio().upsertInstance(instanceId, { status: 'error', error: `${e.error ?? 'The page was closed.'} Reload to open it again.` });
          }
          return;
        }
        case 'emulated':
          useRemoteInfo.getState().patch(instanceId, { displayFeature: e.displayFeature, detail: e.detail, touchNeedsReload: e.touchNeedsReload });
          if (!conn.ready) studio().upsertInstance(instanceId, { viewport: e.viewport });
          return;
        case 'metrics':
          L.visual = e.visual;
          setVisual((v) => (v && JSON.stringify(v) === JSON.stringify(e.visual) ? v : e.visual));
          return;
        case 'navigated':
          studio().upsertInstance(instanceId, { url: e.url });
          return;
        case 'agent':
          transport.deliver(e.env as Envelope);
          return;
        case 'console':
          ev('console', { level: e.entry.level, args: e.entry.args, ts: e.entry.ts, source: e.entry.source ? `chromium · ${e.entry.source}` : 'chromium' });
          return;
        case 'pageerror':
          ev('error', { message: e.error.message, stack: e.error.stack, ts: e.error.ts, kind: 'runtime', source: e.error.source });
          return;
        case 'network':
          ev('network', { entries: e.entries });
          return;
        case 'dialog':
          ev('console', { level: 'info', args: [`${e.dialogType}(): “${e.message}” — dismissed automatically by the controlled browser`], ts: Date.now(), source: 'chromium' });
          return;
        case 'popup':
          if (role === 'primary' || role === 'compare') {
            toast('The page tried to open a new window', {
              id: `ifdy-popup-${e.url}`,
              description: e.url,
              action: { label: 'Open here', onClick: () => browserSocket.send({ t: 'navigate', pageId, url: e.url }) },
            });
          }
          return;
        case 'error':
          if (e.code === 'no-page') return L.open();
          if (e.code === 'page-limit' || e.code === 'forbidden') {
            setPhase('error');
            studio().upsertInstance(instanceId, { status: 'error', error: e.message });
          } else console.warn('[ifdy] controlled browser:', e.message);
          return;
      }
    };

    const offState = browserSocket.onState(sync);
    const offPage = browserSocket.subscribe(pageId, onEvent);
    sync();
    return () => {
      disposed = true;
      if (readyTimer) clearTimeout(readyTimer);
      if (L.emuTimer) clearTimeout(L.emuTimer);
      offState();
      browserSocket.send({ t: 'close', pageId });
      offPage();
      unwire();
      conn.dispose();
      previews.unregister(instanceId);
      studio().removeInstance(instanceId);
      useRemoteInfo.getState().remove(instanceId);
      L.conn = null;
      L.transport = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, role, flags, available]);

  /* ------------------------------------------------------------------ */
  /* Navigation, reload, emulation                                       */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (url === L.lastUrlProp) return;
    const prev = L.lastUrlProp;
    L.lastUrlProp = url;
    L.url = url;
    if (L.openedGen !== browserSocket.generation) return; // will open with the new URL
    const live = studio().instances[instanceId];
    const conn = L.conn;
    const base = (u: string) => u.split('#')[0];
    if (conn?.ready && url.includes('#') && base(url) === base(prev) && live?.url && base(live.url) === base(url)) {
      conn.tell('nav.go', { url: url.slice(url.indexOf('#')) });
      return;
    }
    browserSocket.send({ t: 'navigate', pageId: L.pageId, url });
  }, [url, instanceId, L]);

  const firstReload = useRef(true);
  useEffect(() => {
    if (firstReload.current) {
      firstReload.current = false;
      return;
    }
    L.conn?.resetPending('Reloading');
    studio().upsertInstance(instanceId, { status: 'loading', error: undefined });
    if (L.openedGen === browserSocket.generation) browserSocket.send({ t: 'reload', pageId: L.pageId });
    else if (browserSocket.state === 'failed') browserSocket.retry();
    else L.open();
  }, [reloadNonce, instanceId, L]);

  // Re-emulate in place (throttled to ~25/s while a fold animation resizes the viewport).
  const emuKey = JSON.stringify(emulation);
  useEffect(() => {
    if (L.openedGen !== browserSocket.generation || !L.pageId) return;
    const send = () => {
      L.emuTimer = 0;
      L.emuSentAt = Date.now();
      browserSocket.send({ t: 'emulate', pageId: L.pageId, ...L.emu });
    };
    if (L.emuTimer) return;
    const wait = Math.max(0, 40 - (Date.now() - L.emuSentAt));
    if (wait === 0) send();
    else L.emuTimer = setTimeout(send, wait);
  }, [emuKey, L]);

  /* ------------------------------------------------------------------ */
  /* Screencast: size to what is displayed, pause when hidden            */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let intersecting = true;
    const io = new IntersectionObserver((entries) => {
      intersecting = entries.some((x) => x.isIntersecting);
      tick();
    });
    io.observe(root);
    const tick = () => {
      const r = root.getBoundingClientRect();
      const shown =
        intersecting &&
        document.visibilityState === 'visible' &&
        r.width > 2 &&
        (typeof root.checkVisibility !== 'function' || root.checkVisibility({ visibilityProperty: true } as CheckVisibilityOptions));
      const size = screencastSize({ cssWidth: L.width, cssHeight: L.height, displayScale: r.width / Math.max(1, L.width), screenDpr: window.devicePixelRatio || 1, deviceDpr: device.pixelRatio });
      const next: ScreencastOptions = { enabled: shown, quality: size.scale >= 1 ? 76 : 68, maxWidth: size.maxWidth, maxHeight: size.maxHeight };
      L.screencast = next;
      const key = JSON.stringify(next);
      if (key === L.screencastKey || L.openedGen !== browserSocket.generation) return;
      L.screencastKey = key;
      browserSocket.send({ t: 'screencast', pageId: L.pageId, ...next });
    };
    const timer = setInterval(tick, 350);
    document.addEventListener('visibilitychange', tick);
    tick();
    return () => {
      io.disconnect();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [device.pixelRatio, L]);

  /* ------------------------------------------------------------------ */
  /* Frames                                                              */
  /* ------------------------------------------------------------------ */
  const drawFrame = (header: FrameHeader, image: Uint8Array) => {
    if (L.decoding) {
      L.pending = { header, image };
      return;
    }
    L.decoding = true;
    createImageBitmap(new Blob([image as BlobPart], { type: 'image/jpeg' }))
      .then((bmp) => {
        const c = canvasRef.current;
        const ctx = c?.getContext('2d', { alpha: false });
        if (c && ctx) {
          // Backing store at the image's own density; the frame is drawn at its natural CSS size so a
          // stale frame during a resize is never stretched.
          const k = bmp.width / Math.max(1, header.width);
          const bw = Math.max(1, Math.round(L.width * k));
          const bh = Math.max(1, Math.round(L.height * k));
          if (c.width !== bw || c.height !== bh) {
            c.width = bw;
            c.height = bh;
          }
          ctx.fillStyle = '#ffffff';
          if (bmp.width < bw || bmp.height < bh) ctx.fillRect(0, 0, bw, bh);
          ctx.drawImage(bmp, 0, 0);
        }
        bmp.close();
      })
      .catch(() => {})
      .finally(() => {
        L.decoding = false;
        const p = L.pending;
        L.pending = null;
        if (p) drawFrame(p.header, p.image);
      });
  };

  /* ------------------------------------------------------------------ */
  /* Input                                                               */
  /* ------------------------------------------------------------------ */
  const clicks = useRef(new ClickTracker()).current;
  const touches = useRef(new Map<number, TouchPoint>()).current;
  const held = useRef(new Set<string>()).current;
  const moveRaf = useRef<{ raf: number; ev: RemoteInput | null }>({ raf: 0, ev: null }).current;
  const composing = useRef(false);

  const scaled = visual && Math.abs(visual.scale - 1) > 0.01 && visual.scale > 0 ? visual.scale : 1;
  const cssW = width / scaled;
  const cssH = height / scaled;

  const opened = () => L.openedGen === browserSocket.generation && Boolean(L.pageId);
  const send = (event: RemoteInput) => {
    if (opened()) browserSocket.send({ t: 'input', pageId: L.pageId, event });
  };
  const sendSoon = (event: RemoteInput) => {
    moveRaf.ev = event;
    if (moveRaf.raf) return;
    moveRaf.raf = requestAnimationFrame(() => {
      moveRaf.raf = 0;
      const e = moveRaf.ev;
      moveRaf.ev = null;
      if (e) send(e);
    });
  };
  const flushMove = () => {
    if (moveRaf.raf) cancelAnimationFrame(moveRaf.raf);
    moveRaf.raf = 0;
    const e = moveRaf.ev;
    moveRaf.ev = null;
    if (e) send(e);
  };
  const point = (e: { clientX: number; clientY: number }) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return mapPoint(e.clientX, e.clientY, r, { width: cssW, height: cssH }, { x: L.visual?.offsetX ?? 0, y: L.visual?.offsetY ?? 0 });
  };
  const touchMode = () => device.touch && studio().interaction === 'interact';
  const focusInput = (clientX: number, clientY: number) => {
    const c = canvasRef.current;
    const t = inputRef.current;
    if (!c || !t) return;
    const r = c.getBoundingClientRect();
    // Keep the (invisible) IME anchor near the pointer so candidate windows appear in place.
    setImePos({ x: Math.max(0, ((clientX - r.left) / Math.max(1, r.width)) * width), y: Math.max(0, ((clientY - r.top) / Math.max(1, r.height)) * height) });
    if (document.activeElement !== t) t.focus({ preventScroll: true });
  };
  const touchList = () => [...touches.values()];

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    // Like an iframe, the canvas owns its pointer events (no canvas panning / deselect underneath).
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    focusInput(e.clientX, e.clientY);
    const p = point(e);
    if (touchMode() || (device.touch && e.pointerType === 'touch')) {
      touches.set(e.pointerId, { x: p.x, y: p.y, id: e.pointerId % 1000, radiusX: e.width / 2 || undefined, radiusY: e.height / 2 || undefined, force: e.pressure || undefined });
      flushMove();
      send({ kind: 'touch', type: 'start', points: touchList(), modifiers: modifiersOf(e) });
      return;
    }
    flushMove();
    const count = clicks.down(p.x, p.y, e.button, e.timeStamp);
    send({ kind: 'mouse', type: 'down', x: p.x, y: p.y, button: buttonName(e.button), buttons: e.buttons, clickCount: count, modifiers: modifiersOf(e) });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    const p = point(e);
    if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, { ...touches.get(e.pointerId)!, x: p.x, y: p.y, force: e.pressure || undefined });
      sendSoon({ kind: 'touch', type: 'move', points: touchList(), modifiers: modifiersOf(e) });
      return;
    }
    if (touchMode() && !e.buttons) return; // touch screens have no hover
    if (!p.inside && !e.buttons) return;
    sendSoon({ kind: 'mouse', type: 'move', x: p.x, y: p.y, button: e.buttons ? buttonName(e.button < 0 ? 0 : e.button) : 'none', buttons: e.buttons, clickCount: 0, modifiers: modifiersOf(e) });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>, cancel = false) => {
    if (!interactive) return;
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const p = point(e);
    flushMove();
    if (touches.has(e.pointerId)) {
      touches.delete(e.pointerId);
      if (touches.size) send({ kind: 'touch', type: 'move', points: touchList(), modifiers: modifiersOf(e) });
      else send({ kind: 'touch', type: cancel ? 'cancel' : 'end', points: [], modifiers: modifiersOf(e) });
      return;
    }
    send({ kind: 'mouse', type: 'up', x: p.x, y: p.y, button: buttonName(e.button), buttons: e.buttons, clickCount: clicks.current(), modifiers: modifiersOf(e) });
  };

  // Wheel needs a non-passive native listener. Ctrl/⌘ + wheel stays with the studio (canvas zoom).
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      if (!interactive || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      const p = point(e);
      const { dx, dy } = normalizeWheel(e, L.height);
      const prev = moveRaf.ev?.kind === 'wheel' ? moveRaf.ev : null;
      sendSoon({ kind: 'wheel', x: p.x, y: p.y, deltaX: dx + (prev?.deltaX ?? 0), deltaY: dy + (prev?.deltaY ?? 0), modifiers: modifiersOf(e) });
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  });

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composing.current || isComposingKey({ isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode, key: e.key })) return;
    if (isPasteShortcut(e)) return; // the paste event carries the studio clipboard
    e.preventDefault();
    e.stopPropagation();
    held.add(e.key);
    send({ kind: 'key', type: 'down', key: e.key, code: e.code, modifiers: modifiersOf(e), repeat: e.repeat, location: e.location });
  };
  const onKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composing.current || isComposingKey({ isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode, key: e.key })) return;
    if (!held.has(e.key) && isPasteShortcut(e)) return;
    e.preventDefault();
    e.stopPropagation();
    held.delete(e.key);
    send({ kind: 'key', type: 'up', key: e.key, code: e.code, modifiers: modifiersOf(e), location: e.location });
  };
  const releaseKeys = () => {
    for (const key of held) send({ kind: 'key', type: 'up', key, code: '', modifiers: 0 });
    held.clear();
  };
  const clearInput = () => {
    if (inputRef.current) inputRef.current.value = '';
  };

  /* ------------------------------------------------------------------ */
  const showPlaceholder = !hasFrame && phase !== 'error' && phase !== 'unavailable';
  const label =
    serverStatus === 'offline'
      ? 'Companion offline'
      : phase === 'connecting'
        ? browserSocket.state === 'reconnecting'
          ? 'Reconnecting to Chromium…'
          : 'Starting controlled Chromium…'
        : phase === 'opening'
          ? 'Opening page…'
          : `Loading ${hostOf(url)}…`;

  return (
    <div ref={rootRef} className={s.root} style={{ width, height }} data-remote-instance={instanceId}>
      <canvas
        ref={canvasRef}
        data-instance={instanceId}
        className={s.canvas}
        aria-label={`Live page on ${device.name} (controlled Chromium)`}
        style={{
          width: cssW,
          height: cssH,
          transform: scaled !== 1 ? `scale(${scaled})` : undefined,
          pointerEvents: interactive ? 'auto' : 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => onPointerUp(e)}
        onPointerCancel={(e) => onPointerUp(e, true)}
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      />
      <textarea
        ref={inputRef}
        className={s.ime}
        style={{ left: Math.min(imePos.x, width - 4), top: Math.min(imePos.y, height - 4) }}
        aria-label={`Keyboard input for the page on ${device.name}`}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={releaseKeys}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={(e) => {
          composing.current = false;
          if (e.data) send({ kind: 'insertText', text: e.data });
          clearInput();
        }}
        onInput={(e) => {
          const ne = e.nativeEvent as InputEvent;
          if (composing.current || ne.isComposing) return;
          // Text that arrives without key events (emoji picker, dictation, autocorrect).
          if (ne.data && ne.inputType?.startsWith('insert')) send({ kind: 'insertText', text: ne.data });
          clearInput();
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text/plain');
          e.preventDefault();
          if (text) send({ kind: 'insertText', text });
        }}
      />
      {showPlaceholder && (
        <div className={s.placeholder} aria-live="polite">
          <div className={s.placeholderInner}>
            <Spinner size={14} />
            <span>{label}</span>
          </div>
          <div className={s.engineNote}>Chromium · {device.name} emulation</div>
        </div>
      )}
      {hasFrame && phase === 'loading' && <div className={s.progress} aria-hidden />}
    </div>
  );
}
