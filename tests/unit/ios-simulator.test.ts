import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenMessage, ServerMessage, FrameHeader } from '@/modules/preview-runtime/remote/protocol';
import type { PageHost } from '../../server/browser/remote-page';
import type { AgentBundle } from '../../server/agent-bundle';
import { DELIVER_SCRIPT, SCROLL_SCRIPT, TICK_SCRIPT } from '../../server/ios/bridge';
import { ExecError, type ChildLike, type ExecFn, type FetchLike, type IosDeps } from '../../server/ios/deps';
import { gestureToActions, InputMapper, jobToIdb, keyToActions, textToActions, WEBDRIVER_KEYS, type InputJob } from '../../server/ios/input';
import { engineInfo, IDLE_SHUTDOWN_MS, SimulatorPool } from '../../server/ios/pool';
import { chooseDeviceType, findIfdyDevice, iosRuntimes, jpegSize, parseInventory, pngSize } from '../../server/ios/simctl';
import { iosSimulatorStatus, SimulatorPage } from '../../server/ios/simulator-page';
import { friendlyDriverError, WebDriverClient, WebDriverError } from '../../server/ios/webdriver';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const RT18 = 'com.apple.CoreSimulator.SimRuntime.iOS-18-2';
const RT17 = 'com.apple.CoreSimulator.SimRuntime.iOS-17-5';
const T = (n: string) => `com.apple.CoreSimulator.SimDeviceType.${n.replace(/[^\w]+/g, '-')}`;
const deviceType = (name: string, productFamily: string) => ({ name, identifier: T(name), productFamily });

const INVENTORY = {
  devicetypes: [
    deviceType('iPhone 15', 'iPhone'),
    deviceType('iPhone 16 Pro', 'iPhone'),
    deviceType('iPhone 16 Pro Max', 'iPhone'),
    deviceType('iPhone SE (3rd generation)', 'iPhone'),
    deviceType('iPad Pro (12.9-inch) (6th generation)', 'iPad'),
    deviceType('iPad mini (6th generation)', 'iPad'),
  ],
  runtimes: [
    {
      identifier: RT17,
      name: 'iOS 17.5',
      version: '17.5',
      isAvailable: true,
      supportedDeviceTypes: [deviceType('iPhone 15', 'iPhone'), deviceType('iPad Pro (12.9-inch) (6th generation)', 'iPad')],
    },
    {
      identifier: RT18,
      name: 'iOS 18.2',
      version: '18.2',
      isAvailable: true,
      supportedDeviceTypes: [
        deviceType('iPhone 16 Pro', 'iPhone'),
        deviceType('iPhone 16 Pro Max', 'iPhone'),
        deviceType('iPhone SE (3rd generation)', 'iPhone'),
        deviceType('iPad Pro (12.9-inch) (6th generation)', 'iPad'),
        deviceType('iPad mini (6th generation)', 'iPad'),
      ],
    },
    { identifier: 'com.apple.CoreSimulator.SimRuntime.watchOS-11-2', name: 'watchOS 11.2', version: '11.2', isAvailable: true },
    { identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-19-0', name: 'iOS 19.0', version: '19.0', isAvailable: false },
  ],
  devices: {
    [RT18]: [
      // The user's own simulator: never booted, modified or deleted by IFDY.
      { udid: '11111111-1111-1111-1111-111111111111', name: 'iPhone 16 Pro', state: 'Shutdown', isAvailable: true, deviceTypeIdentifier: T('iPhone 16 Pro') },
      { udid: '22222222-2222-2222-2222-222222222222', name: 'IFDY iPhone 16 Pro Max', state: 'Booted', isAvailable: true, deviceTypeIdentifier: T('iPhone 16 Pro Max') },
    ],
  },
};

const NEW_UDID = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';

/** A PNG header (IHDR only) of the given size: enough for size sniffing. */
function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

/** A JPEG prefix with an APP0 segment and a baseline SOF0 marker. */
function jpeg(width: number, height: number, salt = 0): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, salt, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
}

type ExecCall = { file: string; args: string[] };

function fakeExec(opts: { inventory?: unknown; failBoot?: boolean; idb?: boolean } = {}) {
  const calls: ExecCall[] = [];
  const exec: ExecFn = async (file, args) => {
    calls.push({ file, args });
    if (file === 'idb') {
      if (opts.idb) return { stdout: '', stderr: '' };
      throw new ExecError('idb was not found on this machine.', 'idb', '', false, true);
    }
    const [, cmd] = args;
    if (cmd === 'list') return { stdout: JSON.stringify(opts.inventory ?? INVENTORY), stderr: '' };
    if (cmd === 'create') return { stdout: `${NEW_UDID}\n`, stderr: '' };
    if (cmd === 'bootstatus' && opts.failBoot) throw new ExecError('xcrun simctl bootstatus did not finish within 240s.', 'xcrun', '', true, false);
    return { stdout: '', stderr: '' };
  };
  return { exec, calls };
}

class FakeChild implements ChildLike {
  exitCode: number | null = null;
  killed: string[] = [];
  kill(signal?: NodeJS.Signals) {
    this.killed.push(signal ?? 'SIGTERM');
    this.exitCode = 0;
    return true;
  }
  once() {
    return this;
  }
  stderrTail() {
    return '';
  }
}

