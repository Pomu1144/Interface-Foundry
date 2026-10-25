// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApprovalStore, cleanRelative, executeWrites, listTree, prepareWrites, readInside, resolveInside, rootFor } from '../../server/fs';
import { parseStatus } from '../../server/git';

let base: string;
let root: string;
let outside: string;

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), 'ifdy-fs-'));
  root = path.join(base, 'project');
  outside = path.join(base, 'secret');
  mkdirSync(path.join(root, 'src'), { recursive: true });
  mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
  mkdirSync(path.join(root, '.git'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(root, 'index.html'), '<h1>hi</h1>');
  writeFileSync(path.join(root, 'src', 'app.css'), '.a{}');
  writeFileSync(path.join(root, 'node_modules', 'x', 'i.js'), '');
  writeFileSync(path.join(root, '.git', 'config'), '[core]');
  writeFileSync(path.join(outside, 'key.txt'), 'TOP SECRET');
  symlinkSync(outside, path.join(root, 'escape'));
  symlinkSync(path.join(outside, 'key.txt'), path.join(root, 'key-link.txt'));
  symlinkSync(path.join(root, 'src'), path.join(root, 'src-link'));
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('path safety', () => {
  it('rejects traversal and .git access', () => {
    expect(() => cleanRelative('../secret/key.txt')).toThrow(/escapes/);
    expect(() => cleanRelative('src/../../x')).toThrow(/escapes/);
    expect(() => cleanRelative('.git/config')).toThrow(/\.git/);
    expect(() => cleanRelative('a\0b')).toThrow();
    expect(cleanRelative('/src//app.css')).toBe('src/app.css');
    expect(cleanRelative('src\\app.css')).toBe('src/app.css');
  });

  it('rejects symlinks that resolve outside the root', async () => {
    await expect(resolveInside(root, 'escape/key.txt')).rejects.toThrow(/outside the allowed root/);
    await expect(resolveInside(root, 'key-link.txt')).rejects.toThrow(/outside the allowed root/);
    await expect(resolveInside(root, 'escape/new-file.txt')).rejects.toThrow(/outside the allowed root/);
    await expect(readInside(root, 'key-link.txt')).rejects.toThrow();
    // Links that stay inside are fine.
    expect(await resolveInside(root, 'src-link/app.css')).toBe(path.join(root, 'src', 'app.css'));
    expect(await resolveInside(root, 'src/new/deep.css')).toBe(path.join(root, 'src', 'new', 'deep.css'));
  });

  it('only resolves configured roots', () => {
    expect(rootFor([root], '0')).toBe(root);
    expect(() => rootFor([root], '1')).toThrow(/not an allowed root/);
    expect(() => rootFor([root], '../0')).toThrow();
    expect(() => rootFor([root], null)).toThrow();
  });

  it('lists without ignored folders or escaping links', async () => {
    const { entries } = await listTree(root);
    const paths = entries.map((e) => e.path);
    expect(paths).toContain('index.html');
    expect(paths).toContain('src/app.css');
    expect(paths.some((p) => p.startsWith('node_modules'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.git'))).toBe(false);
    expect(paths.some((p) => p.startsWith('escape'))).toBe(false);
    expect(paths).not.toContain('key-link.txt');
  });

  it('reads text and reports hashes', async () => {
    const f = await readInside(root, 'src/app.css');
    expect(f).toMatchObject({ path: 'src/app.css', encoding: 'utf8', content: '.a{}' });
    expect(f.sha256).toHaveLength(64);
  });
});

describe('two-step writes', () => {
  it('requires a one-time token bound to the operation', async () => {
    const store = new ApprovalStore();
    const prepared = await prepareWrites(root, [{ path: 'src/app.css', text: '.a{color:red}' }, { path: 'src/new.css', text: '.n{}' }]);
    expect(prepared.files.map((f) => f.action)).toEqual(['update', 'create']);
    const { token } = store.create('fs.write', '0', prepared);
    expect(() => store.consume(token, 'git.commit')).toThrow(/different operation/);
    expect(() => store.consume('forged', 'fs.write')).toThrow(/invalid, expired or already used/);
    const payload = store.consume<typeof prepared>(token, 'fs.write', '0');
    expect(() => store.consume(token, 'fs.write')).toThrow(/already used/);
    // Nothing is written until execute.
    expect(readFileSync(path.join(root, 'src', 'app.css'), 'utf8')).toBe('.a{}');
    await executeWrites(payload);
    expect(readFileSync(path.join(root, 'src', 'app.css'), 'utf8')).toBe('.a{color:red}');
    expect(existsSync(path.join(root, 'src', 'new.css'))).toBe(true);
  });

  it('expires tokens', () => {
    const store = new ApprovalStore(-1);
    const { token } = store.create('fs.write', '0', {});
    expect(() => store.consume(token, 'fs.write')).toThrow(/expired/);
  });

  it('aborts when a file changed after review and flags stale bases', async () => {
    const prepared = await prepareWrites(root, [{ path: 'index.html', text: '<h1>new</h1>', baseSha256: 'stale' }]);
    expect(prepared.files[0].conflict).toBe(true);
    writeFileSync(path.join(root, 'index.html'), '<h1>edited elsewhere</h1>');
    await expect(executeWrites(prepared)).rejects.toThrow(/changed on disk/);
    expect(readFileSync(path.join(root, 'index.html'), 'utf8')).toBe('<h1>edited elsewhere</h1>');
  });

  it('refuses writes outside the root, into .git, or too large', async () => {
    await expect(prepareWrites(root, [{ path: '../secret/key.txt', text: 'x' }])).rejects.toThrow(/escapes/);
    await expect(prepareWrites(root, [{ path: 'escape/key.txt', text: 'x' }])).rejects.toThrow(/outside/);
    await expect(prepareWrites(root, [{ path: '.git/hooks/pre-commit', text: 'x' }])).rejects.toThrow(/\.git/);
    await expect(prepareWrites(root, [{ path: 'big.txt', text: 'x'.repeat(6 * 1024 * 1024) }])).rejects.toThrow(/limit/);
    expect(readFileSync(path.join(outside, 'key.txt'), 'utf8')).toBe('TOP SECRET');
  });
});

describe('git status parsing', () => {
  it('parses porcelain v1 -z output', () => {
    const out = ['## feature/x...origin/feature/x [ahead 2, behind 1]', ' M src/app.css', 'A  new.css', 'R  renamed.css', 'old.css', '?? notes.md', 'UU conflict.txt', ''].join('\0');
    const s = parseStatus(out);
    expect(s).toMatchObject({ branch: 'feature/x', upstream: 'origin/feature/x', ahead: 2, behind: 1, detached: false });
    expect(s.files.map((f) => [f.path, f.staged, f.unstaged, f.untracked])).toEqual([
      ['src/app.css', false, true, false],
      ['new.css', true, false, false],
      ['renamed.css', true, false, false],
      ['notes.md', false, false, true],
      ['conflict.txt', true, true, false],
    ]);
    expect(s.files[2].from).toBe('old.css');
    expect(s.files[4].conflicted).toBe(true);
    expect(parseStatus('## No commits yet on main\0').branch).toBe('main');
    expect(parseStatus('## HEAD (no branch)\0').detached).toBe(true);
  });
});
