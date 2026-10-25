import type { ChildLike, FetchLike, IosDeps } from './deps';
import { sleep } from './deps';

/**
 * Minimal W3C WebDriver client for safaridriver (only the commands IFDY uses).
 * Every request has a timeout; errors carry the W3C error code.
 */

export class WebDriverError extends Error {
  constructor(
    /** W3C error code ("invalid session id", "unexpected alert open", …) or "timeout" / "connection". */
    readonly error: string,
    message: string,
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export type W3CActionSource = {
  type: 'pointer' | 'key' | 'none';
  id: string;
  parameters?: { pointerType: 'touch' | 'mouse' | 'pen' };
  actions: Record<string, unknown>[];
};

export const DEFAULT_COMMAND_TIMEOUT = 30_000;
export const SESSION_TIMEOUT = 180_000;

export class WebDriverClient {
  sessionId: string | null = null;

  constructor(
    readonly base: string,
    private readonly fetchImpl: FetchLike,
  ) {}

  async command<T = unknown>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, timeoutMs = DEFAULT_COMMAND_TIMEOUT): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let status: number;
    let text: string;
    try {
      const res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json; charset=utf-8' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      status = res.status;
      text = await res.text();
    } catch (err) {
      if (ctrl.signal.aborted) throw new WebDriverError('timeout', `safaridriver did not answer ${method} ${shortPath(path)} within ${Math.round(timeoutMs / 1000)}s.`);
      throw new WebDriverError('connection', `Lost the connection to safaridriver (${(err as Error).message}).`);
    } finally {
      clearTimeout(timer);
    }
    let json: { value?: unknown } = {};
    try {
      json = text ? (JSON.parse(text) as { value?: unknown }) : {};
    } catch {
      throw new WebDriverError('unknown error', `safaridriver returned a non-JSON response (HTTP ${status}).`);
    }
    const value = json.value as { error?: unknown; message?: unknown; data?: unknown } | undefined;
    if (status >= 400 || (value && typeof value === 'object' && typeof value.error === 'string')) {
      const code = value && typeof value.error === 'string' ? value.error : `http ${status}`;
      const message = value && typeof value.message === 'string' && value.message ? value.message : code;
      throw new WebDriverError(code, message, value && typeof value.data === 'object' ? (value.data as Record<string, unknown>) : undefined);
    }
    return json.value as T;
  }

  private s(path: string) {
    if (!this.sessionId) throw new WebDriverError('invalid session id', 'No WebDriver session.');
    return `/session/${this.sessionId}${path}`;
  }

  async status(timeoutMs = 3000) {
    return this.command<{ ready?: boolean; message?: string }>('GET', '/status', undefined, timeoutMs);
  }

  async newSession(alwaysMatch: Record<string, unknown>, timeoutMs = SESSION_TIMEOUT) {
    const v = await this.command<{ sessionId?: string; capabilities?: Record<string, unknown> }>('POST', '/session', { capabilities: { alwaysMatch } }, timeoutMs);
    if (!v || typeof v.sessionId !== 'string') throw new WebDriverError('session not created', 'safaridriver did not return a session id.');
    this.sessionId = v.sessionId;
    return v.capabilities ?? {};
  }

  async deleteSession(timeoutMs = 10_000) {
    if (!this.sessionId) return;
    const path = this.s('');
    this.sessionId = null;
    await this.command('DELETE', path, undefined, timeoutMs);
  }