/** In-memory safaridriver: the W3C endpoints IFDY uses, with a scripted page. */
class FakeSafariDriver {
  calls: { method: string; path: string; body: Record<string, unknown> | undefined }[] = [];
  sessionError: { error: string; message: string } | null = null;
  navError: { error: string; message: string } | null = null;
  deleted = false;
  gone = false;
  installs: unknown[][] = [];
  delivered: unknown[] = [];
  actions: unknown[] = [];
  scrolls: unknown[][] = [];
  shot = png(402 * 3, 760 * 3);
  page = { href: 'about:blank', title: '', readyState: 'complete', fresh: true, bridge: false, queue: [] as string[], innerWidth: 402, innerHeight: 760, dpr: 3 };

  fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    this.calls.push({ method: init.method, path, body });
    const r = this.route(init.method, path, body);
    return { status: r.status ?? 200, text: async () => JSON.stringify({ value: r.value ?? null }) };
  };

  private route(method: string, path: string, body: Record<string, unknown> | undefined): { status?: number; value?: unknown } {
    if (path === '/status') return { value: { ready: true, message: '' } };
    if (method === 'POST' && path === '/session') {
      if (this.sessionError) return { status: 500, value: this.sessionError };
      return { value: { sessionId: 'S1', capabilities: { browserName: 'Safari' } } };
    }
    const m = /^\/session\/S1(\/.*)?$/.exec(path);
    if (!m || this.gone) return { status: 404, value: { error: 'invalid session id', message: 'The session no longer exists.' } };
    const sub = m[1] ?? '';
    if (method === 'DELETE' && sub === '') {
      this.deleted = true;
      return {};
    }
    switch (sub) {
      case '/timeouts':
        return {};
      case '/window':
        return { value: 'W1' };
      case '/window/handles':
        return { value: ['W1'] };
      case '/url':
        if (method === 'GET') return { value: this.page.href };
        if (this.navError) return { status: 500, value: this.navError };
        Object.assign(this.page, { href: String(body?.url), title: 'Demo', readyState: 'complete', fresh: true, bridge: false, queue: [] });
        return {};
      case '/refresh':
        Object.assign(this.page, { fresh: true, bridge: false });
        return {};
      case '/screenshot':
        return { value: this.shot.toString('base64') };
      case '/actions':
        if (method === 'POST') this.actions.push(body?.actions);
        return {};
      case '/orientation':
        return { status: 404, value: { error: 'unknown command', message: 'The command is not supported.' } };
      case '/execute/sync':
        return { value: this.exec(String(body?.script), (body?.args as unknown[]) ?? []) };
      default:
        return { status: 404, value: { error: 'unknown command', message: sub } };
    }
  }

  private exec(script: string, args: unknown[]) {
    if (script === TICK_SCRIPT) {
      const p = this.page;
      const r = {
        href: p.href,
        title: p.title,
        readyState: p.readyState,
        fresh: p.fresh,
        bridge: p.bridge,
        queue: p.queue,
        dropped: 0,
        innerWidth: p.innerWidth,
        innerHeight: p.innerHeight,
        dpr: p.dpr,
        visual: { width: p.innerWidth, height: p.innerHeight, scale: 1, offsetX: 0, offsetY: 0 },
        httpStatus: 200,
      };
      p.fresh = false;
      p.queue = [];
      return r;
    }
    if (script.includes('__IFDY_REMOTE__') && script.includes('AGENT_CODE')) {
      this.installs.push(args);
      this.page.bridge = true;
      const cfg = args[0] as { session: string };
      this.page.queue.push(JSON.stringify({ __ifdy: 1, session: cfg.session, kind: 'event', event: 'hello', payload: { url: this.page.href } }));
      // Envelopes for another session (or garbage) must never be relayed.
      this.page.queue.push(JSON.stringify({ __ifdy: 1, session: 'someone-else', kind: 'event', event: 'hello' }), '{not json');
      return 'installed';
    }
    if (script === DELIVER_SCRIPT) {
      this.delivered.push(args[0]);
      return null;
    }
    if (script === SCROLL_SCRIPT) {
      this.scrolls.push(args);
      return 'window';
    }
    return null;
  }
}

function makeDeps(over: Partial<IosDeps> & { exec?: ExecFn } = {}): IosDeps & { children: FakeChild[]; detached: string[][]; files: Map<string, Buffer> } {
  const children: FakeChild[] = [];
  const detached: string[][] = [];
  const files = new Map<string, Buffer>();
  return {
    platform: 'darwin',
    exec: fakeExec().exec,
    fetch: new FakeSafariDriver().fetch,
    spawn: () => {
      const c = new FakeChild();
      children.push(c);
      return c;
    },
    spawnDetached: (file, args) => detached.push([file, ...args]),
    freePort: async () => 4444,
    fileExists: async () => true,
    readFile: async (p) => files.get(p) ?? jpeg(1206, 2622),
    removeFile: async () => {},
    tmpDir: () => '/tmp',
    safaridriverPath: '/usr/bin/safaridriver',
    children,
    detached,
    files,
    ...over,
  };
}

