import type { EngineInfo, RemoteDevice } from '../../src/modules/preview-runtime/remote/protocol';
import type { ChildLike, IosDeps } from './deps';
import { bootDevice, chooseDeviceType, createDevice, findIfdyDevice, iosRuntimes, listInventory, shutdownDevice, type SimInventory } from './simctl';

export const DOCS_HINT = 'see docs/IOS_SIMULATOR.md';
const STATUS_TTL = 5 * 60_000;
/** IFDY-booted simulators are shut down after this long without a page. */
export const IDLE_SHUTDOWN_MS = 3 * 60_000;

export type IosProbe = {
  available: boolean;
  /** e.g. "iOS 18.2" (newest installed runtime). */
  runtimeName?: string;
  safaridriver: boolean;
  idb: boolean;
  detail: string;
};

export type DeviceLease = {
  pageId: string;
  udid: string;
  /** Device name as simctl shows it (e.g. "IFDY iPhone 16 Pro"). */
  name: string;
  deviceType: string;
  family: 'iPhone' | 'iPad';
  runtimeName: string;
  runtimeVersion: string;
  /** Not the device type the profile asked for. */
  substitute: string | null;
  /** IFDY booted this device in this process (so IFDY shuts it down when idle). */
  bootedByIfdy: boolean;
};

/**
 * Owns every simulator the companion uses: at most one live page per simulator
 * (Mobile Safari shows one foreground tab), a hard cap on concurrent iOS pages,
 * lazy boot, and shutdown of only the simulators IFDY itself booted — when idle,
 * and on companion exit. User devices are never created, modified or deleted:
 * IFDY boots its own "IFDY <model>" simulators.
 */
export class SimulatorPool {
  readonly maxPages: number;
  private leases = new Map<string, DeviceLease>();
  private booted = new Set<string>();
  private idle = new Map<string, ReturnType<typeof setTimeout>>();
  private drivers = new Set<ChildLike>();
  private probe: { at: number; value: Promise<IosProbe> } | null = null;
  private lock: Promise<unknown> = Promise.resolve();
  private exitHooked = false;

  constructor(
    readonly deps: IosDeps,
    opts: { maxPages?: number; hookProcessExit?: boolean } = {},
  ) {
    // Tests create many pools; only the companion's own pool registers an exit hook.
    this.exitHooked = opts.hookProcessExit === false;
    this.maxPages = Math.max(1, Math.min(6, opts.maxPages ?? (Number(process.env.IFDY_IOS_MAX_PAGES) || 3)));
  }

  /* ------------------------------------------------------------------ */
  /* Status                                                              */
  /* ------------------------------------------------------------------ */

  status(force = false): Promise<IosProbe> {
    const now = Date.now();
    if (!force && this.probe && now - this.probe.at < STATUS_TTL) return this.probe.value;
    const value = this.runProbe();
    this.probe = { at: now, value };
    return value;
  }

  /** Forget the cached probe (e.g. after a failure that suggests the setup changed). */
  invalidate() {
    this.probe = null;
  }

  private async runProbe(): Promise<IosProbe> {
    const { deps } = this;
    if (deps.platform !== 'darwin') {
      return { available: false, safaridriver: false, idb: false, detail: `Needs the IFDY companion running on a Mac with Xcode; ${DOCS_HINT}.` };
    }
    let inv: SimInventory;
    try {
      inv = await listInventory(deps);
    } catch (err) {
      return {
        available: false,
        safaridriver: false,
        idb: false,
        detail: `Xcode's simctl did not respond (${(err as Error).message}). Install Xcode and run "sudo xcode-select -s /Applications/Xcode.app"; ${DOCS_HINT}.`,
      };
    }
    const runtimes = iosRuntimes(inv);
    if (!runtimes.length) {
      return { available: false, safaridriver: false, idb: false, detail: `No iOS Simulator runtime is installed. Add one in Xcode › Settings › Components; ${DOCS_HINT}.` };
    }
    const [safaridriver, idb] = await Promise.all([
      deps.fileExists(deps.safaridriverPath),
      deps.exec('idb', ['--help'], { timeoutMs: 8000 }).then(
        () => true,
        () => false,
      ),
    ]);
    const detail = safaridriver
      ? 'Real Mobile Safari driven by safaridriver (needs "safaridriver --enable" once). Built and unit-tested without a Mac: not yet verified on real hardware.'
      : `safaridriver was not found, so IFDY mirrors the whole simulator screen through simctl (no inspection${idb ? '; input through idb' : '; view-only, install idb for input'}). Not yet verified on real hardware.`;
    return { available: true, runtimeName: runtimes[0].name, safaridriver, idb, detail };
  }

  /* ------------------------------------------------------------------ */
  /* Leases                                                              */
  /* ------------------------------------------------------------------ */

  get activePages() {
    return this.leases.size;
  }

