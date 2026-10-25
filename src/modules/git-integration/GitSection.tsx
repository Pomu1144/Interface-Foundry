import { Check, Copy, FolderGit2, GitBranch, GitCommitHorizontal, GitPullRequestArrow, Plus, RefreshCw, ShieldAlert, Terminal, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Checkbox, IconButton, Notice, Select, Spinner, TextField, Tooltip } from '@/ui';
import { studio, useStudio } from '@/store';
import { api } from '@/modules/project-adapter/server-api';
import { invalidateSources } from '@/modules/code-editor/sources';
import { approveGitOp } from '@/modules/export-engine/approval';
import { DiffView, parseUnifiedDiff } from '@/modules/export-engine/DiffView';
import { EmptyPanel } from '@/modules/export-engine/EmptyPanel';
import { recordExport } from '@/modules/export-engine/engine';
import type { SourcePatch } from '@/modules/export-engine/patch';
import s from './git.module.css';

/**
 * Git basics for local directories opened through the companion: status,
 * branches, working-tree diff, create/switch branch, apply the IFDY patch,
 * commit. Every write is prepared server-side and needs approval. Push and
 * pull requests are never run — the exact commands are shown instead.
 */

type GitFile = { path: string; from?: string; x: string; y: string; staged: boolean; unstaged: boolean; untracked: boolean; conflicted: boolean };
type GitStatusResponse = {
  available: boolean;
  repo: boolean;
  writable: boolean;
  topLevel: string | null;
  reason?: string;
  status: { branch: string | null; detached: boolean; upstream: string | null; ahead: number; behind: number; head: { sha: string; subject: string } | null; files: GitFile[] } | null;
  branches: { name: string; sha: string; current: boolean; upstream: string | null }[];
};

const letter = (f: GitFile) => (f.untracked ? 'U' : f.conflicted ? '!' : (f.x !== ' ' ? f.x : f.y) || 'M');
const tone = (l: string) => (l === 'A' || l === 'U' ? 'success' : l === 'D' ? 'danger' : l === '!' ? 'danger' : l === 'R' ? 'accent' : 'warning');

export function GitSection({ patch }: { patch: SourcePatch | null }) {
  const source = useStudio((st) => st.source);
  const changes = useStudio((st) => st.changes.length);
  if (source?.kind !== 'fs')
    return (
      <EmptyPanel icon={FolderGit2} title="Git is available for local directories">
        Start the studio with <code>IFDY_ALLOWED_ROOTS=/path/to/repo</code> and open that directory. IFDY can then show status and diffs, create branches, apply its patch and commit — each step after your approval. Pushing stays with you.
      </EmptyPanel>
    );
  return <GitRepo rootId={source.rootId} patch={patch} changeCount={changes} />;
}