function fakeHost() {
  const msgs: ServerMessage[] = [];
  const raw: string[] = [];
  const frames: { header: FrameHeader; image: Buffer }[] = [];
  const host: PageHost = {
    send: (m) => void msgs.push(m),
    sendRaw: (j) => void raw.push(j),
    sendFrame: (header, image) => void frames.push({ header, image }),
    scheduleAck: (_page, ack) => void setTimeout(ack, 30),
    agent: { get: async () => 'AGENT_CODE', getAxe: async () => 'AXE_CODE' } as unknown as AgentBundle,
    browserVersion: '',
    displayFeatureMethod: async () => ({ method: 'none', detail: '' }),
    isForbiddenUrl: (u) => (u.includes(':4310') ? 'The IFDY studio itself cannot be opened in the controlled browser.' : null),
  };
  const of = <K extends ServerMessage['t']>(t: K) => msgs.filter((m): m is Extract<ServerMessage, { t: K }> => m.t === t);
  return { host, msgs, raw, frames, of };
}

const openMsg = (over: Partial<OpenMessage> = {}): OpenMessage => ({
  t: 'open',
  pageId: 'p1',
  url: 'http://localhost:5174/demo/index.html',
  session: 'sess-1',
  flags: ['net'],
  engine: 'ios-simulator',
  deviceId: 'iphone-16-pro',
  device: { width: 402, height: 874, dpr: 3, mobile: true, touch: true },
  fold: null,
  colorScheme: null,
  reducedMotion: false,
  screencast: { enabled: true },
  ...over,
});

const simctlCalls = (calls: ExecCall[], cmd: string) => calls.filter((c) => c.file === 'xcrun' && c.args[1] === cmd).map((c) => c.args.slice(1));

const pages: SimulatorPage[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(pages.splice(0).map((p) => p.close()));
});

/* ------------------------------------------------------------------ */
/* simctl parsing and device matching                                  */
/* ------------------------------------------------------------------ */

