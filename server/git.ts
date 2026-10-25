import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './http';
import { cleanRelative, isInside, resolveInside } from './fs';

/**
 * Minimal git integration for authorised local roots.
 *
 *  - `git` is spawned with `execFile` (no shell), `cwd` = the allowed root, and
 *    every user-supplied value is either validated (branch names via
 *    `git check-ref-format`) or passed after `--` (paths).
 *  - Reads disable fsmonitor/pager; nothing ever prompts for credentials.
 *  - Writes (create/switch branch, apply patch, commit) are only reachable
 *    through the two-step approval flow in routes/git.ts. Push and pull
 *    requests are never performed — the UI shows the commands instead.
 */

export type GitRun = { code: number; stdout: string; stderr: string };

const READ_FLAGS = ['-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', '-c', 'color.ui=false', '-c', 'core.quotepath=false'];

export function git(cwd: string, args: string[], opts: { input?: string; timeoutMs?: number; maxBuffer?: number; write?: boolean } = {}): Promise<GitRun> {
  return new Promise((resolve) => {
    const child = execFile(
      'git',
      [...READ_FLAGS, ...args],
      {
        cwd,
        timeout: opts.timeoutMs ?? 20_000,
        maxBuffer: opts.maxBuffer ?? 8 * 1024 * 1024,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: '',
          SSH_ASKPASS: '',
          GIT_PAGER: 'cat',
          PAGER: 'cat',
          LC_ALL: 'C',
          ...(opts.write ? {} : { GIT_OPTIONAL_LOCKS: '0' }),
        },
      },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null;
        if (e && e.code === 'ENOENT') return resolve({ code: 127, stdout: '', stderr: 'git is not installed or not on PATH' });
        resolve({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
      },
    );
    if (opts.input !== undefined) child.stdin?.end(opts.input);
    else child.stdin?.end();
  });
}

function fail(r: GitRun, what: string, status = 409): never {
  const msg = (r.stderr || r.stdout).trim().split('\n').slice(0, 6).join('\n');
  throw new HttpError(status, `${what}: ${msg || `git exited with ${r.code}`}`);
}

export type RepoInfo = {
  available: boolean;
  repo: boolean;
  topLevel: string | null;
  /** Writes are allowed only when the whole repository lives inside the allowed root. */
  writable: boolean;
  reason?: string;
};

export async function repoInfo(root: string): Promise<RepoInfo> {
  const v = await git(root, ['--version']);
  if (v.code === 127) return { available: false, repo: false, topLevel: null, writable: false, reason: 'git is not installed on this machine' };
  const r = await git(root, ['rev-parse', '--show-toplevel']);
  if (r.code !== 0) return { available: true, repo: false, topLevel: null, writable: false, reason: 'This directory is not a git repository' };
  const top = r.stdout.trim();
  const [topReal, rootReal] = await Promise.all([realpath(top).catch(() => top), realpath(root).catch(() => root)]);
  const writable = isInside(rootReal, topReal);
  return {
    available: true,
    repo: true,
    topLevel: topReal,
    writable,
    reason: writable ? undefined : `The repository (${topReal}) extends beyond the allowed root; git writes are disabled. Allow the repository root instead.`,
  };
}

export type GitFile = { path: string; from?: string; x: string; y: string; staged: boolean; unstaged: boolean; untracked: boolean; conflicted: boolean };

export type GitStatus = {
  branch: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  head: { sha: string; subject: string } | null;
  files: GitFile[];
};

