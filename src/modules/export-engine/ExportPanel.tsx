import {
  ClipboardCopy,
  Copy,
  Download,
  FileArchive,
  FileCode2,
  FileDiff,
  FileJson,
  FileText,
  FolderGit2,
  GitBranch,
  History,
  Images,
  Info,
  Palette,
  PackageCheck,
  Trash2,
  Upload,
  FilePlus2,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, IconButton, Segmented, Spinner, Switch, Tooltip } from '@/ui';
import { studio, useStudio } from '@/store';
import { highlightLines, segmentsFor } from '@/modules/code-editor/syntax';
import { duplicateDemoAsProject, sourceAccess } from '@/modules/code-editor/sources';
import { GitSection } from '@/modules/git-integration/GitSection';
import { DiffView, RELIABILITY_META } from './DiffView';
import { EmptyPanel } from './EmptyPanel';
import { requestApproval } from './approval';
import {
  applyPatchToProject,
  changeSummaryDocument,
  clearHistory,
  downloadBlob,
  downloadText,
  exportableChanges,
  overrideCssText,
  recordExport,
  screenshotsZip,
  slugify,
  tokensCss,
  tokensJson,
  useExportHistory,
  useSourcePatch,
  type HistoryKind,
} from './engine';
import type { FilePatch, Reliability } from './patch';
import s from './export.module.css';
import d from './diff.module.css';

type View = 'patch' | 'css' | 'downloads' | 'history' | 'git';

const SYN: Record<string, string> = {
  'syn-comment': d.synComment,
  'syn-keyword': d.synKeyword,
  'syn-tag': d.synTag,
  'syn-attr': d.synAttr,
  'syn-string': d.synString,
  'syn-number': d.synNumber,
  'syn-property': d.synProperty,
  'syn-fn': d.synFn,
  'syn-punct': d.synPunct,
  'syn-invalid': d.synInvalid,
};

export function CodeBlock({ text, lang = 'css', testId }: { text: string; lang?: 'css' | 'json' | 'html' | 'text'; testId?: string }) {
  const hl = useMemo(() => highlightLines(text.replace(/\n$/, ''), lang, SYN), [text, lang]);
  return (
    <pre className={s.codeBlock} data-testid={testId}>
      {hl.lines.map((line, i) => (
        <div key={i} className={s.codeLine}>
          <span>{i + 1}</span>
          <span>
            {segmentsFor(line, hl.spans[i]).map((g, k) => (
              <span key={k} className={g.cls}>
                {g.text}
              </span>
            ))}
          </span>
        </div>
      ))}
    </pre>
  );
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error('Clipboard is not available in this context');
  }
}

