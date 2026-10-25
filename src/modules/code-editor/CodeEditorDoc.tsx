import { EditorView } from '@codemirror/view';
import { ChevronRight, CopyPlus, FileWarning, Lock, RotateCcw, Save, ShieldCheck, FileImage } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Spinner, Tooltip } from '@/ui';
import { studio, useStudio, type DocTab } from '@/store';
import { EmptyPanel } from '@/modules/export-engine/EmptyPanel';
import { approveFsWrite } from '@/modules/export-engine/approval';
import { buffers } from './open';
import { createEditorState, revealLine, themeCompartment, type EditorHooks } from './setup';
import { duplicateDemoAsProject, invalidateSources, lastSourceChange, onSourcesChanged, readSourceFile, reloadSourcePreviews, saveVfsFiles, sourceAccess, sourceKey, sourcesVersion, type SourceRead } from './sources';
import { LANGUAGE_LABEL, languageFor } from './syntax';
import s from './editor.module.css';

/** Hooks per document, read lazily by the editor state so restored buffers never hold stale closures. */
const hooksByDoc = new Map<string, EditorHooks>();

export default function CodeEditorDoc({ doc }: { doc: DocTab }) {
  const path = String(doc.data?.path ?? '');
  const line = typeof doc.data?.line === 'number' ? (doc.data.line as number) : undefined;
  const reveal = doc.data?.reveal as number | undefined;
  const source = useStudio((st) => st.source);
  const theme = useStudio((st) => st.settings.theme);
  const access = sourceAccess(source);
  const key = `${sourceKey(source)}\u0000${path}`;
  const lang = languageFor(path);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'binary' | 'error'>('loading');
  const [binary, setBinary] = useState<SourceRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [lines, setLines] = useState(0);
  const [dirty, setDirty] = useState(Boolean(doc.dirty));
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [external, setExternal] = useState<{ text: string; sha256?: string } | null>(null);
  const ver = useSyncExternalStore(onSourcesChanged, sourcesVersion);

  const markDirty = (next: boolean) => {
    setDirty(next);
    if (Boolean(studio().documents.find((d) => d.id === doc.id)?.dirty) !== next) studio().updateDoc(doc.id, { dirty: next });
  };

  const save = async () => {
    const view = viewRef.current;
    const buf = buffers.get(doc.id);
    if (!view || !buf || saving) return;
    if (access.readOnly) {
      toast.info(access.kind === 'demo' ? 'Demo sources are read-only' : 'This file cannot be saved', { description: access.reason });
      return;
    }
    const text = view.state.doc.toString();
    if (text === buf.original) {
      toast('No changes to save');
      return;
    }
    setSaving(true);
    try {
      if (source?.kind === 'vfs') {
        await saveVfsFiles(source.projectId, [{ path, text }]);
      } else if (source?.kind === 'fs') {
        const ok = await approveFsWrite(source.rootId, [{ path, before: buf.original, after: text, baseSha256: buf.sha256 }], { title: `Save ${path}`, reason: 'editor.save' });
        if (!ok) return;
        invalidateSources(path);
        buf.sha256 = (await readSourceFile(source, path).catch(() => null))?.sha256;
      }
      buf.original = text;
      markDirty(false);
      reloadSourcePreviews();
      toast.success(`Saved ${path.split('/').pop()}`, { description: 'The preview reloaded with the new source; your live edits were re-applied.' });
    } catch (err) {
      toast.error('Save failed', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  hooksByDoc.set(doc.id, {
    onSave: () => void save(),
    onChange: (text) => {
      const buf = buffers.get(doc.id);
      markDirty(Boolean(buf && text !== buf.original));
      setLines(viewRef.current?.state.doc.lines ?? 0);
    },
    onCursor: (l, c) => setCursor({ line: l, col: c }),
  });

  useEffect(() => {
    let cancelled = false;
    const mount = (state: EditorView['state']) => {
      if (!hostRef.current) return;
      const view = new EditorView({ state, parent: hostRef.current });
      viewRef.current = view;
      setLines(state.doc.lines);
      setStatus('ready');
      const buf = buffers.get(doc.id);
      markDirty(Boolean(buf && state.doc.toString() !== buf.original));
      if (line) requestAnimationFrame(() => revealLine(view, line));
    };
    const existing = buffers.get(doc.id);
    if (existing && existing.key === key) mount(existing.state);
    else {
      setStatus('loading');
      setBinary(null);
      readSourceFile(source, path)
        .then((r) => {
          if (cancelled) return;
          if (r.text === null) {
            setBinary(r);
            setStatus('binary');
            return;
          }
          const state = createEditorState(r.text, { language: lang, readOnly: access.readOnly, dark: studio().settings.theme !== 'light', hooks: () => hooksByDoc.get(doc.id)! });
          buffers.set(doc.id, { state, original: r.text, sha256: r.sha256, key });
          mount(state);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : String(err));
          setStatus('error');
        });
    }
    return () => {
      cancelled = true;
      const v = viewRef.current;
      if (v) {
        const b = buffers.get(doc.id);
        if (b) b.state = v.state;
        v.destroy();
        viewRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, key]);

  // Reveal requests for an already-open document.
  useEffect(() => {
    const v = viewRef.current;
    if (v && line && status === 'ready') revealLine(v, line);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);

  // Follow changes made elsewhere (apply patch, git): refresh a clean buffer, flag a dirty one.
  useEffect(() => {
    if (status !== 'ready') return;
    const changed = lastSourceChange();
    if (changed.paths && !changed.paths.includes(path)) return;
    let cancelled = false;
    readSourceFile(source, path)
      .then((r) => {
        const v = viewRef.current;
        const buf = buffers.get(doc.id);
        if (cancelled || r.text === null || !v || !buf || r.text === buf.original) return;
        const current = v.state.doc.toString();
        if (r.text === current || current === buf.original) {
          if (r.text !== current) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: r.text } });
          buf.original = r.text;
          buf.sha256 = r.sha256;
          markDirty(false);
          setExternal(null);
        } else setExternal({ text: r.text, sha256: r.sha256 });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ver]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: themeCompartment.reconfigure(EditorView.darkTheme.of(theme !== 'light')) });
  }, [theme]);

  const revert = () => {
    const v = viewRef.current;
    const buf = buffers.get(doc.id);
    if (!v || !buf) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: buf.original } });
    markDirty(false);
  };

  const duplicate = async () => {
    setDuplicating(true);
    try {
      await duplicateDemoAsProject();
      toast.success('Editable copy created', { description: 'Open any file from the Files panel and save with ⌘S / Ctrl+S.' });
    } catch (err) {
      toast.error('Could not duplicate the demo', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setDuplicating(false);
    }
  };

  const segments = path.split('/');
  const accessBadge =
    access.kind === 'vfs' ? (
      <Badge tone="success">Editable</Badge>
    ) : access.kind === 'fs' ? (
      <Tooltip content="Saving opens a review dialog; nothing is written without your approval">
        <span>
          <Badge tone="warning">
            <ShieldCheck size={10} /> Writes need approval
          </Badge>
        </span>
      </Tooltip>
    ) : (
      <Badge tone="outline">
        <Lock size={10} /> Read-only
      </Badge>
    );

  return (
    <div className={s.wrap} data-testid="code-editor" data-path={path}>
      <div className={s.bar}>
        <div className={s.crumbs} title={path}>
          {segments.map((seg, i) => (
            <span key={i} className={s.crumb} data-last={i === segments.length - 1 ? 'true' : undefined}>
              {i > 0 && <ChevronRight size={11} className={s.crumbSep} />}
              {seg}
            </span>
          ))}
          {dirty && <span className={s.dirtyDot} title="Unsaved changes" />}
        </div>
        <span style={{ flex: 1 }} />
        {accessBadge}
        {dirty && !access.readOnly && (
          <Button size="sm" variant="ghost" icon={<RotateCcw size={12} />} onClick={revert}>
            Revert
          </Button>
        )}
        <Tooltip content={access.readOnly ? access.reason : 'Save file'} shortcut={access.readOnly ? undefined : 'Mod+S'}>
          <span>
            <Button size="sm" variant={dirty ? 'primary' : 'secondary'} icon={saving ? <Spinner /> : <Save size={12} />} disabled={access.readOnly || !dirty || saving} onClick={() => void save()} data-testid="editor-save">
              {access.kind === 'fs' ? 'Review & save' : 'Save'}
            </Button>
          </span>
        </Tooltip>
      </div>
      {access.kind === 'demo' && (
        <div className={s.banner} data-testid="readonly-banner">
          <Lock size={13} />
          <span>
            <b>Demo sources are read-only.</b> Edits on the canvas still export as a reviewable patch; to change files, work on a copy.
          </span>
          <Button size="sm" icon={duplicating ? <Spinner /> : <CopyPlus size={12} />} disabled={duplicating} onClick={duplicate} data-testid="duplicate-demo-editor">
            Duplicate as editable project
          </Button>
        </div>
      )}
      {external && (
        <div className={s.banner} data-tone="warning">
          <RotateCcw size={13} />
          <span>
            <b>This file changed in the project</b> while you had unsaved edits.
          </span>
          <Button
            size="sm"
            onClick={() => {
              const v = viewRef.current;
              const buf = buffers.get(doc.id);
              if (v && buf) {
                v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: external.text } });
                buf.original = external.text;
                buf.sha256 = external.sha256;
                markDirty(false);
              }
              setExternal(null);
            }}
          >
            Load project version
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const buf = buffers.get(doc.id);
              if (buf) {
                buf.original = external.text;
                buf.sha256 = external.sha256;
              }
              setExternal(null);
            }}
          >
            Keep mine
          </Button>
        </div>
      )}
      <div className={s.editorArea}>
        <div ref={hostRef} className={s.host} style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }} />
        {status === 'loading' && (
          <div className={s.overlay}>
            <Spinner size={16} />
          </div>
        )}
        {status === 'error' && (
          <div className={s.overlay}>
            <EmptyPanel icon={FileWarning} title="Cannot open this file" tone="danger">
              {error}
            </EmptyPanel>
          </div>
        )}
        {status === 'binary' && binary && <BinaryPreview file={binary} />}
      </div>
      <div className={s.status}>
        {status === 'ready' ? (
          <>
            <span>
              Ln {cursor.line}, Col {cursor.col}
            </span>
            <span>{lines} lines</span>
            <span>Spaces: 2</span>
            <span>UTF-8</span>
            <span>{LANGUAGE_LABEL[lang]}</span>
          </>
        ) : (
          <span>{status === 'binary' ? 'Binary file' : status === 'loading' ? 'Loading…' : 'Unavailable'}</span>
        )}
        <span style={{ flex: 1 }} />
        <span>{access.label}</span>
      </div>
    </div>
  );
}

