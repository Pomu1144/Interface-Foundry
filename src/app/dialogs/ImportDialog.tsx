import { unzipSync } from 'fflate';
import { FolderOpen, FolderTree, Plug, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button, Dialog, Notice, Segmented, Spinner } from '@/ui';
import { useStudio } from '@/store';
import { art } from '@/app/art';
import { connectLocalServer, importStaticProject, openLocalDirectory } from '@/modules/project-adapter/projects';
import s from './dialogs.module.css';

type Mode = 'static' | 'local' | 'directory';
type Picked = { path: string; data: ArrayBuffer }[];

async function readEntries(items: DataTransferItemList): Promise<Picked> {
  const out: Picked = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ path: prefix + file.name, data: await file.arrayBuffer() });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[] = [];
      do {
        batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      } while (batch.length);
    }
  };
  const entries = [...items].map((i) => i.webkitGetAsEntry()).filter(Boolean) as FileSystemEntry[];
  for (const e of entries) await walk(e, '');
  return out;
}

async function fromFiles(files: FileList): Promise<Picked> {
  const out: Picked = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const unzipped = unzipSync(new Uint8Array(await f.arrayBuffer()));
      for (const [path, data] of Object.entries(unzipped)) {
        if (!path.endsWith('/') && !path.startsWith('__MACOSX')) out.push({ path, data: data.slice().buffer });
      }
    } else {
      out.push({ path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, data: await f.arrayBuffer() });
    }
  }
  return out;
}

const SKIP = /(^|\/)(node_modules|\.git|\.DS_Store|dist\/.*\.map)(\/|$)/;

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const caps = useStudio((st) => st.server.capabilities);
  const online = useStudio((st) => st.server.status === 'online');
  const [mode, setMode] = useState<Mode>('static');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('http://localhost:3000/');
  const folderRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const finish = async (name: string, files: Picked) => {
    const filtered = files.filter((f) => !SKIP.test(f.path));
    setBusy(true);
    try {
      await importStaticProject(name, filtered);
      toast.success(`Imported ${filtered.length} files`);
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Open a project" description="Bring real code into the studio. Previews run isolated on a separate origin." width={600}>
      <div className={s.stack}>
        <Segmented
          ariaLabel="Import method"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'static', label: 'Static files', icon: <Upload size={12} /> },
            { value: 'local', label: 'Local dev server', icon: <Plug size={12} /> },
            { value: 'directory', label: 'Local directory', icon: <FolderTree size={12} /> },
          ]}
        />
        {!online && <Notice tone="warning">The IFDY companion is offline. Start the studio with <code>npm run dev</code> to import projects.</Notice>}
        {mode === 'static' && (
          <>
            <div
              className={s.drop}
              data-over={over ? 'true' : undefined}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setOver(false);
                const files = e.dataTransfer.items?.length ? await readEntries(e.dataTransfer.items) : await fromFiles(e.dataTransfer.files);
                const name = files[0]?.path.split('/')[0]?.replace(/\.zip$/i, '') || 'Imported project';
                void finish(name, files);
              }}
            >
              {busy ? <Spinner size={22} /> : <img src={art.code} className={s.dropArt} alt="" />}
              <div style={{ color: 'var(--text-0)', fontWeight: 500 }}>Drop a folder or .zip with HTML, CSS and JavaScript</div>
              <div className={s.help}>Files stay on this machine: they are held in the local companion's memory and this browser's storage.</div>
              <div className={s.choices}>
                <Button size="sm" icon={<FolderOpen size={13} />} onClick={() => folderRef.current?.click()} disabled={busy || !online}>
                  Choose folder…
                </Button>
                <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={busy || !online}>
                  Choose .zip or files…
                </Button>
              </div>
            </div>
            <input
              ref={folderRef}
              type="file"
              hidden
              multiple
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={async (e) => {
                if (!e.target.files?.length) return;
                const files = await fromFiles(e.target.files);
                void finish(files[0]?.path.split('/')[0] || 'Imported project', files);
                e.target.value = '';
              }}
            />
            <input
              ref={fileRef}
              type="file"
              hidden
              multiple
              accept=".zip,.html,.htm,.css,.js,.mjs,.json,.svg,.png,.jpg,.jpeg,.webp,.gif,.woff,.woff2"
              onChange={async (e) => {
                if (!e.target.files?.length) return;
                const files = await fromFiles(e.target.files);
                void finish(e.target.files[0].name.replace(/\.(zip|html?)$/i, '') || 'Imported project', files);
                e.target.value = '';
              }}
            />
          </>
        )}
        {mode === 'local' && (
          <form
            className={s.stack}
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await connectLocalServer(url);
                onOpenChange(false);
              } catch (err) {
                toast.error((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className={s.field}>
              <label className={s.label} htmlFor="ifdy-local-url">
                Development server URL
              </label>
              <input id="ifdy-local-url" className={s.input} value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
              <div className={s.help}>
                Only loopback addresses (localhost, 127.0.0.1) are accepted. IFDY mirrors the server on its own port and injects the inspection agent into HTML responses; HMR websockets are forwarded. Your app's own security headers are left untouched.
              </div>
            </div>
            <div>
              <Button type="submit" variant="primary" disabled={busy || !online} icon={busy ? <Spinner /> : <Plug size={13} />}>
                Connect
              </Button>
            </div>
          </form>
        )}
        {mode === 'directory' && (
          <div className={s.stack}>
            {caps?.fs.available ? (
              caps.fs.roots.map((r) => (
                <div key={r.id} className={s.row}>
                  <div className={s.rowText}>
                    <div className={s.rowTitle}>{r.name}</div>
                    <div className={s.rowDesc}>{r.path}</div>
                  </div>
                  <Button
                    size="sm"
                    onClick={async () => {
                      await openLocalDirectory(r.id, r.name);
                      onOpenChange(false);
                    }}
                  >
                    Open
                  </Button>
                </div>
              ))
            ) : (
              <Notice>
                The companion can serve and patch a local directory once you grant it explicitly. Start IFDY with <code>IFDY_ALLOWED_ROOTS=/absolute/path/to/project npm run dev</code>. Nothing outside the listed roots can be read or written, and every write requires your approval in the Export panel.
              </Notice>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
