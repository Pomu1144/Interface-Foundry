import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeFrame, type ServerMessage } from '@/modules/preview-runtime/remote/protocol';

vi.mock('@/modules/project-adapter/server-api', () => ({ wsUrl: async (p: string) => `ws://studio.test${p}?token=first` }));

class FakeWS {
  static OPEN = 1;
  static instances: FakeWS[] = [];
  readyState = 0;
  bufferedAmount = 0;
  binaryType = 'blob';
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  /* test helpers */
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  server(msg: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const hello: ServerMessage = {
  t: 'hello',
  version: 1,
  browser: 'Chromium test',
  maxPages: 12,
  capabilities: { engine: 'chromium', displayFeatures: { supported: true, method: 'deviceMetrics', detail: '' }, touch: true, screencast: true, userAgentOverride: true },
};

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('shared browser socket', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    FakeWS.instances = [];
    vi.stubGlobal('WebSocket', FakeWS);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ token: 'fresh' }), { status: 200 })));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('connects lazily, multiplexes by pageId and reconnects with a fresh token', async () => {
    const { browserSocket } = await import('@/modules/preview-runtime/remote/socket');
    expect(FakeWS.instances).toHaveLength(0);
    const a: unknown[] = [];
    const b: unknown[] = [];
    browserSocket.subscribe('a', (e) => a.push(e));
    browserSocket.subscribe('b', (e) => b.push(e));
    await flush();
    expect(FakeWS.instances).toHaveLength(1);
    const ws = FakeWS.instances[0];
    expect(ws.url).toBe('ws://studio.test/api/ws/browser?token=first');
    expect(browserSocket.send({ t: 'reload', pageId: 'a' })).toBe(false);

    ws.open();
    ws.server(hello);
    expect(browserSocket.state).toBe('open');
    expect(browserSocket.generation).toBe(1);
    expect(browserSocket.send({ t: 'reload', pageId: 'a' })).toBe(true);

    ws.server({ t: 'status', pageId: 'b', status: 'ready' });
    ws.onmessage?.({ data: encodeFrame({ t: 'frame', pageId: 'a', width: 10, height: 10, ts: 0, pageScale: 1, seq: 1 }, new Uint8Array([1, 2])).buffer });
    expect(b).toEqual([{ t: 'status', pageId: 'b', status: 'ready' }]);
    expect(a).toHaveLength(1);
    expect((a[0] as { t: string }).t).toBe('frame');

    // Companion restarts: socket drops, retries with a freshly bootstrapped token.
    ws.drop();
    expect(browserSocket.state).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(500);
    await flush();
    expect(FakeWS.instances).toHaveLength(2);
    expect(FakeWS.instances[1].url).toContain('token=fresh');
    FakeWS.instances[1].open();
    FakeWS.instances[1].server(hello);
    expect(browserSocket.generation).toBe(2);
    expect(browserSocket.state).toBe('open');
  });

  it('reports a launch failure instead of retrying forever', async () => {
    const { browserSocket } = await import('@/modules/preview-runtime/remote/socket');
    browserSocket.subscribe('a', () => {});
    await flush();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.server({ t: 'error', code: 'launch-failed', message: 'Could not start Chromium: missing binary' });
    ws.drop();
    expect(browserSocket.state).toBe('failed');
    expect(browserSocket.lastError).toMatch(/missing binary/);
  });

  it('closes the socket after the last page leaves', async () => {
    const { browserSocket } = await import('@/modules/preview-runtime/remote/socket');
    const off = browserSocket.subscribe('a', () => {});
    await flush();
    FakeWS.instances[0].open();
    FakeWS.instances[0].server(hello);
    off();
    await vi.advanceTimersByTimeAsync(16_000);
    expect(FakeWS.instances[0].readyState).toBe(3);
    expect(browserSocket.state).toBe('idle');
  });
});