/** `git status --porcelain=v1 -b -z` parser (exported for tests). */
export function parseStatus(out: string): Omit<GitStatus, 'head'> {
  const parts = out.split('\0');
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  let detached = false;
  const files: GitFile[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    if (p.startsWith('## ')) {
      const head = p.slice(3);
      if (head.startsWith('HEAD (no branch)')) detached = true;
      else {
        const m = /^(?:No commits yet on |Initial commit on )?([^.\s]+(?:\.(?!\.\.)[^.\s]+)*)(?:\.\.\.(\S+))?(?: \[(.*)\])?/.exec(head);
        if (m) {
          branch = m[1];
          upstream = m[2] ?? null;
          const a = /ahead (\d+)/.exec(m[3] ?? '');
          const b = /behind (\d+)/.exec(m[3] ?? '');
          ahead = a ? Number(a[1]) : 0;
          behind = b ? Number(b[1]) : 0;
        }
      }
      continue;
    }
    const x = p[0];
    const y = p[1];
    const file = p.slice(3);
    const f: GitFile = {
      path: file,
      x,
      y,
      staged: x !== ' ' && x !== '?' && x !== '!',
      unstaged: y !== ' ' && y !== '?',
      untracked: x === '?',
      conflicted: x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D'),
    };
    if (x === 'R' || x === 'C') {
      f.from = parts[i + 1];
      i++;
    }
    files.push(f);
  }
  return { branch, detached, upstream, ahead, behind, files };
}

export async function status(root: string): Promise<GitStatus> {
  const r = await git(root, ['status', '--porcelain=v1', '-b', '-z', '--untracked-files=all', '--', '.']);
  if (r.code !== 0) fail(r, 'git status failed', 500);
  const parsed = parseStatus(r.stdout);
  const log = await git(root, ['log', '-1', '--format=%H%x00%s']);
  const [sha, subject] = log.code === 0 ? log.stdout.trim().split('\0') : [];
  return { ...parsed, head: sha ? { sha, subject: subject ?? '' } : null };
}

export async function branches(root: string): Promise<{ name: string; sha: string; current: boolean; upstream: string | null }[]> {
  const r = await git(root, ['for-each-ref', '--format=%(refname:short)%00%(objectname:short)%00%(HEAD)%00%(upstream:short)', 'refs/heads']);
  if (r.code !== 0) return [];
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [name, sha, head, upstream] = l.split('\0');
      return { name, sha, current: head === '*', upstream: upstream || null };
    });
}

const MAX_DIFF = 1_500_000;

export async function diff(root: string, opts: { staged?: boolean; path?: string } = {}): Promise<{ diff: string; truncated: boolean }> {
  const spec = opts.path ? cleanRelative(opts.path) : '.';
  const args = ['diff', '--no-ext-diff', '--no-textconv', '-M'];
  if (opts.staged) args.push('--cached');
  else args.push('HEAD');
  const r = await git(root, [...args, '--', spec], { maxBuffer: MAX_DIFF * 2 });
  let out = r.stdout;
  if (r.code !== 0) {
    // No commits yet: diff against the empty tree.
    const empty = await git(root, ['diff', '--no-ext-diff', opts.staged ? '--cached' : '', '--', spec].filter(Boolean));
    out = empty.stdout;
  }
  // Untracked files are not part of `git diff`; add them as new-file diffs.
  if (!opts.staged) {
    const st = await git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', spec]);
    const untracked = st.stdout.split('\0').filter(Boolean).slice(0, 40);
    for (const f of untracked) {
      const d = await git(root, ['diff', '--no-index', '--no-ext-diff', '--', '/dev/null', f]);
      if (d.stdout) out += d.stdout.replace(/^diff --git a\/dev\/null b\//m, `diff --git a/${f} b/`);
      if (out.length > MAX_DIFF) break;
    }
  }
  const truncated = out.length > MAX_DIFF;
  return { diff: truncated ? out.slice(0, MAX_DIFF) : out, truncated };
}

export async function validBranchName(root: string, name: string): Promise<boolean> {
  if (typeof name !== 'string' || !name || name.length > 200 || name.startsWith('-')) return false;
  const r = await git(root, ['check-ref-format', '--branch', name]);
  return r.code === 0;
}

export async function gitIdentity(root: string): Promise<{ name: string | null; email: string | null }> {
  const [n, e] = await Promise.all([git(root, ['config', 'user.name']), git(root, ['config', 'user.email'])]);
  return { name: n.stdout.trim() || null, email: e.stdout.trim() || null };
}

/* ------------------------------------------------------------------ */
/* Write operations (called only with an approved payload)             */
/* ------------------------------------------------------------------ */

export type GitOp =
  | { action: 'branch.create'; name: string }
  | { action: 'branch.switch'; name: string }
  | { action: 'apply'; patch: string }
  | { action: 'commit'; message: string; paths: string[] };

export type GitOpSummary = {
  action: GitOp['action'];
  title: string;
  lines: string[];
  files?: { path: string; additions: number | null; deletions: number | null; status?: string }[];
  warnings: string[];
  command: string;
};

async function numstat(root: string, args: string[], input?: string) {
  const r = await git(root, args, { input });
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [a, d, ...rest] = l.split('\t');
      return { path: rest.join('\t'), additions: a === '-' ? null : Number(a), deletions: d === '-' ? null : Number(d) };
    });
}