function BinaryPreview({ file }: { file: SourceRead }) {
  const [fontFamily, setFontFamily] = useState<string | null>(null);
  const url = file.base64 ? `data:${file.mime};base64,${file.base64}` : '';
  const isImage = file.mime.startsWith('image/');
  const isFont = file.mime.startsWith('font/');
  useEffect(() => {
    if (!isFont || !url) return;
    const family = `ifdy-preview-${Math.random().toString(36).slice(2, 8)}`;
    const face = new FontFace(family, `url(${url})`);
    face
      .load()
      .then((f) => {
        document.fonts.add(f);
        setFontFamily(family);
      })
      .catch(() => setFontFamily(null));
    return () => {
      document.fonts.delete(face);
    };
  }, [url, isFont]);
  const size = file.size > 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;
  return (
    <div className={s.binary}>
      {isImage && url ? (
        <div className={s.checker}>
          <img src={url} alt={file.path} />
        </div>
      ) : isFont && fontFamily ? (
        <div className={s.specimen} style={{ fontFamily }}>
          <div style={{ fontSize: 44 }}>Aa Bb Cc 0123</div>
          <div style={{ fontSize: 18 }}>The quick brown fox jumps over the lazy dog.</div>
        </div>
      ) : (
        <EmptyPanel icon={FileImage} title="Binary file">
          This file cannot be edited as text.
        </EmptyPanel>
      )}
      <div className={s.binaryMeta}>
        {file.path} · {file.mime} · {size}
      </div>
    </div>
  );
}
