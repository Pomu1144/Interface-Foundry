import type { Change } from '@shared/types';
import type { PageAsset } from '@shared/protocol';
import { studio, type AssetRef } from '@/store';
import { changeId, makeChange } from '@/modules/change-manager/changes';
import { setStyle } from '@/modules/change-manager/edit';
import { currentViewportContext } from '@/modules/device-simulator/context';
import { callPrimary } from '@/modules/preview-runtime/registry';

/**
 * Asset library operations. Library files are stored as data URLs in the
 * project (IndexedDB); applying one to the page is an ordinary undoable
 * Change, so the original source is preserved and restorable.
 */

export const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const FONT_EXT = /\.(woff2?|ttf|otf)$/i;

export function assetTypeFor(mime: string, name: string): AssetRef['type'] | null {
  if (mime === 'image/svg+xml' || /\.svg$/i.test(name)) return 'icon';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('font/') || FONT_EXT.test(name) || mime === 'application/font-woff' || mime === 'application/x-font-ttf') return 'font';
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return 'media';
  return null;
}

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file'));
    r.readAsDataURL(blob);
  });

function fixMime(mime: string, name: string): string {
  if (mime && mime !== 'application/octet-stream') return mime;
  const ext = name.split('.').pop()?.toLowerCase();
  return ({ woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', svg: 'image/svg+xml', webp: 'image/webp', avif: 'image/avif' } as Record<string, string>)[ext ?? ''] ?? 'application/octet-stream';
}

let seq = 0;
const assetId = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`;

export async function fileToAsset(file: File | Blob, name: string, source: AssetRef['source'] = 'upload'): Promise<AssetRef> {
  const mime = fixMime(file.type, name);
  const type = assetTypeFor(mime, name);
  if (!type) throw new Error(`${name}: unsupported file type (${mime || 'unknown'}). Images, SVG icons, fonts and video are supported.`);
  if (file.size > MAX_ASSET_BYTES) throw new Error(`${name} is ${(file.size / 1024 / 1024).toFixed(1)} MB; the library limit is ${MAX_ASSET_BYTES / 1024 / 1024} MB per file.`);
  let dataUrl = await readAsDataUrl(file);
  if (!dataUrl.startsWith(`data:${mime}`)) dataUrl = dataUrl.replace(/^data:[^;,]*/, `data:${mime}`);
  return { id: assetId(), name, type, mime, size: file.size, dataUrl, createdAt: Date.now(), source, tags: [] };
}

export async function addFiles(files: FileList | File[]): Promise<{ added: AssetRef[]; errors: string[] }> {
  const added: AssetRef[] = [];
  const errors: string[] = [];
  for (const f of Array.from(files)) {
    try {
      const a = await fileToAsset(f, f.name);
      studio().addAsset(a);
      added.push(a);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { added, errors };
}

export function scanPageAssets(): Promise<PageAsset[]> {
  return callPrimary('assets.scan', undefined, 12000);
}

/** Copy a page asset into the library (needs the asset's server to allow cross-origin reads). */
export async function importPageAsset(a: PageAsset): Promise<AssetRef> {
  let blob: Blob;
  try {
    const r = await fetch(a.url, { mode: 'cors', credentials: 'omit' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    blob = await r.blob();
  } catch (err) {
    throw new Error(`Could not read ${a.label}: ${err instanceof Error ? err.message : String(err)}. Its server may not allow cross-origin reads.`);
  }
  const name = a.kind === 'font' && a.family ? `${a.family}${a.weight && a.weight !== '400' ? `-${a.weight}` : ''}.${(a.url.split('.').pop() ?? 'woff2').split(/[?#]/)[0]}` : a.label;
  const asset = await fileToAsset(blob, name, 'page');
  studio().addAsset(asset);
  return asset;
}

/* ------------------------------------------------------------------ */
/* Applying to the selection                                           */
/* ------------------------------------------------------------------ */

export function selectedImage() {
  const info = studio().selection.info;
  if (!info || info.tag !== 'img') return null;
  return info;
}

/** Replace the selected <img> source (and drop srcset so it cannot win). Undoable; the original is kept in the change. */
export function replaceSelectedImage(asset: AssetRef): boolean {
  const info = selectedImage();
  if (!info) return false;
  const attr = (n: string) => info.attrs.find(([k]) => k === n)?.[1] ?? null;
  const groupId = changeId();
  const viewport = currentViewportContext();
  const target = { selector: info.selector, label: info.label };
  const changes: Change[] = [
    makeChange({ kind: 'asset', target, property: 'src', before: attr('src'), after: asset.dataUrl, viewport, origin: 'assets', groupId, note: `asset:${asset.name}` }),
  ];
  if (attr('srcset') !== null) changes.push(makeChange({ kind: 'asset', target, property: 'srcset', before: attr('srcset'), after: null, viewport, origin: 'assets', groupId, note: `asset:${asset.name}` }));
  studio().commitChange(changes);
  return true;
}

export function useAsBackground(asset: AssetRef) {
  setStyle('background-image', `url("${asset.dataUrl}")`, 'assets');
}

/** Asset changes currently applied to an element (for "restore original"). */
export function assetChangesFor(selector: string): Change[] {
  return studio().changes.filter((c) => c.kind === 'asset' && c.target.selector === selector);
}

export function restoreOriginal(selector: string) {
  const ids = new Set(assetChangesFor(selector).map((c) => c.groupId ?? c.id));
  for (const id of ids) studio().removeChange(id);
}

export function usageCount(asset: AssetRef): number {
  return studio().changes.filter((c) => (c.kind === 'asset' && c.after === asset.dataUrl) || (c.kind === 'style' && c.after?.includes(asset.dataUrl.slice(0, 80)))).length;
}

/* ------------------------------------------------------------------ */
/* Fonts                                                               */
/* ------------------------------------------------------------------ */

export function fontFamilyName(asset: AssetRef): string {
  return asset.name
    .replace(/\.(woff2?|ttf|otf)$/i, '')
    .replace(/[-_](regular|normal|\d00)$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

function fontWeight(asset: AssetRef): string {
  const m = /[-_ ](\d00)\b/.exec(asset.name) ?? /(bold)/i.exec(asset.name);
  return m ? (m[1].toLowerCase() === 'bold' ? '700' : m[1]) : '400';
}

const FORMAT: Record<string, string> = { 'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'truetype', 'font/otf': 'opentype' };

export function fontFaceCss(asset: AssetRef, mode: 'file' | 'embed' = 'file'): string {
  const family = fontFamilyName(asset);
  const format = FORMAT[asset.mime] ?? 'woff2';
  const src = mode === 'embed' ? asset.dataUrl : `fonts/${asset.name}`;
  return `@font-face {\n  font-family: "${family}";\n  src: url("${src}") format("${format}");\n  font-weight: ${fontWeight(asset)};\n  font-style: ${/italic/i.test(asset.name) ? 'italic' : 'normal'};\n  font-display: swap;\n}\n`;
}

const loadedFonts = new Map<string, Promise<string | null>>();
/** Load a library font into the studio document for previews; resolves the family to use. */
export function loadFontPreview(asset: AssetRef): Promise<string | null> {
  const cached = loadedFonts.get(asset.id);
  if (cached) return cached;
  const family = `ifdy-asset-${asset.id}`;
  const p = new FontFace(family, `url(${asset.dataUrl})`)
    .load()
    .then((f) => {
      document.fonts.add(f);
      return family;
    })
    .catch(() => null);
  loadedFonts.set(asset.id, p);
  return p;
}

export const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
