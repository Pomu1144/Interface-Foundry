import { Clipboard, Crosshair, Download, Film, FolderInput, Image as ImageIcon, ImagePlus, Images, Library, Paintbrush, RefreshCw, Replace, Shapes, Trash2, Type, Undo2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { PageAsset } from '@shared/protocol';
import { Badge, Button, IconButton, Menu, SearchInput, Segmented, Spinner, Tooltip } from '@/ui';
import { studio, useStudio, type AssetRef } from '@/store';
import { previews } from '@/modules/preview-runtime/registry';
import { refreshSelection, watchOverlayIds } from '@/modules/preview-runtime/sync';
import { EmptyPanel } from '@/modules/export-engine/EmptyPanel';
import { downloadBlob } from '@/modules/export-engine/engine';
import {
  addFiles,
  assetChangesFor,
  fontFaceCss,
  formatBytes,
  importPageAsset,
  loadFontPreview,
  replaceSelectedImage,
  restoreOriginal,
  scanPageAssets,
  selectedImage,
  useAsBackground,
  usageCount,
} from './assets';
import s from './assets.module.css';

type View = 'library' | 'page';
type Kind = 'all' | AssetRef['type'];

const KIND_LABEL: Record<Kind, string> = { all: 'All', image: 'Images', icon: 'Icons', font: 'Fonts', media: 'Media' };

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error('Clipboard unavailable');
  }
}

