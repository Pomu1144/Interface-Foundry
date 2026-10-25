import { ArrowRight, Globe } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Dialog, Notice, Spinner } from '@/ui';
import { useStudio } from '@/store';
import { runAction } from '@/app/actions';
import { openUrl } from '@/modules/project-adapter/projects';
import s from './dialogs.module.css';

export function SimulateUrlDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const caps = useStudio((st) => st.server.capabilities);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const remote = Boolean(caps?.browser.available);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Simulate a website across devices"
      description="Paste a link and see it on foldables, phones, tablets and desktops at once."
      icon={<Globe size={20} color="var(--accent-strong)" />}
      width={580}
      footer={
        <Button
          variant="primary"
          disabled={!url.trim() || busy}
          trailing={busy ? <Spinner /> : <ArrowRight size={14} />}
          onClick={async () => {
            setBusy(true);
            try {
              await openUrl(url.trim());
              onOpenChange(false);
              runAction('view.wall');
            } catch (err) {
              toast.error((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Simulate
        </Button>
      }
    >
      <div className={s.stack}>
        <input className={s.input} placeholder="https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus spellCheck={false} aria-label="Website URL" />
        <div className={s.row}>
          <div className={s.rowText}>
            <div className={s.rowTitle}>Engine</div>
            <div className={s.rowDesc}>
              {remote
                ? 'Controlled Chromium on this machine: true device emulation (viewport, DPR, touch, user agent, foldable display features), interactive, with console and network data.'
                : 'Embedded iframe: works only for sites that allow framing, read-only (no inspection).'}
            </div>
          </div>
          {remote ? <Badge tone="success">Chromium</Badge> : <Badge tone="warning">Embed</Badge>}
        </div>
        <Notice>
          A public URL grants no source-code or editing access. You can inspect what the browser renders and capture/compare screenshots; CSS experiments apply only to your local view. IFDY never bypasses a site's framing or security headers.
        </Notice>
      </div>
    </Dialog>
  );
}