describe('simctl inventory', () => {
  it('parses runtimes, device types and devices, newest available iOS runtime first', () => {
    const inv = parseInventory(JSON.stringify(INVENTORY));
    expect(inv.devices).toHaveLength(2);
    expect(inv.devices[0]).toMatchObject({ udid: '11111111-1111-1111-1111-111111111111', runtime: RT18, state: 'Shutdown' });
    expect(iosRuntimes(inv).map((r) => r.version)).toEqual(['18.2', '17.5']);
  });

  it('accepts the legacy availability string and rejects non-JSON', () => {
    const inv = parseInventory(JSON.stringify({ runtimes: [{ identifier: RT17, name: 'iOS 17.5', version: '17.5', availability: '(available)' }] }));
    expect(iosRuntimes(inv)).toHaveLength(1);
    expect(() => parseInventory('xcrun: error: unable to find utility "simctl"')).toThrow(/not JSON/);
  });

  it('maps IFDY device profiles to simulator device types', () => {
    const inv = parseInventory(JSON.stringify(INVENTORY));
    const pro = chooseDeviceType(inv, 'iphone-16-pro', { width: 402, height: 874 });
    expect(pro).toMatchObject({ deviceType: { name: 'iPhone 16 Pro' }, runtime: { version: '18.2' }, family: 'iPhone', substitute: false });
    expect(chooseDeviceType(inv, 'iphone-se', { width: 375, height: 667 })?.deviceType.name).toBe('iPhone SE (3rd generation)');
    expect(chooseDeviceType(inv, 'ipad-mini', { width: 744, height: 1133 })?.deviceType.name).toBe('iPad mini (6th generation)');
  });

  it('falls back to a close substitute and says so', () => {
    const inv = parseInventory(JSON.stringify(INVENTORY));
    // No "iPad Pro 13-inch (M4)" installed: the 12.9-inch model stands in.
    const ipad = chooseDeviceType(inv, 'ipad-pro-13', { width: 1032, height: 1376 });
    expect(ipad).toMatchObject({ deviceType: { name: 'iPad Pro (12.9-inch) (6th generation)' }, substitute: true, wanted: 'iPad Pro 13-inch (M4)', family: 'iPad' });
    // Non-iOS profiles pick by size: a tablet-sized Android profile gets an iPad.
    expect(chooseDeviceType(inv, 'galaxy-tab-s9', { width: 800, height: 1280 })).toMatchObject({ family: 'iPad', substitute: true });
    expect(chooseDeviceType(inv, 'pixel-8', { width: 412, height: 915 })).toMatchObject({ family: 'iPhone', substitute: true });
  });

  it('returns null when no iOS runtime is installed', () => {
    const inv = parseInventory(JSON.stringify({ ...INVENTORY, runtimes: [] }));
    expect(chooseDeviceType(inv, 'iphone-16-pro', { width: 402, height: 874 })).toBeNull();
  });

  it("only ever reuses IFDY's own simulators", () => {
    const inv = parseInventory(JSON.stringify(INVENTORY));
    expect(findIfdyDevice(inv, chooseDeviceType(inv, 'iphone-16-pro', { width: 402, height: 874 })!)).toBeNull();
    expect(findIfdyDevice(inv, chooseDeviceType(inv, 'iphone-16-pro-max', { width: 440, height: 956 })!)?.udid).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('reads JPEG and PNG dimensions', () => {
    expect(jpegSize(jpeg(1206, 2622))).toEqual({ width: 1206, height: 2622 });
    expect(pngSize(png(640, 480))).toEqual({ width: 640, height: 480 });
    expect(jpegSize(png(1, 1))).toBeNull();
    expect(pngSize(jpeg(1, 1))).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

describe('iOS Simulator status', () => {
  it('is unavailable off macOS without running anything', async () => {
    const { exec, calls } = fakeExec();
    const pool = new SimulatorPool(makeDeps({ platform: 'linux', exec }), { hookProcessExit: false });
    const info = engineInfo(await pool.status());
    expect(info).toMatchObject({ id: 'ios-simulator', available: false, features: { inspect: false, input: false } });
    expect(info.detail).toMatch(/Mac with Xcode; see docs\/IOS_SIMULATOR\.md/);
    expect(calls).toHaveLength(0);
  });

  it.runIf(process.platform !== 'darwin')('reports unavailable through the session entry point on this OS', async () => {
    const info = await iosSimulatorStatus({} as never);
    expect(info.available).toBe(false);
  });

  it('explains a missing Xcode and a missing runtime', async () => {
    const broken: ExecFn = async () => {
      throw new ExecError('xcrun was not found on this machine.', 'xcrun', '', false, true);
    };
    const a = await new SimulatorPool(makeDeps({ exec: broken }), { hookProcessExit: false }).status();
    expect(a).toMatchObject({ available: false });
    expect(a.detail).toMatch(/xcode-select/);
    const none = fakeExec({ inventory: { ...INVENTORY, runtimes: [] } });
    const b = await new SimulatorPool(makeDeps({ exec: none.exec }), { hookProcessExit: false }).status();
    expect(b.detail).toMatch(/No iOS Simulator runtime/);
  });

  it('labels the newest runtime, reflects safaridriver/idb, and caches the probe', async () => {
    const { exec, calls } = fakeExec({ idb: false });
    const pool = new SimulatorPool(makeDeps({ exec }), { hookProcessExit: false });
    const info = engineInfo(await pool.status());
    expect(info).toMatchObject({ available: true, label: 'Safari · iOS 18.2 Simulator', features: { inspect: true, input: true, touch: true, rotate: false, foldEmulation: false } });
    expect(info.detail).toMatch(/not yet verified on real hardware/i);
    await pool.status();
    expect(simctlCalls(calls, 'list')).toHaveLength(1);
    // One category at most: extra words would be read as a search filter, so ask for everything.
    expect(simctlCalls(calls, 'list')[0]).toEqual(['list', '-j']);

    const noDriver = new SimulatorPool(makeDeps({ exec, fileExists: async () => false }), { hookProcessExit: false });
    expect(engineInfo(await noDriver.status()).features).toMatchObject({ inspect: false, input: false });
    const withIdb = new SimulatorPool(makeDeps({ exec: fakeExec({ idb: true }).exec, fileExists: async () => false }), { hookProcessExit: false });
    expect(engineInfo(await withIdb.status()).features).toMatchObject({ inspect: false, input: true });
  });
});

/* ------------------------------------------------------------------ */
/* Pool: boot, limits, cleanup                                         */
/* ------------------------------------------------------------------ */

describe('simulator pool', () => {
  const dev = { width: 402, height: 874 };

  it('creates and boots a dedicated IFDY simulator (argument arrays, never the user device)', async () => {
    const { exec, calls } = fakeExec();
    const pool = new SimulatorPool(makeDeps({ exec }), { hookProcessExit: false });
    const lease = await pool.acquire('p1', 'iphone-16-pro', dev);
    expect(simctlCalls(calls, 'create')).toEqual([['create', 'IFDY iPhone 16 Pro', T('iPhone 16 Pro'), RT18]]);
    expect(simctlCalls(calls, 'boot')).toEqual([['boot', NEW_UDID]]);
    expect(simctlCalls(calls, 'bootstatus')).toEqual([['bootstatus', NEW_UDID, '-b']]);
    expect(lease).toMatchObject({ udid: NEW_UDID, bootedByIfdy: true, deviceType: 'iPhone 16 Pro', runtimeName: 'iOS 18.2', substitute: null });
    expect(calls.some((c) => c.args.includes('11111111-1111-1111-1111-111111111111'))).toBe(false);
  });

  it('allows one page per simulator and caps concurrent pages', async () => {
    const pool = new SimulatorPool(makeDeps(), { hookProcessExit: false, maxPages: 2 });
    await pool.acquire('p1', 'iphone-16-pro', dev);
    await expect(pool.acquire('p2', 'iphone-16-pro', dev)).rejects.toThrow(/already showing the iPhone 16 Pro simulator/);
    await pool.acquire('p3', 'iphone-se', { width: 375, height: 667 });
    await expect(pool.acquire('p4', 'ipad-mini', { width: 744, height: 1133 })).rejects.toThrow(/At most 2 iOS Simulator boards/);
  });

  it('shuts down only simulators IFDY booted, after an idle period', async () => {
    vi.useFakeTimers();
    const { exec, calls } = fakeExec();
    const pool = new SimulatorPool(makeDeps({ exec }), { hookProcessExit: false });
    const ours = await pool.acquire('p1', 'iphone-16-pro', dev);
    // Already running before IFDY touched it: must be left running.
    const running = await pool.acquire('p2', 'iphone-16-pro-max', { width: 440, height: 956 });
    expect(running.bootedByIfdy).toBe(false);
    expect(simctlCalls(calls, 'boot')).toEqual([['boot', NEW_UDID]]);
    pool.release(ours);
    pool.release(running);
    await vi.advanceTimersByTimeAsync(IDLE_SHUTDOWN_MS - 1000);
    expect(simctlCalls(calls, 'shutdown')).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(simctlCalls(calls, 'shutdown')).toEqual([['shutdown', NEW_UDID]]);
  });

  it('reusing a simulator before the idle timeout cancels its shutdown', async () => {
    vi.useFakeTimers();
    const { exec, calls } = fakeExec();
    const pool = new SimulatorPool(makeDeps({ exec }), { hookProcessExit: false });
    pool.release(await pool.acquire('p1', 'iphone-16-pro', dev));
    await vi.advanceTimersByTimeAsync(1000);
    await pool.acquire('p2', 'iphone-16-pro', dev);
    await vi.advanceTimersByTimeAsync(IDLE_SHUTDOWN_MS * 2);
    expect(simctlCalls(calls, 'shutdown')).toEqual([]);
  });

  it('on exit, stops drivers and shuts down only IFDY-booted simulators (detached)', async () => {
    const deps = makeDeps();
    const pool = new SimulatorPool(deps, { hookProcessExit: false });
    await pool.acquire('p1', 'iphone-16-pro', dev);
    await pool.acquire('p2', 'iphone-16-pro-max', { width: 440, height: 956 });
    const child = new FakeChild();
    pool.trackDriver(child);
    pool.shutdownAll();
    expect(child.killed).toEqual(['SIGTERM']);
    expect(deps.detached).toEqual([['xcrun', 'simctl', 'shutdown', NEW_UDID]]);
  });

  it('surfaces boot timeouts', async () => {
    const pool = new SimulatorPool(makeDeps({ exec: fakeExec({ failBoot: true }).exec }), { hookProcessExit: false });
    await expect(pool.acquire('p1', 'iphone-16-pro', dev)).rejects.toThrow(/did not finish within 240s/);
    expect(pool.activePages).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* WebDriver client                                                    */
/* ------------------------------------------------------------------ */

describe('WebDriver client', () => {
  it('turns W3C error payloads into typed errors', async () => {
    const driver = new FakeSafariDriver();
    driver.sessionError = { error: 'session not created', message: 'Could not create a session: You must enable the "Allow remote automation" option.' };
    const wd = new WebDriverClient('http://127.0.0.1:4444', driver.fetch);
    const err = await wd.newSession({ browserName: 'Safari' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WebDriverError);
    expect((err as WebDriverError).error).toBe('session not created');
    expect(friendlyDriverError(err)).toMatch(/safaridriver --enable.*Remote Automation/);
  });

  it('times out hung requests and reports lost connections', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const wd = new WebDriverClient('http://127.0.0.1:4444', hang);
    await expect(wd.status(30)).rejects.toMatchObject({ error: 'timeout' });
    const refused = new WebDriverClient('http://127.0.0.1:4444', async () => {
      throw new TypeError('fetch failed');
    });
    await expect(refused.status()).rejects.toMatchObject({ error: 'connection' });
  });
});

/* ------------------------------------------------------------------ */
/* Input mapping                                                       */
/* ------------------------------------------------------------------ */

describe('iOS input mapping', () => {
  const collect = () => {
    const jobs: InputJob[] = [];
    let t = 1000;
    const mapper = new InputMapper((j) => jobs.push(j), () => (t += 50));
    return { jobs, mapper };
  };

  it('turns a touch sequence into one gesture and ignores hover', () => {
    const { jobs, mapper } = collect();
    mapper.push({ kind: 'mouse', type: 'move', x: 5, y: 5, button: 'none', buttons: 0, clickCount: 0, modifiers: 0 });
    mapper.push({ kind: 'touch', type: 'start', points: [{ x: 100, y: 200, id: 7 }], modifiers: 0 });
    mapper.push({ kind: 'touch', type: 'move', points: [{ x: 100, y: 150, id: 7 }], modifiers: 0 });
    mapper.push({ kind: 'touch', type: 'end', points: [], modifiers: 0 });
    expect(jobs).toHaveLength(1);
    const g = jobs[0];
    expect(g.kind).toBe('gesture');
    if (g.kind !== 'gesture') return;
    expect(g.gesture.points.map((p) => [p.x, p.y])).toEqual([
      [100, 200],
      [100, 150],
      [100, 150],
    ]);
  });

  it('maps left-button mouse drags to touches, other buttons to nothing', () => {
    const { jobs, mapper } = collect();
    mapper.push({ kind: 'mouse', type: 'down', x: 1, y: 1, button: 'right', buttons: 2, clickCount: 1, modifiers: 0 });
    mapper.push({ kind: 'mouse', type: 'up', x: 1, y: 1, button: 'right', buttons: 0, clickCount: 1, modifiers: 0 });
    expect(jobs).toHaveLength(0);
    mapper.push({ kind: 'mouse', type: 'down', x: 10, y: 20, button: 'left', buttons: 1, clickCount: 1, modifiers: 0 });
    mapper.push({ kind: 'mouse', type: 'up', x: 10, y: 20, button: 'left', buttons: 0, clickCount: 1, modifiers: 0 });
    expect(jobs.map((j) => j.kind)).toEqual(['gesture']);
  });

  it('coalesces wheel events into one scroll', async () => {
    vi.useFakeTimers();
    const { jobs, mapper } = collect();
    mapper.push({ kind: 'wheel', x: 50, y: 60, deltaX: 0, deltaY: 40, modifiers: 0 });
    mapper.push({ kind: 'wheel', x: 50, y: 60, deltaX: 0, deltaY: 60, modifiers: 0 });
    expect(jobs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(jobs).toEqual([{ kind: 'scroll', x: 50, y: 60, dx: 0, dy: 100 }]);
  });

  it('builds W3C touch actions: integer, clamped coordinates and long presses kept long', () => {
    const tap = gestureToActions({ points: [{ x: 10.6, y: 20.2, t: 0 }, { x: 10.6, y: 20.2, t: 900 }] }, { width: 402, height: 760 });
    expect(tap).toEqual({
      type: 'pointer',
      id: 'ifdy-finger',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, origin: 'viewport', x: 11, y: 20 },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 900 },
        { type: 'pointerUp', button: 0 },
      ],
    });
    const drag = gestureToActions({ points: [{ x: 100, y: 700, t: 0 }, { x: 100, y: 900, t: 120 }] }, { width: 402, height: 760 });
    expect(drag.actions[2]).toEqual({ type: 'pointerMove', duration: 120, origin: 'viewport', x: 100, y: 759 });
  });

  it('builds key actions with WebDriver code points and modifiers', () => {
    expect(keyToActions('Enter', 0)?.actions).toEqual([
      { type: 'keyDown', value: WEBDRIVER_KEYS.Enter },
      { type: 'keyUp', value: WEBDRIVER_KEYS.Enter },
    ]);
    expect(keyToActions('a', 4)?.actions).toEqual([
      { type: 'keyDown', value: WEBDRIVER_KEYS.Meta },
      { type: 'keyDown', value: 'a' },
      { type: 'keyUp', value: 'a' },
      { type: 'keyUp', value: WEBDRIVER_KEYS.Meta },
    ]);
    // Shift is already part of "A".
    expect(keyToActions('A', 8)?.actions).toHaveLength(2);
    expect(keyToActions('Shift', 8)).toBeNull();
    expect(keyToActions('F13', 0)).toBeNull();
    const chunks = textToActions('x'.repeat(450));
    expect(chunks.map((c) => c.actions.length)).toEqual([400, 400, 100]);
  });

  it('builds idb commands as argument arrays', () => {
    const udid = NEW_UDID;
    const tap: InputJob = { kind: 'gesture', gesture: { points: [{ x: 10, y: 20, t: 0 }, { x: 11, y: 21, t: 100 }] } };
    expect(jobToIdb(tap, udid)).toEqual([['ui', 'tap', '10', '20', '--udid', udid]]);
    const press: InputJob = { kind: 'gesture', gesture: { points: [{ x: 10, y: 20, t: 0 }, { x: 10, y: 20, t: 800 }] } };
    expect(jobToIdb(press, udid)[0]).toEqual(['ui', 'tap', '10', '20', '--duration', '0.80', '--udid', udid]);
    const swipe: InputJob = { kind: 'gesture', gesture: { points: [{ x: 10, y: 400, t: 0 }, { x: 10, y: 100, t: 300 }] } };
    expect(jobToIdb(swipe, udid)[0]).toEqual(['ui', 'swipe', '10', '400', '10', '100', '--duration', '0.30', '--udid', udid]);
    expect(jobToIdb({ kind: 'text', text: '-rf; $(boom)' }, udid)).toEqual([['ui', 'text', '--udid', udid, '--', '-rf; $(boom)']]);
    expect(jobToIdb({ kind: 'key', key: 'Enter', modifiers: 0 }, udid)).toEqual([['ui', 'key', '40', '--udid', udid]]);
  });
});

/* ------------------------------------------------------------------ */
/* Live page                                                           */
/* ------------------------------------------------------------------ */

async function startPage(opts: { driver?: FakeSafariDriver; deps?: Partial<IosDeps>; open?: Partial<OpenMessage> } = {}) {
  const driver = opts.driver ?? new FakeSafariDriver();
  const execs = fakeExec({ idb: false });
  const deps = makeDeps({ exec: execs.exec, fetch: driver.fetch, ...opts.deps });
  const pool = new SimulatorPool(deps, { hookProcessExit: false });
  const h = fakeHost();
  const page = new SimulatorPage('p1', h.host, openMsg(opts.open), pool);
  pages.push(page);
  await page.start();
  return { page, pool, driver, deps, execs, ...h };
}

describe('SimulatorPage over safaridriver', () => {
  it('opens a WebDriver session on the IFDY simulator and loads the page', async () => {
    const { driver, of, page } = await startPage();
    expect(page.mode).toBe('webdriver');
    const create = driver.calls.find((c) => c.path === '/session');
    expect(create?.body).toEqual({
      capabilities: {
        alwaysMatch: expect.objectContaining({
          browserName: 'Safari',
          platformName: 'iOS',
          'safari:useSimulator': true,
          'safari:deviceUDID': NEW_UDID,
          'safari:deviceName': 'iPhone 16 Pro',
          'safari:deviceType': 'iPhone',
          'safari:platformVersion': '18.2',
        }),
      },
    });
    await vi.waitFor(() => expect(of('status').map((s) => s.status)).toEqual(['loading', 'ready']));
    expect(of('status')[1]).toMatchObject({ url: 'http://localhost:5174/demo/index.html', title: 'Demo', httpStatus: 200 });
    // The real, measured viewport, not the profile's.
    await vi.waitFor(() => expect(of('emulated').at(-1)).toMatchObject({ viewport: { width: 402, height: 760, dpr: 3 }, displayFeature: 'none', input: true }));
    expect(of('emulated').at(-1)?.detail).toMatch(/Real Mobile Safari on iPhone 16 Pro \(iOS 18\.2 Simulator\).*Not yet verified on real hardware/);
    expect(of('metrics').at(-1)).toMatchObject({ visual: { width: 402, height: 760, scale: 1 } });
  });

  it('installs the agent and relays envelopes both ways (only for its own session)', async () => {
    const { driver, raw, page } = await startPage();
    await vi.waitFor(() => expect(driver.installs).toHaveLength(1));
    expect(driver.installs[0]).toEqual([{ session: 'sess-1', flags: ['net'] }, expect.any(String)]);
    await vi.waitFor(() => expect(raw).toHaveLength(1));
    expect(JSON.parse(raw[0])).toMatchObject({ t: 'agent', pageId: 'p1', env: { session: 'sess-1', event: 'hello' } });
    const env = { __ifdy: 1, session: 'sess-1', kind: 'request', id: 3, method: 'tree' };
    page.toAgent(env);
    await vi.waitFor(() => expect(driver.delivered).toEqual([env]));
  });

  it('streams viewport screenshots as PNG frames sized in CSS px, skipping unchanged ones', async () => {
    const { frames } = await startPage();
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0));
    const f = frames[0];
    expect(f.image.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(f.header).toMatchObject({ t: 'frame', pageId: 'p1', width: 402, height: 760 });
    await new Promise((r) => setTimeout(r, 400));
    expect(frames).toHaveLength(1);
  });

  it('describes whole-screen screenshots honestly instead of stretching them', async () => {
    const driver = new FakeSafariDriver();
    driver.shot = png(1206, 2622);
    const { frames, of } = await startPage({ driver });
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0));
    await vi.waitFor(() => expect(frames.at(-1)!.header).toMatchObject({ width: 402, height: 874 }));
    expect(of('emulated').at(-1)?.detail).toMatch(/inspection overlays may be offset/);
  });

  it('forwards taps as W3C touch actions and wheel as scrolling', async () => {
    const { driver, page } = await startPage();
    page.input({ kind: 'touch', type: 'start', points: [{ x: 50, y: 60, id: 1 }], modifiers: 0 });
    page.input({ kind: 'touch', type: 'end', points: [], modifiers: 0 });
    await vi.waitFor(() => expect(driver.actions).toHaveLength(1));
    const [seq] = driver.actions[0] as { type: string; parameters: unknown; actions: { type: string }[] }[];
    expect(seq.parameters).toEqual({ pointerType: 'touch' });
    expect(seq.actions.map((a) => a.type)).toEqual(['pointerMove', 'pointerDown', 'pointerUp']);
    page.input({ kind: 'wheel', x: 10, y: 10, deltaX: 0, deltaY: 120, modifiers: 0 });
    await vi.waitFor(() => expect(driver.scrolls).toEqual([[10, 10, 0, 120]]));
    page.input({ kind: 'key', type: 'down', key: 'Enter', code: 'Enter', modifiers: 0 });
    await vi.waitFor(() => expect(driver.actions).toHaveLength(2));
  });

  it('reports rotation as unsupported when safaridriver rejects it', async () => {
    const { of, page } = await startPage();
    page.emulate({ ...openMsg(), device: { width: 874, height: 402, dpr: 3, mobile: true, touch: true, orientation: 'landscape' } });
    await vi.waitFor(() => expect(of('emulated').at(-1)?.detail).toMatch(/cannot rotate the simulator/));
  });

  it('reports a fold as unsupported', async () => {
    const { of } = await startPage({ open: { fold: { axis: 'vertical', offset: 200, maskLength: 0 } } });
    await vi.waitFor(() => expect(of('emulated').at(-1)).toMatchObject({ displayFeature: 'unsupported' }));
  });

  it('refuses forbidden URLs without navigating', async () => {
    const { driver, of, page } = await startPage();
    await vi.waitFor(() => expect(of('status').map((s) => s.status)).toContain('ready'));
    const before = driver.calls.filter((c) => c.path.endsWith('/url') && c.method === 'POST').length;
    await page.navigate('http://localhost:4310/');
    expect(of('status').at(-1)).toMatchObject({ status: 'error', error: expect.stringMatching(/studio itself/) });
    await page.navigate('file:///etc/passwd');
    expect(of('status').at(-1)).toMatchObject({ status: 'error', error: expect.stringMatching(/Only http\(s\)/) });
    expect(driver.calls.filter((c) => c.path.endsWith('/url') && c.method === 'POST')).toHaveLength(before);
  });

  it('turns navigation failures into a friendly error status', async () => {
    const driver = new FakeSafariDriver();
    driver.navError = { error: 'unknown error', message: 'Could not connect to the server. (NSURLErrorDomain -1004)' };
    const { of } = await startPage({ driver });
    await vi.waitFor(() => expect(of('status').at(-1)).toMatchObject({ status: 'error', error: expect.stringMatching(/could not connect to the server/i) }));
  });

  it('reports a lost session as closed and stops polling', async () => {
    const { driver, of } = await startPage();
    await vi.waitFor(() => expect(of('status').map((s) => s.status)).toContain('ready'));
    driver.gone = true;
    await vi.waitFor(() => expect(of('status').at(-1)).toMatchObject({ status: 'closed', error: expect.stringMatching(/automation session/) }));
    const n = driver.calls.length;
    await new Promise((r) => setTimeout(r, 400));
    expect(driver.calls.length).toBe(n);
  });

  it('closes the session, stops safaridriver and releases the simulator', async () => {
    const { driver, deps, page, pool } = await startPage();
    expect(pool.activePages).toBe(1);
    await page.close();
    expect(driver.deleted).toBe(true);
    expect(deps.children[0].killed).toEqual(['SIGTERM']);
    expect(pool.activePages).toBe(0);
  });
});

describe('SimulatorPage simctl fallback', () => {
  it('falls back to mirroring when no session can be created, and says why', async () => {
    const driver = new FakeSafariDriver();
    driver.sessionError = { error: 'session not created', message: 'You must enable "Allow Remote Automation".' };
    const { page, execs, of, frames } = await startPage({ driver });
    expect(page.mode).toBe('simctl');
    expect(simctlCalls(execs.calls, 'openurl')).toEqual([['openurl', NEW_UDID, 'http://localhost:5174/demo/index.html']]);
    const em = of('emulated').at(-1)!;
    expect(em).toMatchObject({ input: false });
    expect(em.detail).toMatch(/whole screen.*safaridriver --enable.*View-only/s);
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0));
    // Device pixels -> points: the whole 1206×2622 screen is 402×874 pt.
    expect(frames[0].header).toMatchObject({ width: 402, height: 874 });
    expect(simctlCalls(execs.calls, 'io')[0]).toEqual(['io', NEW_UDID, 'screenshot', '--type=jpeg', expect.stringMatching(/^\/tmp\/ifdy-ios-/)]);
    await vi.waitFor(() => expect(of('status').map((s) => s.status)).toEqual(['loading', 'ready']), { timeout: 3000 });
    // View-only: input is dropped, agent messages are ignored.
    page.input({ kind: 'touch', type: 'start', points: [{ x: 1, y: 1, id: 1 }], modifiers: 0 });
    page.input({ kind: 'touch', type: 'end', points: [], modifiers: 0 });
    page.toAgent({});
    await new Promise((r) => setTimeout(r, 50));
    expect(execs.calls.filter((c) => c.file === 'idb' && c.args[0] === 'ui')).toHaveLength(0);
  });

  it('uses idb for input when it is installed', async () => {
    const execs = fakeExec({ idb: true });
    const driver = new FakeSafariDriver();
    const deps = makeDeps({ exec: execs.exec, fetch: driver.fetch, fileExists: async () => false });
    const pool = new SimulatorPool(deps, { hookProcessExit: false });
    const h = fakeHost();
    const page = new SimulatorPage('p1', h.host, openMsg(), pool);
    pages.push(page);
    await page.start();
    expect(page.mode).toBe('simctl');
    expect(h.of('emulated').at(-1)).toMatchObject({ input: true });
    page.input({ kind: 'touch', type: 'start', points: [{ x: 30, y: 40, id: 1 }], modifiers: 0 });
    page.input({ kind: 'touch', type: 'end', points: [], modifiers: 0 });
    await vi.waitFor(() => expect(execs.calls.filter((c) => c.file === 'idb' && c.args[0] === 'ui')).toEqual([{ file: 'idb', args: ['ui', 'tap', '30', '40', '--udid', NEW_UDID] }]));
  });

  it('fails to start with the reason when the simulator cannot boot', async () => {
    const driver = new FakeSafariDriver();
    const deps = makeDeps({ exec: fakeExec({ failBoot: true }).exec, fetch: driver.fetch });
    const pool = new SimulatorPool(deps, { hookProcessExit: false });
    const page = new SimulatorPage('p1', fakeHost().host, openMsg(), pool);
    pages.push(page);
    await expect(page.start()).rejects.toThrow(/bootstatus did not finish/);
    await page.close();
    expect(pool.activePages).toBe(0);
  });

  it('refuses to start where the engine is unavailable', async () => {
    const pool = new SimulatorPool(makeDeps({ platform: 'win32' }), { hookProcessExit: false });
    const page = new SimulatorPage('p1', fakeHost().host, openMsg(), pool);
    pages.push(page);
    await expect(page.start()).rejects.toThrow(/Mac with Xcode/);
  });
});