/** Validate an operation and describe exactly what it will do. */
export async function prepareOp(root: string, op: GitOp): Promise<{ op: GitOp; summary: GitOpSummary }> {
  const info = await repoInfo(root);
  if (!info.repo) throw new HttpError(409, info.reason ?? 'Not a git repository');
  if (!info.writable) throw new HttpError(403, info.reason ?? 'git writes are not allowed here');
  const st = await status(root);
  const warnings: string[] = [];
  switch (op.action) {
    case 'branch.create': {
      const name = String(op.name ?? '').trim();
      if (!(await validBranchName(root, name))) throw new HttpError(400, `“${name}” is not a valid branch name`);
      const all = await branches(root);
      if (all.some((b) => b.name === name)) throw new HttpError(409, `Branch ${name} already exists`);
      if (st.files.length) warnings.push(`${st.files.length} uncommitted change(s) stay in the working tree and move to the new branch.`);
      return {
        op: { action: 'branch.create', name },
        summary: { action: op.action, title: `Create branch ${name}`, lines: [`From ${st.branch ?? 'detached HEAD'}${st.head ? ` @ ${st.head.sha.slice(0, 8)}` : ''}`, `Then switch to ${name}`], warnings, command: `git switch -c ${name}` },
      };
    }
    case 'branch.switch': {
      const name = String(op.name ?? '').trim();
      if (!(await validBranchName(root, name))) throw new HttpError(400, `“${name}” is not a valid branch name`);
      const all = await branches(root);
      if (!all.some((b) => b.name === name)) throw new HttpError(404, `Branch ${name} does not exist`);
      if (st.files.length) warnings.push(`${st.files.length} uncommitted change(s) will be carried over; git refuses the switch if they conflict with ${name}.`);
      return { op: { action: 'branch.switch', name }, summary: { action: op.action, title: `Switch to ${name}`, lines: [`Current branch: ${st.branch ?? 'detached HEAD'}`], warnings, command: `git switch ${name}` } };
    }
    case 'apply': {
      const patch = String(op.patch ?? '');
      if (!patch.trim()) throw new HttpError(400, 'The patch is empty');
      if (patch.length > 4 * 1024 * 1024) throw new HttpError(413, 'The patch is too large');
      // Every file touched by the patch must stay inside the root.
      for (const m of patch.matchAll(/^(?:\+\+\+|---) (?:[ab]\/)?(.+)$/gm)) {
        const p = m[1].trim();
        if (p === '/dev/null') continue;
        await resolveInside(root, p);
      }
      const check = await git(root, ['apply', '--check', '--whitespace=nowarn', '-'], { input: patch });
      if (check.code !== 0) fail(check, 'The patch does not apply cleanly (git apply --check)');
      const files = await numstat(root, ['apply', '--numstat', '-'], patch);
      return {
        op: { action: 'apply', patch },
        summary: { action: op.action, title: `Apply patch to ${files.length} file(s)`, lines: ['git apply --check passed', 'Changes go to the working tree only (nothing is staged or committed).'], files, warnings, command: 'git apply ifdy-changes.patch' },
      };
    }
    case 'commit': {
      const message = String(op.message ?? '').trim();
      if (!message) throw new HttpError(400, 'A commit message is required');
      if (message.length > 10_000) throw new HttpError(400, 'Commit message is too long');
      const changed = new Map(st.files.map((f) => [f.path, f]));
      const requested = Array.isArray(op.paths) && op.paths.length ? op.paths.map((p) => cleanRelative(String(p))) : [...changed.keys()];
      const paths = requested.filter((p) => changed.has(p));
      if (!paths.length) throw new HttpError(409, 'Nothing to commit — the working tree has no changes for the selected files');
      // Names are validated by cleanRelative; resolveInside also rejects symlink escapes (deleted files resolve via their parent).
      for (const p of paths) await resolveInside(root, p);
      const conflicted = paths.filter((p) => changed.get(p)?.conflicted);
      if (conflicted.length) throw new HttpError(409, `Resolve merge conflicts first: ${conflicted.join(', ')}`);
      const id = await gitIdentity(root);
      if (!id.name || !id.email) warnings.push('git user.name / user.email are not configured for this repository; git will refuse to commit until they are set.');
      warnings.push('Repository hooks (pre-commit, commit-msg) run as part of the commit.');
      const tracked = paths.filter((p) => !changed.get(p)?.untracked);
      const stats = tracked.length ? await numstat(root, ['diff', '--numstat', 'HEAD', '--', ...tracked]) : [];
      const files = paths.map((p) => {
        const s = stats.find((x) => x.path === p);
        const f = changed.get(p)!;
        return { path: p, additions: s?.additions ?? null, deletions: s?.deletions ?? null, status: f.untracked ? 'new' : `${f.x}${f.y}`.trim() };
      });
      return {
        op: { action: 'commit', message, paths },
        summary: {
          action: op.action,
          title: `Commit ${paths.length} file(s) to ${st.branch ?? 'detached HEAD'}`,
          lines: [`Message: ${message.split('\n')[0]}`, id.name ? `Author: ${id.name} <${id.email ?? '?'}>` : 'Author: (not configured)'],
          files,
          warnings,
          command: `git add -- <files> && git commit -m "${message.split('\n')[0].replace(/"/g, '\\"')}" -- <files>`,
        },
      };
    }
  }
  throw new HttpError(400, 'Unknown git action');
}

