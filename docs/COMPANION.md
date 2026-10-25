# IFDY companion: filesystem, sources and git

The companion (the local Node server mounted into Vite in development) is the only
part of IFDY that touches your disk or runs git. This page lists exactly what it
may do and how every write is gated.

## Granting access

Nothing on disk is reachable until you list directories explicitly:

```sh
IFDY_ALLOWED_ROOTS=/abs/path/to/site,/abs/path/to/other npm run dev
```

Each entry becomes a *root* (`id` = its index). Roots are fixed for the life of the
process; the studio cannot add one.

## Permissions

| Capability | Endpoint | Scope | Gate |
|---|---|---|---|
| List files | `GET /api/fs/list?root=` | inside the root; skips `node_modules`, `.git`, caches; ≤ 6000 entries | read |
| Read a file | `GET /api/fs/read?root=&path=` | inside the root; text ≤ 2 MB, binary ≤ 12 MB | read |
| Write files | `POST /api/fs/prepare` → `POST /api/fs/write` | inside the root; ≤ 200 files, ≤ 5 MB each, ≤ 24 MB total | **approval** |
| Demo sources | `GET /api/source/demo/*` | bundled demo only | read-only |
| git status / branches / diff | `GET /api/git/status`, `GET /api/git/diff` | the root's repository | read |
| Create / switch branch, `git apply`, commit | `POST /api/git/prepare` → `POST /api/git/{branch,apply,commit}` | repository fully inside the root | **approval** |
| Push, pull request, fetch, remote changes | — | — | **never performed** |

All `/api/*` calls additionally require the per-launch token and a same-origin,
loopback request (see `server/router.ts`).

## Path safety

* Paths are normalised (`..`, absolute paths, NUL bytes rejected) and resolved with
  `safeJoin` inside the root.
* The result is then resolved with `fs.realpath`; a symlink that points outside
  the root is rejected, also for files that do not exist yet (the nearest existing
  parent must resolve inside the root).
* `.git` internals can never be read or written through the file endpoints.
* Listings never follow links out of the root.

## Two-step writes (approval tokens)

1. **Prepare** — the studio sends the complete operation (file contents, commit
   message and paths, branch name, or patch). The companion validates it (paths,
   sizes, `git check-ref-format`, `git apply --check`), records the SHA-256 of every
   file it would overwrite, and stores the operation server-side. It returns a
   summary and a random one-time token (valid 5 minutes, bound to the operation
   kind and root).
2. **Review** — the studio shows an approval dialog listing every file with its
   diff (and the exact git command). Cancelling discards the token.
3. **Execute** — only the stored operation runs; the request carries nothing but
   the token, so approved content cannot be swapped. File writes re-check every
   hash and abort with nothing written if a file changed after review; files are
   written atomically (temp file + rename).

Imported static projects (stored in the browser, served from the in-memory VFS)
are owned by the studio itself; applying edits to them still shows the same review
dialog, but no companion token is involved.

## git specifics

* `git` runs through `execFile` (no shell) with `cwd` = the root, credential
  prompts disabled, `core.fsmonitor` and pagers disabled for reads.
* User-supplied values are validated or passed after `--`.
* Writes require the repository's top level to be inside the allowed root; a root
  that is a sub-directory of a larger repository is read-only.
* Commits use your configured `user.name` / `user.email` and run the repository's
  hooks (the approval dialog says so).
* Push and pull requests stay with you: the Git section shows the exact
  `git push` / `gh pr create` commands to copy.
