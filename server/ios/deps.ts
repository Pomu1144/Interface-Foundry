import { execFile, spawn } from 'node:child_process';
import { access, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';

/**
 * Everything the iOS Simulator engine needs from the outside world (child
 * processes, HTTP, files, clock), behind one injectable object so the engine
 * can be unit-tested on machines without macOS or Xcode.
 */

export type ExecOptions = { timeoutMs?: number; maxBuffer?: number };
export type ExecResult = { stdout: string; stderr: string };
/** Runs a program with an argument array (never through a shell). */
export type ExecFn = (file: string, args: string[], opts?: ExecOptions) => Promise<ExecResult>;

/** The subset of `fetch` the WebDriver client uses. */
export type FetchLike = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

/** A long-running child process (safaridriver). */
export type ChildLike = {
  readonly exitCode: number | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', fn: (code: number | null) => void): unknown;
  /** Last lines the process wrote to stderr (for error messages). */
  stderrTail(): string;
};

export type IosDeps = {
  platform: NodeJS.Platform;
  exec: ExecFn;
  fetch: FetchLike;
  spawn: (file: string, args: string[]) => ChildLike;
  /** Fire-and-forget process that must outlive the companion (shutdown on exit). */
  spawnDetached: (file: string, args: string[]) => void;
  freePort: () => Promise<number>;
  fileExists: (p: string) => Promise<boolean>;
  readFile: (p: string) => Promise<Buffer>;
  removeFile: (p: string) => Promise<void>;
  tmpDir: () => string;
  safaridriverPath: string;
};

export class ExecError extends Error {
  constructor(
    message: string,
    readonly file: string,
    readonly stderr: string,
    readonly timedOut: boolean,
    readonly notFound: boolean,
  ) {
    super(message);
  }
}

export const defaultExec: ExecFn = (file, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const timeout = opts.timeoutMs ?? 30_000;
    execFile(
      file,
      args,
      { timeout, maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024, windowsHide: true, encoding: 'utf8', killSignal: 'SIGKILL' },
      (err, stdout, stderr) => {
        if (!err) return resolve({ stdout, stderr });
        const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
        const notFound = e.code === 'ENOENT';
        const timedOut = Boolean(e.killed) && !notFound;
        const tail = String(stderr || '').trim().split('\n').slice(-3).join(' ').slice(0, 400);
        const what = [file, ...args.slice(0, 2)].join(' ');
        const message = notFound
          ? `${file} was not found on this machine.`
          : timedOut
            ? `${what} did not finish within ${Math.round(timeout / 1000)}s.`
            : `${what} failed${tail ? `: ${tail}` : ` (${e.message.split('\n')[0]})`}`;
        reject(new ExecError(message, file, String(stderr || ''), timedOut, notFound));
      },
    );
  });

function defaultSpawn(file: string, args: string[]): ChildLike {
  const child = spawn(file, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let tail = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (d: string) => {
    tail = (tail + d).slice(-2000);
  });
  // A missing binary emits 'error' (ENOENT); surface it as an exit instead of crashing the companion.
  child.on('error', (err) => {
    tail = `${tail}\n${err.message}`;
  });
  return {
    get exitCode() {
      return child.exitCode;
    },
    kill: (signal) => child.kill(signal),
    once: (event, fn) => child.once(event, fn),
    stderrTail: () => tail.trim().split('\n').slice(-4).join(' ').slice(0, 500),
  };
}

function defaultSpawnDetached(file: string, args: string[]) {
  try {
    const child = spawn(file, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* best effort during exit */
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('No free port'))));
    });
  });
}

export function defaultIosDeps(): IosDeps {
  return {
    platform: process.platform,
    exec: defaultExec,
    fetch: (url, init) => fetch(url, init),
    spawn: defaultSpawn,
    spawnDetached: defaultSpawnDetached,
    freePort,
    fileExists: (p) => access(p).then(
      () => true,
      () => false,
    ),
    readFile: (p) => readFile(p),
    removeFile: (p) => rm(p, { force: true }),
    tmpDir: () => tmpdir(),
    safaridriverPath: process.env.IFDY_SAFARIDRIVER || '/usr/bin/safaridriver',
  };
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