export function ExportPanel() {
  const project = useStudio((st) => st.project);
  const source = useStudio((st) => st.source);
  const changes = useStudio((st) => st.changes);
  const [view, setView] = useState<View>('patch');
  const [experiments, setExperiments] = useState(false);
  const [mode, setMode] = useState<'inline' | 'split'>('inline');
  const [selected, setSelected] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const state = useSourcePatch(experiments);
  const access = sourceAccess(source);
  const list = useMemo(() => exportableChanges(changes, experiments), [changes, experiments]);
  const experimentsCount = useMemo(() => exportableChanges(changes, true).filter((c) => c.experiment).length, [changes]);
  const css = useMemo(() => overrideCssText(changes, experiments), [changes, experiments]);
  const patch = state.patch;

  if (!project) return <EmptyPanel icon={PackageCheck} title="Nothing to export">Open a project, make visual edits, then review them here as source patches.</EmptyPanel>;

  const canApply = access.kind === 'vfs' || access.kind === 'fs';
  const verifyOnly = Boolean(patch && !patch.files.length && patch.inSourceIds.length);
  const applyDisabledReason = !canApply ? access.reason : !patch?.files.length && !verifyOnly ? 'No source changes to apply' : applying ? 'Applying…' : undefined;
  const name = slugify(project.name);

  const apply = async () => {
    if (!patch || (!patch.files.length && !verifyOnly)) return;
    try {
      if (access.kind === 'vfs' && patch.files.length) {
        const ok = await requestApproval<boolean>({
          title: `Apply ${patch.files.length} file change${patch.files.length === 1 ? '' : 's'} to “${project.name}”`,
          description: 'Updates the project copy stored in this browser and reloads the preview. Edits the reloaded source reproduces are marked committed and removed from the live override list; anything else stays live.',
          files: patch.files.map((f) => ({ path: f.path, action: f.isNew ? 'create' : 'update', additions: f.additions, deletions: f.deletions, patch: f })),
          warnings: patch.unmapped.length ? [`${patch.unmapped.length} edit(s) are not mapped to source and stay as live overrides.`] : undefined,
          confirmLabel: `Apply ${patch.files.length} file${patch.files.length === 1 ? '' : 's'}`,
          execute: async () => true,
        });
        if (!ok) return;
      }
      setApplying('Starting…');
      const result = await applyPatchToProject(patch, { onStatus: setApplying });
      if (!result) return;
      const msg = `${result.written.length} file(s) written · ${result.verified.length} edit(s) verified and committed`;
      if (result.kept.length || result.unverifiable.length) toast.warning(msg, { description: `${result.kept.length} edit(s) render differently from source and stay live; ${result.unverifiable.length} could not be verified (kept).` });
      else toast.success(msg, { description: 'The preview now renders these edits from source.' });
    } catch (err) {
      toast.error('Apply failed', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setApplying(null);
    }
  };

  const downloadPatch = () => {
    if (!patch?.unified) return;
    downloadText(`${name}-ifdy.patch`, patch.unified, 'text/x-diff');
    recordExport({ kind: 'patch', label: 'Downloaded unified patch', detail: `${patch.files.length} file(s), +${patch.stats.additions} −${patch.stats.deletions}`, changeCount: list.length, files: patch.files.map((f) => f.path) });
  };
  const downloadCss = () => {
    if (!css) return;
    downloadText('ifdy-overrides.css', css, 'text/css');
    recordExport({ kind: 'css', label: 'Downloaded ifdy-overrides.css', changeCount: list.length });
  };

  const duplicate = async () => {
    setDuplicating(true);
    try {
      await duplicateDemoAsProject();
      toast.success('Editable copy created', { description: 'Your edits came along. Apply them to the copy’s files from this panel.' });
    } catch (err) {
      toast.error('Could not duplicate the demo', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setDuplicating(false);
    }
  };

  const stat = (r: Reliability, n: number) => {
    if (!n) return null;
    const meta = RELIABILITY_META[r];
    const Icon = meta.icon;
    return (
      <Badge key={r} tone={meta.tone} title={`${n} change(s): ${meta.short.toLowerCase()}`}>
        <Icon size={10} />
        {n} {meta.short.toLowerCase()}
      </Badge>
    );
  };

  const views = [
    { value: 'patch' as const, label: 'Source patch', icon: <FileDiff size={12} /> },
    { value: 'css' as const, label: 'CSS', icon: <FileCode2 size={12} /> },
    { value: 'downloads' as const, label: 'Exports', icon: <Download size={12} /> },
    { value: 'history' as const, label: 'History', icon: <History size={12} /> },
    { value: 'git' as const, label: 'Git', icon: <GitBranch size={12} /> },
  ];

  return (
    <div className={s.panel} data-testid="export-panel">
      <div className={s.toolbar}>
        <Segmented ariaLabel="Export view" value={view} onChange={setView} options={views} />
        {(view === 'patch' || view === 'css') && patch && (
          <span className={s.chips}>
            {stat('exact', patch.stats.exact)}
            {stat('appended', patch.stats.appended)}
            {stat('review', patch.stats.review)}
            {stat('unmapped', patch.stats.unmapped)}
            {patch.stats.inSource > 0 && (
              <Badge tone="outline" title="These edits are already expressed by the source files">
                {patch.stats.inSource} already in source
              </Badge>
            )}
          </span>
        )}
        <span className={s.spacer} />
        {experimentsCount > 0 && (view === 'patch' || view === 'css') && (
          <label className={s.switchLabel}>
            <Switch ariaLabel="Include experiments" checked={experiments} onChange={setExperiments} />
            Include {experimentsCount} experiment{experimentsCount === 1 ? '' : 's'}
          </label>
        )}
        {view === 'patch' && (
          <>
            <Segmented
              ariaLabel="Diff layout"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'inline', label: 'Inline' },
                { value: 'split', label: 'Split' },
              ]}
            />
            <Button size="sm" icon={<Download size={12} />} disabled={!patch?.unified} onClick={downloadPatch}>
              .patch
            </Button>
            <Tooltip content={applyDisabledReason ?? (access.kind === 'fs' ? 'Review and approve each file write' : 'Write into the project copy and verify')}>
              <span>
                <Button size="sm" variant="primary" icon={applying ? <Spinner /> : <Upload size={12} />} disabled={Boolean(applyDisabledReason)} onClick={apply} data-testid="apply-patch">
                  {applying ?? (verifyOnly ? 'Verify & commit…' : 'Apply to project files…')}
                </Button>
              </span>
            </Tooltip>
          </>
        )}
        {view === 'css' && (
          <>
            <Button size="sm" icon={<Copy size={12} />} disabled={!css} onClick={() => {
              void copy(css, 'Override CSS');
              recordExport({ kind: 'copy', label: 'Copied override CSS', changeCount: list.length });
            }}>
              Copy CSS
            </Button>
            <Button size="sm" icon={<Download size={12} />} disabled={!css} onClick={downloadCss}>
              ifdy-overrides.css
            </Button>
          </>
        )}
      </div>

      {view === 'patch' && (
        <PatchView
          state={state}
          mode={mode}
          selected={selected}
          onSelect={setSelected}
          hasChanges={list.length > 0}
          accessNote={
            access.kind === 'demo' ? (
              <div className={s.banner}>
                <Info size={13} />
                <span>Demo sources are read-only — this patch is reviewable and downloadable. Duplicate the demo to apply it to files.</span>
                <Button size="sm" icon={duplicating ? <Spinner /> : <FilePlus2 size={12} />} disabled={duplicating} onClick={duplicate} data-testid="duplicate-demo">
                  Duplicate as editable project
                </Button>
              </div>
            ) : access.kind === 'none' ? (
              <div className={s.banner} data-tone="warning">
                <Info size={13} />
                <span>{access.reason} The patch contains an overrides stylesheet only.</span>
              </div>
            ) : access.kind === 'fs' ? (
              <div className={s.banner}>
                <ShieldCheck size={13} />
                <span>Local files are written only after you approve every file in a review dialog.</span>
              </div>
            ) : null
          }
        />
      )}
      {view === 'css' && (
        <div className={s.mainScroll}>
          {css ? (
            <CodeBlock text={css} testId="override-css" />
          ) : (
            <EmptyPanel icon={FileCode2} title="No CSS overrides">
              Style, rule and token edits appear here as a plain stylesheet (without <code>!important</code>) you can paste into your project.
            </EmptyPanel>
          )}
        </div>
      )}
      {view === 'downloads' && <Downloads stateReady={state.status === 'ready'} patchUnified={patch?.unified ?? ''} patchFiles={patch?.files.length ?? 0} onPatch={downloadPatch} onCss={downloadCss} css={css} />}
      {view === 'history' && <HistoryView />}
      {view === 'git' && <GitSection patch={patch} />}
    </div>
  );
}