export async function executeOp(root: string, op: GitOp): Promise<{ ok: true; output: string; head?: { sha: string; subject: string } | null; branch?: string | null }> {
  const info = await repoInfo(root);
  if (!info.repo || !info.writable) throw new HttpError(403, info.reason ?? 'git writes are not allowed here');
  switch (op.action) {
    case 'branch.create': {
      let r = await git(root, ['switch', '-c', op.name], { write: true });
      if (r.code !== 0 && /unknown|is not a git command/i.test(r.stderr)) r = await git(root, ['checkout', '-b', op.name], { write: true });
      if (r.code !== 0) fail(r, 'Could not create the branch');
      return { ok: true, output: (r.stderr || r.stdout).trim(), branch: op.name };
    }
    case 'branch.switch': {
      let r = await git(root, ['switch', op.name], { write: true });
      if (r.code !== 0 && /unknown|is not a git command/i.test(r.stderr)) r = await git(root, ['checkout', op.name, '--'], { write: true });
      if (r.code !== 0) fail(r, `Could not switch to ${op.name}`);
      return { ok: true, output: (r.stderr || r.stdout).trim(), branch: op.name };
    }
    case 'apply': {
      const check = await git(root, ['apply', '--check', '--whitespace=nowarn', '-'], { input: op.patch, write: true });
      if (check.code !== 0) fail(check, 'The patch no longer applies');
      const r = await git(root, ['apply', '--whitespace=nowarn', '-'], { input: op.patch, write: true });
      if (r.code !== 0) fail(r, 'git apply failed');
      return { ok: true, output: 'Patch applied to the working tree.' };
    }
    case 'commit': {
      const add = await git(root, ['add', '-A', '--', ...op.paths], { write: true });
      if (add.code !== 0) fail(add, 'git add failed');
      const r = await git(root, ['commit', '-m', op.message, '--', ...op.paths], { write: true, timeoutMs: 120_000 });
      if (r.code !== 0) fail(r, 'git commit failed');
      const st = await status(root);
      return { ok: true, output: r.stdout.trim().split('\n')[0] ?? '', head: st.head, branch: st.branch };
    }
  }
}

export const relativeToRoot = (root: string, abs: string) => path.relative(root, abs).split(path.sep).join('/');