function GitRepo({ rootId, patch, changeCount }: { rootId: string; patch: SourcePatch | null; changeCount: number }) {
  const [data, setData] = useState<GitStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [diff, setDiff] = useState<{ text: string; truncated: boolean } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [newBranch, setNewBranch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const st = await api<GitStatusResponse>(`/api/git/status?root=${encodeURIComponent(rootId)}`);
      setData(st);
      if (st.repo) {
        const d = await api<{ diff: string; truncated: boolean }>(`/api/git/diff?root=${encodeURIComponent(rootId)}`);
        setDiff({ text: d.diff, truncated: d.truncated });
      } else setDiff(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [rootId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const files = data?.status?.files ?? [];
  useEffect(() => {
    setPicked((p) => Object.fromEntries(files.map((f) => [f.path, p[f.path] ?? true])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.map((f) => f.path).join('|')]);
  const parsed = useMemo(() => (diff ? parseUnifiedDiff(diff.text) : []), [diff]);
  const shown = selected ? parsed.filter((p) => p.path === selected) : parsed;

  if (loading && !data)
    return (
      <EmptyPanel icon={FolderGit2} title="Reading repository…">
        <Spinner />
      </EmptyPanel>
    );
  if (error)
    return (
      <EmptyPanel icon={ShieldAlert} title="Git is unavailable" tone="danger" action={<Button size="sm" onClick={refresh}>Retry</Button>}>
        {error}
      </EmptyPanel>
    );
  if (!data?.available)
    return (
      <EmptyPanel icon={ShieldAlert} title="git is not installed" tone="warning">
        Install git and restart the companion to enable status, diffs and commits.
      </EmptyPanel>
    );
  if (!data.repo)
    return (
      <EmptyPanel icon={FolderGit2} title="Not a git repository" action={<Button size="sm" icon={<RefreshCw size={12} />} onClick={refresh}>Check again</Button>}>
        {data.reason}. Run <code>git init</code> in this directory yourself if you want version control; IFDY never initialises repositories.
      </EmptyPanel>
    );

  const st = data.status!;
  const branch = st.branch ?? '(detached)';
  const readOnly = !data.writable;
  const chosen = files.filter((f) => picked[f.path]).map((f) => f.path);
  const defaultMessage = `style: apply IFDY design edits${changeCount ? ` (${changeCount} change${changeCount === 1 ? '' : 's'})` : ''}`;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      const r = await fn();
      if (r) {
        await refresh();
        invalidateSources();
      }
      return r;
    } catch (err) {
      toast.error(`${label} failed`, { description: err instanceof Error ? err.message : String(err) });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const switchTo = (name: string) =>
    run('Switch branch', async () => {
      const r = await approveGitOp(rootId, 'branch.switch', { name }, { confirmLabel: `Switch to ${name}` });
      if (r) {
        toast.success(`Switched to ${name}`);
        studio().reloadPreview();
      }
      return r;
    });
  const createBranch = () =>
    run('Create branch', async () => {
      const r = await approveGitOp(rootId, 'branch.create', { name: newBranch.trim() }, { confirmLabel: `Create ${newBranch.trim()}` });
      if (r) {
        toast.success(`Created and switched to ${newBranch.trim()}`);
        recordExport({ kind: 'git', label: `Created branch ${newBranch.trim()}`, changeCount: 0 });
        setNewBranch('');
      }
      return r;
    });
  const applyPatch = () =>
    run('git apply', async () => {
      if (!patch?.unified) return null;
      const r = await approveGitOp(rootId, 'apply', { patch: patch.unified }, { patches: patch.files, confirmLabel: 'Apply patch' });
      if (r) {
        toast.success('Patch applied to the working tree', { description: 'Reloading the preview from source.' });
        recordExport({ kind: 'git', label: 'Applied IFDY patch with git apply', detail: `${patch.files.length} file(s)`, changeCount, files: patch.files.map((f) => f.path) });
        studio().reloadPreview();
      }
      return r;
    });
  const commit = () =>
    run('Commit', async () => {
      const msg = message.trim() || defaultMessage;
      const r = await approveGitOp<{ head: { sha: string; subject: string } | null }>(rootId, 'commit', { message: msg, paths: chosen }, { patches: parsed, confirmLabel: `Commit ${chosen.length} file${chosen.length === 1 ? '' : 's'}` });
      if (r) {
        toast.success(`Committed ${r.head?.sha.slice(0, 7) ?? ''}`, { description: r.head?.subject });
        recordExport({ kind: 'git', label: `Committed ${r.head?.sha.slice(0, 7) ?? ''} on ${branch}`, detail: msg, changeCount, files: chosen });
        setMessage('');
      }
      return r;
    });

  const remote = st.upstream?.split('/')[0] ?? 'origin';
  const pushCmd = st.upstream ? `git push` : `git push -u ${remote} ${branch}`;
  const prCmd = `gh pr create --head ${branch} --title "${(message.trim() || defaultMessage).replace(/"/g, '\\"')}" --fill`;

  return (
    <div className={s.wrap} data-testid="git-section">
      <div className={s.side}>
        <div className={s.branchBar}>
          <GitBranch size={13} />
          <Select
            ariaLabel="Branch"
            value={st.branch ?? ''}
            options={[...(st.branch ? [] : [{ value: '', label: '(detached HEAD)' }]), ...data.branches.map((b) => ({ value: b.name, label: b.name }))]}
            onChange={(v) => v && v !== st.branch && void switchTo(v)}
            style={{ flex: 1, minWidth: 0 }}
          />
          <IconButton size="sm" label="Refresh" onClick={refresh}>
            {loading ? <Spinner /> : <RefreshCw size={12} />}
          </IconButton>
        </div>
        <div className={s.headLine}>
          {st.head ? (
            <>
              <code>{st.head.sha.slice(0, 7)}</code> <span className={s.subject}>{st.head.subject}</span>
            </>
          ) : (
            <span className={s.muted}>No commits yet</span>
          )}
          {st.ahead > 0 && <Badge tone="accent">↑{st.ahead}</Badge>}
          {st.behind > 0 && <Badge tone="warning">↓{st.behind}</Badge>}
        </div>
        {readOnly && (
          <div style={{ padding: '0 10px 8px' }}>
            <Notice tone="warning">{data.reason}</Notice>
          </div>
        )}
        <div className={s.newBranch}>
          <TextField value={newBranch} onCommit={setNewBranch} placeholder="new-branch-name" mono aria-label="New branch name" />
          <Button size="sm" icon={<Plus size={12} />} disabled={readOnly || !newBranch.trim() || Boolean(busy)} onClick={createBranch}>
            Branch
          </Button>
        </div>
        <div className={s.listHead}>
          Changes <Badge>{files.length}</Badge>
          <span style={{ flex: 1 }} />
          {patch?.unified && (
            <Tooltip content="git apply --check, then git apply (after approval)">
              <span>
                <Button size="sm" variant="ghost" icon={<Wand2 size={12} />} disabled={readOnly || Boolean(busy)} onClick={applyPatch}>
                  Apply IFDY patch
                </Button>
              </span>
            </Tooltip>
          )}
        </div>
        <div className={s.files}>
          {!files.length && <div className={s.clean}><Check size={12} /> Working tree clean</div>}
          {files.map((f) => {
            const l = letter(f);
            return (
              <div key={f.path} className={s.file} data-active={selected === f.path ? 'true' : undefined}>
                <input type="checkbox" checked={picked[f.path] ?? true} onChange={(e) => setPicked((p) => ({ ...p, [f.path]: e.target.checked }))} aria-label={`Include ${f.path} in commit`} />
                <button className={s.fileBtn} onClick={() => setSelected(selected === f.path ? null : f.path)} title={f.from ? `${f.from} → ${f.path}` : f.path}>
                  <span className={s.path}>{f.path}</span>
                </button>
                <Badge tone={tone(l)} title={f.untracked ? 'untracked' : `index ${f.x} · worktree ${f.y}`}>
                  {l}
                </Badge>
              </div>
            );
          })}
        </div>
        <div className={s.commitBox}>
          <textarea className={s.message} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={defaultMessage} rows={2} aria-label="Commit message" />
          <Button variant="primary" size="sm" icon={busy === 'Commit' ? <Spinner /> : <GitCommitHorizontal size={12} />} disabled={readOnly || !chosen.length || Boolean(busy)} onClick={commit} data-testid="git-commit">
            Review & commit {chosen.length ? `${chosen.length} file${chosen.length === 1 ? '' : 's'}` : ''}
          </Button>
          <Checkbox checked={chosen.length === files.length && files.length > 0} onChange={(v) => setPicked(Object.fromEntries(files.map((f) => [f.path, v])))} label="All files" />
        </div>
      </div>
      <div className={s.main}>
        <div className={s.publish}>
          <div className={s.publishHead}>
            <GitPullRequestArrow size={13} /> Publish — run these yourself
            <Badge tone="outline">IFDY never pushes</Badge>
          </div>
          <Command text={pushCmd} />
          <Command text={prCmd} />
        </div>
        <div className={s.diffs}>
          {diff?.truncated && <Notice tone="warning">The diff is large and was truncated.</Notice>}
          {shown.length ? shown.map((f) => <DiffView key={f.path} file={f} labels={false} />) : <div className={s.clean}>No differences against HEAD.</div>}
        </div>
      </div>
    </div>
  );
}

function Command({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className={s.command}>
      <Terminal size={12} />
      <code>{text}</code>
      <IconButton
        size="sm"
        label="Copy command"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          } catch {
            toast.error('Clipboard unavailable');
          }
        }}
      >
        {done ? <Check size={12} /> : <Copy size={12} />}
      </IconButton>
    </div>
  );
}