  /** Reserve (create / boot as needed) the simulator for a page. Serialized: boots never race. */
  acquire(pageId: string, deviceId: string | undefined, device: Pick<RemoteDevice, 'width' | 'height'>): Promise<DeviceLease> {
    const run = this.lock.then(() => this.acquireLocked(pageId, deviceId, device));
    this.lock = run.catch(() => {});
    return run;
  }

  private async acquireLocked(pageId: string, deviceId: string | undefined, device: Pick<RemoteDevice, 'width' | 'height'>): Promise<DeviceLease> {
    if (this.leases.size >= this.maxPages) {
      throw new Error(`At most ${this.maxPages} iOS Simulator boards can be live at once (each one runs a whole simulator). Switch another board back to Chromium first.`);
    }
    const inv = await listInventory(this.deps);
    const choice = chooseDeviceType(inv, deviceId, device);
    if (!choice) throw new Error(`No iOS Simulator device type matches this board and no iPhone/iPad simulator is installed; ${DOCS_HINT}.`);
    const busy = [...this.leases.values()].find((l) => l.deviceType === choice.deviceType.name && l.runtimeVersion === choice.runtime.version);
    if (busy) {
      throw new Error(`Another board is already showing the ${choice.deviceType.name} simulator. Mobile Safari can only show one page at a time per simulator, so use a different device for this board.`);
    }
    let dev = findIfdyDevice(inv, choice);
    let udid = dev?.udid ?? '';
    if (!udid) udid = await createDevice(this.deps, choice);
    const alreadyRunning = dev?.state === 'Booted' && !this.booted.has(udid);
    const timer = this.idle.get(udid);
    if (timer) {
      clearTimeout(timer);
      this.idle.delete(udid);
    }
    if (!alreadyRunning && !this.booted.has(udid)) {
      await bootDevice(this.deps, udid);
      this.booted.add(udid);
      this.hookExit();
    } else if (this.booted.has(udid)) {
      // Ours and possibly mid-shutdown or shut down by the user meanwhile: make sure it is up.
      await bootDevice(this.deps, udid);
    }
    dev = dev ?? { udid, name: `IFDY ${choice.deviceType.name}`, state: 'Booted', isAvailable: true, runtime: choice.runtime.identifier };
    const lease: DeviceLease = {
      pageId,
      udid,
      name: dev.name,
      deviceType: choice.deviceType.name,
      family: choice.family,
      runtimeName: choice.runtime.name,
      runtimeVersion: choice.runtime.version,
      substitute: choice.substitute ? choice.wanted : null,
      bootedByIfdy: this.booted.has(udid),
    };
    this.leases.set(pageId, lease);
    return lease;
  }

  release(lease: DeviceLease) {
    if (this.leases.get(lease.pageId) !== lease) return;
    this.leases.delete(lease.pageId);
    if (!this.booted.has(lease.udid)) return;
    if ([...this.leases.values()].some((l) => l.udid === lease.udid)) return;
    const timer = setTimeout(() => {
      this.idle.delete(lease.udid);
      if ([...this.leases.values()].some((l) => l.udid === lease.udid)) return;
      this.booted.delete(lease.udid);
      void shutdownDevice(this.deps, lease.udid).catch(() => {});
    }, IDLE_SHUTDOWN_MS);
    timer.unref?.();
    this.idle.set(lease.udid, timer);
  }

  /** Simulators IFDY booted and has not shut down yet (for tests and status). */
  bootedByIfdy(): string[] {
    return [...this.booted];
  }

  trackDriver(child: ChildLike) {
    this.drivers.add(child);
    child.once('exit', () => this.drivers.delete(child));
    this.hookExit();
  }

  /**
   * Shut down every simulator IFDY booted (never ones that were already running) and
   * stop safaridriver processes. Detached so it completes after the companion exits.
   */
  shutdownAll() {
    for (const t of this.idle.values()) clearTimeout(t);
    this.idle.clear();
    for (const d of this.drivers) d.kill('SIGTERM');
    this.drivers.clear();
    for (const udid of this.booted) this.deps.spawnDetached('xcrun', ['simctl', 'shutdown', udid]);
    this.booted.clear();
  }

  private hookExit() {
    if (this.exitHooked) return;
    this.exitHooked = true;
    process.once('exit', () => this.shutdownAll());
  }
}

/** Engine info for the studio's engine picker. */
export function engineInfo(p: IosProbe): EngineInfo {
  return {
    id: 'ios-simulator',
    available: p.available,
    label: p.runtimeName ? `Safari · ${p.runtimeName} Simulator` : 'Safari (iOS Simulator)',
    detail: p.detail,
    features: {
      inspect: p.available && p.safaridriver,
      input: p.available && (p.safaridriver || p.idb),
      touch: p.available && (p.safaridriver || p.idb),
      foldEmulation: false,
      rotate: false,
    },
  };
}