  setTimeouts(t: { script?: number; pageLoad?: number; implicit?: number }) {
    return this.command('POST', this.s('/timeouts'), t);
  }
  navigateTo(url: string, timeoutMs = 60_000) {
    return this.command('POST', this.s('/url'), { url }, timeoutMs);
  }
  getUrl() {
    return this.command<string>('GET', this.s('/url'));
  }
  back(timeoutMs = 30_000) {
    return this.command('POST', this.s('/back'), {}, timeoutMs);
  }
  forward(timeoutMs = 30_000) {
    return this.command('POST', this.s('/forward'), {}, timeoutMs);
  }
  refresh(timeoutMs = 60_000) {
    return this.command('POST', this.s('/refresh'), {}, timeoutMs);
  }
  /** Base64 PNG of the current viewport. */
  screenshot(timeoutMs = 15_000) {
    return this.command<string>('GET', this.s('/screenshot'), undefined, timeoutMs);
  }
  execute<T = unknown>(script: string, args: unknown[] = [], timeoutMs = DEFAULT_COMMAND_TIMEOUT) {
    return this.command<T>('POST', this.s('/execute/sync'), { script, args }, timeoutMs);
  }
  performActions(actions: W3CActionSource[], timeoutMs = 20_000) {
    return this.command('POST', this.s('/actions'), { actions }, timeoutMs);
  }
  releaseActions() {
    return this.command('DELETE', this.s('/actions'));
  }
  alertText() {
    return this.command<string | null>('GET', this.s('/alert/text'), undefined, 5000);
  }
  dismissAlert() {
    return this.command('POST', this.s('/alert/dismiss'), {}, 5000);
  }
  windowHandle() {
    return this.command<string>('GET', this.s('/window'), undefined, 5000);
  }
  windowHandles() {
    return this.command<string[]>('GET', this.s('/window/handles'), undefined, 5000);
  }
  switchToWindow(handle: string) {
    return this.command('POST', this.s('/window'), { handle }, 5000);
  }
  closeWindow() {
    return this.command('DELETE', this.s('/window'), undefined, 5000);
  }
  /**
   * Not part of W3C WebDriver (a JSON Wire / Appium extension). safaridriver may not
   * implement it; callers treat "unknown command" as "rotation unsupported".
   */
  setOrientation(orientation: 'PORTRAIT' | 'LANDSCAPE') {
    return this.command('POST', this.s('/orientation'), { orientation }, 10_000);
  }
}

const shortPath = (p: string) => p.replace(/\/session\/[^/]+/, '/session/…');

/** WebDriver error codes that mean the session (Safari or the simulator) is gone. */
export const isSessionGone = (err: unknown) =>
  err instanceof WebDriverError && (err.error === 'invalid session id' || err.error === 'connection' || err.error === 'no such window');

/**
 * Capabilities for Mobile Safari in a specific simulator (Apple: "About WebDriver
 * for Safari" / `man safaridriver`). `unhandledPromptBehavior` keeps JavaScript
 * dialogs from wedging the session.
 */
export function simulatorCapabilities(lease: { udid: string; deviceType: string; family: 'iPhone' | 'iPad'; runtimeVersion: string }) {
  return {
    browserName: 'Safari',
    platformName: 'iOS',
    'safari:useSimulator': true,
    'safari:deviceUDID': lease.udid,
    'safari:deviceType': lease.family,
    'safari:deviceName': lease.deviceType,
    'safari:platformVersion': lease.runtimeVersion,
    unhandledPromptBehavior: 'dismiss and notify',
  };
}

/** Turn safaridriver / Safari errors into something a designer can act on. */
export function friendlyDriverError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/remote automation|allow remote|--enable/i.test(raw)) {
    return 'Safari remote automation is turned off. Run "safaridriver --enable" once on this Mac, and in the simulator turn on Settings › Safari › Advanced › Remote Automation.';
  }
  if (err instanceof WebDriverError && err.error === 'timeout') return raw;
  if (err instanceof WebDriverError && err.error === 'connection') return 'safaridriver stopped responding (it may have crashed or been closed).';
  if (/already (has|have) an active session|another session/i.test(raw)) return 'Safari in this simulator is already being automated by another WebDriver session.';
  return raw.split('\n')[0].slice(0, 300);
}

/** A running safaridriver bound to a free local port. */
export type DriverHandle = { url: string; child: ChildLike; stop(): void };

export async function launchSafariDriver(deps: IosDeps, timeoutMs = 15_000): Promise<DriverHandle> {
  const port = await deps.freePort();
  const child = deps.spawn(deps.safaridriverPath, ['--port', String(port)]);
  const url = `http://127.0.0.1:${port}`;
  const stop = () => {
    if (child.exitCode === null) child.kill('SIGTERM');
  };
  const client = new WebDriverClient(url, deps.fetch);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`safaridriver exited (code ${child.exitCode})${child.stderrTail() ? `: ${child.stderrTail()}` : ''}.`);
    }
    try {
      const st = await client.status(1500);
      // `ready: false` means the driver is up but busy with a session; ours is fresh, so up is enough.
      if (st) return { url, child, stop };
    } catch {
      /* not listening yet */
    }
    await sleep(150);
  }
  stop();
  throw new Error(`safaridriver did not start within ${Math.round(timeoutMs / 1000)}s.`);
}