function PatchView({
  state,
  mode,
  selected,
  onSelect,
  hasChanges,
  accessNote,
}: {
  state: ReturnType<typeof useSourcePatch>;
  mode: 'inline' | 'split';
  selected: string | null;
  onSelect: (p: string | null) => void;
  hasChanges: boolean;
  accessNote: React.ReactNode;
}) {
  const patch = state.patch;
  if (!hasChanges)
    return (
      <EmptyPanel icon={Send} title="No changes to export yet" tone="accent">
        Edit styles, text, tokens or assets on the canvas. Each edit maps back to your sources here as a reviewable diff.
      </EmptyPanel>
    );
  if (state.status === 'loading')
    return (
      <EmptyPanel icon={FileDiff} title="Reading project sources…">
        <Spinner />
      </EmptyPanel>
    );
  if (state.status === 'error' || !patch)
    return (
      <EmptyPanel icon={Info} title="Could not build the patch" tone="danger">
        {state.error}
      </EmptyPanel>
    );
  const files = patch.files;
  const visible: FilePatch[] = selected ? files.filter((f) => f.path === selected) : files;
  const reliabilities = (f: FilePatch) => [...new Set(f.hunks.flatMap((h) => h.labels.map((l) => l.reliability)))];
  return (
    <div className={s.body}>
      <div className={s.side}>
        <div className={s.sideScroll}>
          <div className={s.sideHead}>
            Files <span style={{ flex: 1 }} />
            <span className={s.plus}>+{patch.stats.additions}</span>
            <span className={s.minus}>−{patch.stats.deletions}</span>
          </div>
          {files.length > 1 && (
            <button className={s.fileRow} data-active={selected === null ? 'true' : undefined} onClick={() => onSelect(null)}>
              <FileDiff size={13} />
              <span className={s.fileName}>All files ({files.length})</span>
            </button>
          )}
          {files.map((f) => {
            const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/') + 1) : '';
            return (
              <button key={f.path} className={s.fileRow} data-active={selected === f.path ? 'true' : undefined} onClick={() => onSelect(f.path)} title={f.path} data-testid="patch-file">
                {f.isNew ? <FilePlus2 size={13} color="var(--accent)" /> : <FileCode2 size={13} />}
                <span className={s.fileName}>
                  <span className={s.fileDir}>{dir}</span>
                  {f.path.slice(dir.length)}
                </span>
                <span style={{ flex: 1 }} />
                <span className={s.dots}>
                  {reliabilities(f).map((r) => (
                    <span key={r} className={s.dot} data-r={r} />
                  ))}
                </span>
                <span className={s.plus}>+{f.additions}</span>
                <span className={s.minus}>−{f.deletions}</span>
              </button>
            );
          })}
          {!files.length && <div className={s.unmapped}>No source edits — every change is listed below.</div>}
          {patch.unmapped.length > 0 && (
            <>
              <div className={s.sideHead} style={{ marginTop: 6 }}>
                Not mapped ({patch.unmapped.length})
              </div>
              {patch.unmapped.map((u, i) => (
                <div key={i} className={s.unmapped} data-testid="unmapped">
                  <div className={s.unmappedLabel}>{u.label}</div>
                  <div className={s.unmappedReason}>not mapped: {u.reason}</div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      <div className={s.main}>
        {accessNote}
        <div className={s.mainScroll}>
          {visible.length ? (
            visible.map((f) => <DiffView key={f.path + mode} file={f} mode={mode} />)
          ) : (
            <EmptyPanel icon={Info} title="Nothing maps to source" compact>
              These edits have no source equivalent yet. Keep them as live overrides or export the CSS.
            </EmptyPanel>
          )}
        </div>
      </div>
    </div>
  );
}

function Downloads({ stateReady, patchUnified, patchFiles, onPatch, onCss, css }: { stateReady: boolean; patchUnified: string; patchFiles: number; onPatch: () => void; onCss: () => void; css: string }) {
  const project = useStudio((st) => st.project)!;
  const tokens = useStudio((st) => st.tokens);
  const captures = useStudio((st) => st.captures);
  const changes = useStudio((st) => st.changes);
  const runs = useStudio((st) => st.runs);
  const name = slugify(project.name);
  const cards: { icon: typeof Download; title: string; text: string; meta: string; action: string; disabled?: string; run: () => void; testId: string }[] = [
    { icon: FileCode2, title: 'CSS overrides', text: 'Plain stylesheet of your style, rule and token edits.', meta: 'ifdy-overrides.css', action: 'Download', disabled: css ? undefined : 'No style edits yet', run: onCss, testId: 'dl-css' },
    { icon: FileDiff, title: 'Unified patch', text: 'Git-compatible diff of every mapped source edit (git apply / patch -p1).', meta: `${patchFiles} file(s)`, action: 'Download', disabled: !stateReady ? 'Reading sources…' : patchUnified ? undefined : 'No source edits yet', run: onPatch, testId: 'dl-patch' },
    {
      icon: FileJson,
      title: 'Design tokens (DTCG)',
      text: 'W3C Design Tokens JSON with live values; imports into Style Dictionary, Tokens Studio and Figma.',
      meta: `${tokens.length} token(s) · tokens.json`,
      action: 'Download',
      disabled: tokens.length ? undefined : 'No tokens — scan the page in the Tokens panel',
      run: () => {
        downloadText('tokens.json', tokensJson(), 'application/json');
        recordExport({ kind: 'tokens', label: 'Downloaded tokens.json (DTCG)', changeCount: tokens.length });
      },
      testId: 'dl-tokens',
    },
    {
      icon: Palette,
      title: 'Tokens as CSS variables',
      text: 'A :root block with every token as a custom property.',
      meta: 'tokens.css',
      action: 'Download',
      disabled: tokens.length ? undefined : 'No tokens yet',
      run: () => {
        downloadText('tokens.css', tokensCss(), 'text/css');
        recordExport({ kind: 'tokens', label: 'Downloaded tokens.css', changeCount: tokens.length });
      },
      testId: 'dl-tokens-css',
    },
    {
      icon: Images,
      title: 'Screenshots',
      text: 'Every capture with a manifest of device, posture and viewport.',
      meta: `${captures.length} capture(s) · ZIP`,
      action: 'Download',
      disabled: captures.length ? undefined : 'No screenshots captured yet',
      run: () => {
        const zip = screenshotsZip(captures);
        downloadBlob(`${name}-screenshots.zip`, new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' }));
        recordExport({ kind: 'zip', label: 'Downloaded screenshots ZIP', detail: `${captures.length} capture(s)`, changeCount: 0 });
      },
      testId: 'dl-zip',
    },
    {
      icon: FileText,
      title: 'Change summary',
      text: 'Markdown list of edits with origin, viewport and source mapping — for PR descriptions.',
      meta: 'CHANGES.md',
      action: 'Download',
      disabled: changes.length ? undefined : 'No changes yet',
      run: async () => {
        const { buildSourcePatch } = await import('./patch');
        const { loadTextSources } = await import('@/modules/code-editor/sources');
        const st = studio();
        const files = await loadTextSources(st.source, { scripts: true }).catch(() => null);
        const p = buildSourcePatch({ changes: st.changes, files });
        downloadText(`${name}-changes.md`, changeSummaryDocument(project.name, st.changes, p), 'text/markdown');
        recordExport({ kind: 'markdown', label: 'Downloaded change summary', changeCount: st.changes.length });
      },
      testId: 'dl-md',
    },
    {
      icon: FileArchive,
      title: 'Responsive QA report',
      text: 'Document with viewports, changes, responsive and accessibility findings, test runs and captures.',
      meta: `${runs.length} run(s) · HTML`,
      action: 'Open report',
      run: () => studio().openDoc({ id: 'report', kind: 'report', title: 'QA report' }),
      testId: 'dl-report',
    },
  ];
  return (
    <div className={s.mainScroll}>
      <div className={s.cards}>
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.title} className={s.card}>
              <div className={s.cardHead}>
                <span className={s.cardIcon}>
                  <Icon size={13} />
                </span>
                {c.title}
              </div>
              <div className={s.cardText}>{c.text}</div>
              <div className={s.cardFoot}>
                <span className={s.cardMeta}>{c.meta}</span>
                <Tooltip content={c.disabled}>
                  <span>
                    <Button size="sm" disabled={Boolean(c.disabled)} onClick={c.run} data-testid={c.testId} icon={c.action === 'Download' ? <Download size={12} /> : undefined}>
                      {c.action}
                    </Button>
                  </span>
                </Tooltip>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const HISTORY_ICON: Record<HistoryKind, typeof Download> = {
  css: FileCode2,
  copy: ClipboardCopy,
  patch: FileDiff,
  tokens: FileJson,
  zip: Images,
  markdown: FileText,
  report: FileArchive,
  apply: Upload,
  git: FolderGit2,
};

function HistoryView() {
  const entries = useExportHistory();
  if (!entries.length)
    return (
      <EmptyPanel icon={History} title="No exports yet">
        Downloads, copies, applied patches and commits for this project are listed here (stored in this browser).
      </EmptyPanel>
    );
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <div className={s.mainScroll}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
        <IconButton size="sm" label="Clear export history" onClick={() => clearHistory()}>
          <Trash2 size={13} />
        </IconButton>
      </div>
      <div className={s.history}>
        {entries.map((e) => {
          const Icon = HISTORY_ICON[e.kind] ?? Download;
          return (
            <div key={e.id} className={s.historyRow}>
              <span className={s.historyIcon}>
                <Icon size={12} />
              </span>
              <div>
                <div className={s.historyLabel}>{e.label}</div>
                {e.detail && <div className={s.historyDetail}>{e.detail}</div>}
                {e.files?.length ? <div className={s.historyFiles}>{e.files.join('  ·  ')}</div> : null}
              </div>
              <span className={s.historyTime}>{fmt.format(e.at)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
