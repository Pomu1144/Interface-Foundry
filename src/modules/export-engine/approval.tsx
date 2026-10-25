import { AlertTriangle, FileCheck2, GitCommitHorizontal, ShieldCheck, Terminal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { create } from 'zustand';
import { Badge, Button, Dialog, Notice, Segmented, Spinner, TooltipProvider } from '@/ui';
import { api } from '@/modules/project-adapter/server-api';
import { studio } from '@/store';
import { diffFile, type FilePatch } from './patch';
import { DiffView } from './DiffView';
import s from './export.module.css';

/**
 * Every write to the user's files or repository goes through this dialog.
 * The companion prepares the operation (validates paths, hashes, git checks)
 * and returns a one-time token; nothing is written until the user approves
 * and the token is redeemed. Cancelling discards the token.
 */

export type ApprovalFile = { path: string; action?: string; additions?: number | null; deletions?: number | null; conflict?: boolean; patch?: FilePatch; note?: string };

export type ApprovalRequest = {
  title: string;
  description: string;
  icon?: 'files' | 'git';
  lines?: string[];
  warnings?: string[];
  files: ApprovalFile[];
  command?: string;
  confirmLabel: string;
  expiresAt?: number;
  execute: () => Promise<unknown>;
  onCancel?: () => void;
};

type ApprovalState = {
  request: ApprovalRequest | null;
  resolve: ((v: unknown) => void) | null;
  open: (r: ApprovalRequest) => Promise<unknown>;
  close: (result: unknown) => void;
};

const useApproval = create<ApprovalState>((set, get) => ({
  request: null,
  resolve: null,
  open: (request) =>
    new Promise((resolve) => {
      get().resolve?.(null);
      set({ request, resolve });
    }),
  close: (result) => {
    get().resolve?.(result);
    set({ request: null, resolve: null });
  },
}));

let mounted = false;
function ensureHost() {
  if (mounted || typeof document === 'undefined') return;
  mounted = true;
  const el = document.createElement('div');
  el.id = 'ifdy-approval-host';
  document.body.appendChild(el);
  createRoot(el).render(
    <TooltipProvider>
      <ApprovalDialog />
    </TooltipProvider>,
  );
}

/** Show the approval dialog; resolves with execute()'s result, or null when cancelled. */
export function requestApproval<T>(req: ApprovalRequest): Promise<T | null> {
  ensureHost();
  return useApproval.getState().open(req) as Promise<T | null>;
}

function ApprovalDialog() {
  const req = useApproval((st) => st.request);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'inline' | 'split'>('inline');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setBusy(false);
    setError(null);
    setNow(Date.now());
  }, [req]);
  useEffect(() => {
    if (!req?.expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [req]);
  if (!req) return null;
  const remaining = req.expiresAt ? Math.max(0, Math.round((req.expiresAt - now) / 1000)) : null;
  const expired = remaining !== null && remaining <= 0;
  const conflicts = req.files.filter((f) => f.conflict).length;
  const cancel = () => {
    if (busy) return;
    req.onCancel?.();
    useApproval.getState().close(null);
  };
  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await req.execute();
      useApproval.getState().close(result ?? true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  const Icon = req.icon === 'git' ? GitCommitHorizontal : FileCheck2;
  const withPatches = req.files.filter((f) => f.patch);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && cancel()}
      width={withPatches.length ? 920 : 620}
      icon={
        <span className={s.approvalIcon}>
          <Icon size={16} />
        </span>
      }
      title={req.title}
      description={req.description}
      footer={
        <>
          <span className={s.approvalFoot}>
            <ShieldCheck size={13} />
            One-time approval{remaining !== null ? (expired ? ' · expired — prepare again' : ` · expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`) : ''}
          </span>
          <Button variant="ghost" onClick={cancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={approve} disabled={busy || expired} icon={busy ? <Spinner /> : undefined} data-testid="approve-write">
            {req.confirmLabel}
          </Button>
        </>
      }
    >
      <div className={s.approvalBody}>
        {req.lines?.length ? (
          <ul className={s.approvalLines}>
            {req.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        ) : null}
        {req.warnings?.map((w, i) => (
          <Notice key={i} tone="warning">
            {w}
          </Notice>
        ))}
        {conflicts > 0 && (
          <Notice tone="danger" icon={<AlertTriangle size={14} />}>
            {conflicts} file{conflicts === 1 ? '' : 's'} changed on disk since IFDY read {conflicts === 1 ? 'it' : 'them'}. Approving overwrites those changes with the version shown here.
          </Notice>
        )}
        <div className={s.approvalFiles}>
          <div className={s.approvalFilesHead}>
            <span>
              {req.files.length} file{req.files.length === 1 ? '' : 's'}
            </span>
            {withPatches.length > 0 && (
              <Segmented
                ariaLabel="Diff layout"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'inline', label: 'Inline' },
                  { value: 'split', label: 'Side by side' },
                ]}
              />
            )}
          </div>
          {req.files.map((f) => (
            <div key={f.path} className={s.approvalFile}>
              <div className={s.approvalFileRow}>
                <span className={s.mono}>{f.path}</span>
                {f.action && <Badge tone={f.action === 'create' || f.action === 'new' ? 'accent' : f.action === 'delete' ? 'danger' : 'neutral'}>{f.action}</Badge>}
                {f.conflict && <Badge tone="danger">changed on disk</Badge>}
                <span style={{ flex: 1 }} />
                {f.additions !== undefined && f.additions !== null && <span className={s.plus}>+{f.additions}</span>}
                {f.deletions !== undefined && f.deletions !== null && <span className={s.minus}>−{f.deletions}</span>}
              </div>
              {f.note && <div className={s.approvalNote}>{f.note}</div>}
              {f.patch && (
                <div style={{ marginTop: 6 }}>
                  <DiffView file={f.patch} mode={mode} labels collapsible={false} dense />
                </div>
              )}
            </div>
          ))}
        </div>
        {req.command && (
          <div className={s.commandBox}>
            <Terminal size={12} />
            <code>{req.command}</code>
          </div>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Filesystem writes (two-step)                                        */
/* ------------------------------------------------------------------ */

type PrepareResponse = {
  token: string;
  expiresAt: number;
  rootPath: string;
  files: { path: string; action: 'create' | 'update' | 'delete'; bytes: number; exists: boolean; conflict: boolean }[];
  conflicts: number;
};

export type FsWriteFile = { path: string; before: string | null; after: string; baseSha256?: string; patch?: FilePatch };

/** Prepare → review → write files in an authorised local root. Resolves true when written. */
export async function approveFsWrite(rootId: string, files: FsWriteFile[], opts: { title?: string; reason?: string } = {}): Promise<boolean> {
  const prep = await api<PrepareResponse>('/api/fs/prepare', {
    method: 'POST',
    json: { root: rootId, files: files.map((f) => ({ path: f.path, text: f.after, ...(f.baseSha256 !== undefined ? { baseSha256: f.baseSha256 } : f.before === null ? { baseSha256: null } : {}) })), reason: opts.reason },
  });
  const root = studio().server.capabilities?.fs.roots.find((r) => r.id === rootId);
  const result = await requestApproval<{ written: string[] }>({
    title: opts.title ?? `Write ${files.length} file${files.length === 1 ? '' : 's'} to disk`,
    description: `IFDY will write to ${prep.rootPath ?? root?.path ?? 'the allowed root'}. Review every change — nothing is written until you approve.`,
    icon: 'files',
    files: prep.files.map((pf) => {
      const f = files.find((x) => x.path === pf.path)!;
      const patch = f.patch ?? diffFile(pf.path, f.before ?? '', f.after, f.before === null);
      return { path: pf.path, action: pf.action, conflict: pf.conflict, additions: patch.additions, deletions: patch.deletions, patch };
    }),
    confirmLabel: `Approve & write ${files.length} file${files.length === 1 ? '' : 's'}`,
    expiresAt: prep.expiresAt,
    execute: () => api('/api/fs/write', { method: 'POST', json: { token: prep.token, root: rootId } }),
    onCancel: () => void api('/api/fs/cancel', { method: 'POST', json: { token: prep.token } }).catch(() => {}),
  });
  return Boolean(result);
}

/* ------------------------------------------------------------------ */
/* Git operations (two-step)                                           */
/* ------------------------------------------------------------------ */

export type GitSummary = {
  action: string;
  title: string;
  lines: string[];
  files?: { path: string; additions: number | null; deletions: number | null; status?: string }[];
  warnings: string[];
  command: string;
};

export async function approveGitOp<T = unknown>(rootId: string, action: 'branch.create' | 'branch.switch' | 'apply' | 'commit', params: Record<string, unknown>, opts: { patches?: FilePatch[]; confirmLabel?: string } = {}): Promise<T | null> {
  const prep = await api<{ token: string; expiresAt: number; summary: GitSummary }>('/api/git/prepare', { method: 'POST', json: { root: rootId, action, params } });
  const endpoint = action.startsWith('branch.') ? '/api/git/branch' : action === 'apply' ? '/api/git/apply' : '/api/git/commit';
  return requestApproval<T>({
    title: prep.summary.title,
    description: 'Review the git operation. IFDY runs exactly this command after you approve; it never pushes.',
    icon: 'git',
    lines: prep.summary.lines,
    warnings: prep.summary.warnings,
    files: (prep.summary.files ?? []).map((f) => ({ path: f.path, action: f.status, additions: f.additions, deletions: f.deletions, patch: opts.patches?.find((p) => p.path === f.path) })),
    command: prep.summary.command,
    confirmLabel: opts.confirmLabel ?? 'Approve & run',
    expiresAt: prep.expiresAt,
    execute: () => api<T>(endpoint, { method: 'POST', json: { token: prep.token, root: rootId } }),
  });
}