export function AssetsPanel() {
  const project = useStudio((st) => st.project);
  const assets = useStudio((st) => st.assets);
  const [view, setView] = useState<View>('library');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => (kind === 'all' || a.type === kind) && (!q || a.name.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q))));
  }, [assets, kind, query]);
  const current = assets.find((a) => a.id === selected) ?? null;

  if (!project) return <EmptyPanel icon={Images} title="No project">Open a project to manage images, icons, fonts and media.</EmptyPanel>;

  const upload = async (files: FileList | File[]) => {
    if (!files.length) return;
    setBusy(true);
    const { added, errors } = await addFiles(files);
    setBusy(false);
    if (added.length) {
      toast.success(`Added ${added.length} asset${added.length === 1 ? '' : 's'}`);
      setSelected(added[added.length - 1].id);
      setView('library');
    }
    for (const e of errors.slice(0, 3)) toast.error(e);
  };

  return (
    <div
      className={s.wrap}
      data-testid="assets-panel"
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void upload(e.dataTransfer.files);
      }}
    >
      <input ref={fileRef} type="file" multiple hidden accept="image/*,.svg,.woff,.woff2,.ttf,.otf,video/*,audio/*" onChange={(e) => e.target.files && void upload(e.target.files).finally(() => (e.target.value = ''))} />
      <div className={s.toolbar}>
        <Segmented
          ariaLabel="Assets view"
          value={view}
          onChange={setView}
          options={[
            { value: 'library', label: 'Library', icon: <Library size={12} /> },
            { value: 'page', label: 'On page', icon: <Shapes size={12} /> },
          ]}
        />
        <span style={{ flex: 1 }} />
        <Tooltip content="Upload images, SVG icons, fonts or video (or drop files here)">
          <span>
            <Button size="sm" icon={busy ? <Spinner /> : <Upload size={12} />} onClick={() => fileRef.current?.click()} data-testid="assets-upload">
              Upload
            </Button>
          </span>
        </Tooltip>
      </div>
      {view === 'library' ? (
        <>
          {assets.length > 0 && (
            <>
              <div className={s.search}>
                <SearchInput value={query} onChange={setQuery} placeholder="Search assets" />
              </div>
              <div className={s.kinds}>
                {(Object.keys(KIND_LABEL) as Kind[]).map((k) => {
                  const n = k === 'all' ? assets.length : assets.filter((a) => a.type === k).length;
                  if (k !== 'all' && !n) return null;
                  return (
                    <button key={k} className={s.kind} data-active={kind === k ? 'true' : undefined} onClick={() => setKind(k)}>
                      {KIND_LABEL[k]} <span>{n}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div className={s.scroll}>
            {!assets.length ? (
              <div className={s.dropZone} onClick={() => fileRef.current?.click()} role="button" tabIndex={0}>
                <EmptyPanel icon={ImagePlus} title="Drop assets here" tone="accent">
                  Images, SVG icons, fonts and video are stored with this project in your browser. Replace a selected image, use one as a background, or copy <code>@font-face</code> CSS.
                </EmptyPanel>
              </div>
            ) : !visible.length ? (
              <EmptyPanel icon={Images} title="No matching assets" compact />
            ) : (
              <div className={s.grid}>
                {visible.map((a) => (
                  <button key={a.id} className={s.tile} data-active={selected === a.id ? 'true' : undefined} onClick={() => setSelected(selected === a.id ? null : a.id)} title={`${a.name} · ${formatBytes(a.size)}`} data-testid="asset-tile">
                    <span className={s.thumb}>
                      <Thumb asset={a} />
                    </span>
                    <span className={s.tileName}>{a.name}</span>
                    <span className={s.tileMeta}>{a.type === 'font' ? 'Font' : formatBytes(a.size)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {current && <AssetDetail asset={current} onClose={() => setSelected(null)} />}
        </>
      ) : (
        <PageAssets />
      )}
      {dragging && (
        <div className={s.dropOverlay}>
          <Upload size={20} />
          Drop to add to the library
        </div>
      )}
    </div>
  );
}

function Thumb({ asset }: { asset: AssetRef }) {
  const [family, setFamily] = useState<string | null>(null);
  useEffect(() => {
    if (asset.type === 'font') void loadFontPreview(asset).then(setFamily);
  }, [asset]);
  if (asset.type === 'image' || asset.type === 'icon') return <img src={asset.dataUrl} alt="" draggable={false} />;
  if (asset.type === 'font') return <span className={s.fontThumb} style={{ fontFamily: family ?? undefined }}>Aa</span>;
  return <Film size={18} />;
}

function AssetDetail({ asset, onClose }: { asset: AssetRef; onClose: () => void }) {
  const selection = useStudio((st) => st.selection.info);
  useStudio((st) => st.changes.length);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [family, setFamily] = useState<string | null>(null);
  const img = selectedImage();
  const replaced = selection ? assetChangesFor(selection.selector) : [];
  const used = usageCount(asset);
  useEffect(() => {
    setDims(null);
    if (asset.type === 'font') void loadFontPreview(asset).then(setFamily);
  }, [asset]);
  const inPicture = selection?.path.at(-2)?.label.startsWith('picture');
  return (
    <div className={s.detail} data-testid="asset-detail">
      <div className={s.detailHead}>
        <span className={s.detailName} title={asset.name}>
          {asset.name}
        </span>
        <Badge tone="outline">{asset.type}</Badge>
        <IconButton size="sm" label="Close" onClick={onClose}>
          <X size={12} />
        </IconButton>
      </div>
      <div className={s.preview}>
        {asset.type === 'image' || asset.type === 'icon' ? (
          <img src={asset.dataUrl} alt={asset.name} onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
        ) : asset.type === 'font' ? (
          <div className={s.specimen} style={{ fontFamily: family ?? undefined }}>
            <div style={{ fontSize: 28 }}>Aa Bb 0123</div>
            <div style={{ fontSize: 12 }}>Pay your mortgage in two taps.</div>
          </div>
        ) : asset.mime.startsWith('video/') ? (
          <video src={asset.dataUrl} muted controls preload="metadata" />
        ) : (
          <audio src={asset.dataUrl} controls preload="metadata" />
        )}
      </div>
      <div className={s.meta}>
        {asset.mime} · {formatBytes(asset.size)}
        {dims ? ` · ${dims.w}×${dims.h}` : ''}
        {used ? ` · used by ${used} edit${used === 1 ? '' : 's'}` : ''}
      </div>
      <div className={s.actions}>
        {(asset.type === 'image' || asset.type === 'icon') && (
          <>
            <Tooltip content={img ? `Set src of ${img.label}${img.attrs.some(([n]) => n === 'srcset') ? ' (srcset is cleared so it cannot win)' : ''}` : 'Select an <img> in the preview first'}>
              <span>
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Replace size={12} />}
                  disabled={!img}
                  data-testid="asset-replace"
                  onClick={() => {
                    if (replaceSelectedImage(asset)) toast.success(`Replaced ${img!.label}`, { description: inPicture ? 'This image sits in a <picture>; <source> elements may still override it at some widths.' : 'Undo or “Restore original” brings back the source image.' });
                  }}
                >
                  Replace image
                </Button>
              </span>
            </Tooltip>
            <Tooltip content={selection ? (asset.size > 300 * 1024 ? 'Large files make the override CSS heavy; consider adding the file to your project instead' : `background-image on ${selection.label}`) : 'Select an element first'}>
              <span>
                <Button size="sm" icon={<Paintbrush size={12} />} disabled={!selection} onClick={() => useAsBackground(asset)}>
                  Background
                </Button>
              </span>
            </Tooltip>
          </>
        )}
        {asset.type === 'font' && (
          <Menu
            trigger={
              <Button size="sm" icon={<Clipboard size={12} />}>
                Copy @font-face
              </Button>
            }
            items={[
              { label: 'With file path (fonts/…)', hint: 'recommended', onSelect: () => void copy(fontFaceCss(asset, 'file'), '@font-face CSS') },
              { label: 'With embedded data URL', onSelect: () => void copy(fontFaceCss(asset, 'embed'), '@font-face CSS') },
            ]}
          />
        )}
        <IconButton size="sm" label="Download file" onClick={() => fetch(asset.dataUrl).then((r) => r.blob()).then((b) => downloadBlob(asset.name, b))}>
          <Download size={12} />
        </IconButton>
        <IconButton size="sm" label="Copy data URL" onClick={() => void copy(asset.dataUrl, 'Data URL')}>
          <Clipboard size={12} />
        </IconButton>
        <span style={{ flex: 1 }} />
        <IconButton
          size="sm"
          tone="danger"
          label={used ? `Delete (used by ${used} edit${used === 1 ? '' : 's'} — they keep working until undone)` : 'Delete asset'}
          onClick={() => {
            studio().deleteAsset(asset.id);
            onClose();
          }}
        >
          <Trash2 size={12} />
        </IconButton>
      </div>
      {selection && replaced.length > 0 && (
        <div className={s.restore}>
          <span>
            {selection.label} shows a library asset. Original: <code>{replaced.find((c) => c.property === 'src')?.before ?? '—'}</code>
          </span>
          <Button size="sm" variant="ghost" icon={<Undo2 size={12} />} onClick={() => restoreOriginal(selection.selector)} data-testid="asset-restore">
            Restore original
          </Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

const GROUPS: { kind: PageAsset['kind']; label: string; icon: typeof ImageIcon }[] = [
  { kind: 'image', label: 'Images', icon: ImageIcon },
  { kind: 'background', label: 'CSS backgrounds', icon: Paintbrush },
  { kind: 'icon', label: 'SVG icons', icon: Shapes },
  { kind: 'video', label: 'Video', icon: Film },
  { kind: 'font', label: 'Fonts in use', icon: Type },
];

function PageAssets() {
  const ready = useStudio((st) => Object.values(st.instances).some((i) => i.role === 'primary' && i.status === 'ready'));
  const route = useStudio((st) => st.currentRoute);
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; items: PageAsset[]; error?: string }>({ status: 'idle', items: [] });
  const [importing, setImporting] = useState<string | null>(null);
  const scan = async () => {
    setState((st) => ({ ...st, status: 'loading' }));
    try {
      setState({ status: 'ready', items: await scanPageAssets() });
    } catch (err) {
      setState({ status: 'error', items: [], error: err instanceof Error ? err.message : String(err) });
    }
  };
  useEffect(() => {
    if (ready) void scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, route]);

  if (!ready) return <EmptyPanel icon={Shapes} title="Waiting for the preview">Page assets are read from the live page once it connects.</EmptyPanel>;
  if (state.status === 'loading' && !state.items.length)
    return (
      <EmptyPanel icon={Shapes} title="Scanning the page…">
        <Spinner />
      </EmptyPanel>
    );
  if (state.status === 'error')
    return (
      <EmptyPanel icon={Shapes} title="Scan failed" tone="danger" action={<Button size="sm" onClick={scan}>Retry</Button>}>
        {state.error}
      </EmptyPanel>
    );

  const select = async (a: PageAsset) => {
    const conn = previews.primary();
    if (!conn?.ready || !a.selector) return;
    const id = await conn.call('dom.resolve', { selector: a.selector }).catch(() => null);
    if (!id) return toast('That element is no longer on the page');
    studio().select(conn.id, id, null);
    void refreshSelection();
    watchOverlayIds();
    conn.tell('node.scrollIntoView', { id });
  };
  const add = async (a: PageAsset) => {
    setImporting(a.url);
    try {
      const asset = await importPageAsset(a);
      toast.success(`Added ${asset.name} to the library`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(null);
    }
  };

  return (
    <div className={s.scroll}>
      <div className={s.pageHead}>
        <span>
          {state.items.length} asset{state.items.length === 1 ? '' : 's'} on this route
        </span>
        <IconButton size="sm" label="Rescan page" onClick={scan}>
          {state.status === 'loading' ? <Spinner /> : <RefreshCw size={12} />}
        </IconButton>
      </div>
      {!state.items.length && <EmptyPanel icon={Shapes} title="No assets found" compact>This page uses no images, backgrounds, video or web fonts.</EmptyPanel>}
      {GROUPS.map((g) => {
        const items = state.items.filter((i) => i.kind === g.kind);
        if (!items.length) return null;
        const Icon = g.icon;
        return (
          <div key={g.kind} className={s.pageGroup}>
            <div className={s.groupHead}>
              <Icon size={12} /> {g.label} <span>{items.length}</span>
            </div>
            {items.map((a, i) => (
              <div key={`${a.url}|${a.label}|${i}`} className={s.pageRow} data-testid="page-asset">
                <span className={s.pageThumb}>
                  {a.kind === 'font' ? <span style={{ fontFamily: a.family ? `"${a.family}"` : undefined }}>Aa</span> : a.kind === 'video' ? <Film size={14} /> : <img src={a.url} alt="" loading="lazy" draggable={false} />}
                </span>
                <span className={s.pageInfo}>
                  <span className={s.pageLabel} title={a.url || a.label}>
                    {a.label}
                  </span>
                  <span className={s.pageMeta}>
                    {a.kind === 'font'
                      ? `${a.status === 'system' ? 'system / not loaded by the page' : a.status} · ${a.count} element${a.count === 1 ? '' : 's'}`
                      : `${a.width && a.height ? `${a.width}×${a.height} · ` : ''}${a.count}× ${a.alt !== undefined ? (a.alt ? `· alt “${a.alt.slice(0, 24)}”` : '· empty alt') : ''}`}
                  </span>
                </span>
                {a.selector && (
                  <IconButton size="sm" label="Select element" onClick={() => void select(a)}>
                    <Crosshair size={12} />
                  </IconButton>
                )}
                {a.url && (
                  <IconButton size="sm" label="Add to library" onClick={() => void add(a)} disabled={importing === a.url}>
                    {importing === a.url ? <Spinner /> : <FolderInput size={12} />}
                  </IconButton>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
