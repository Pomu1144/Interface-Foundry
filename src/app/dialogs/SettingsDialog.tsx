import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Dialog, NumberField, Segmented, Switch } from '@/ui';
import { studio, useStudio } from '@/store';
import { art } from '@/app/art';
import { clearAllData } from '@/modules/project-storage/storage';
import s from './dialogs.module.css';

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const settings = useStudio((st) => st.settings);
  const server = useStudio((st) => st.server);
  const set = studio().updateSettings;
  const caps = server.capabilities;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Settings" description="Workspace, privacy, preview security and AI" width={640}>
      <div className={s.stack}>
        <div className={s.about}>
          <img src={art.appIcon} alt="" />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>IFDY — Interface Foundry</div>
            <div className={s.help}>
              Version 0.1 · Companion {server.status === 'online' ? 'connected' : 'offline'} · Preview origin {server.previewOrigin ?? 'n/a'}
            </div>
          </div>
        </div>

        <div className={s.sectionTitle}>Appearance</div>
        <Row title="Theme" desc="The studio chrome. Preview color scheme is set from the toolbar.">
          <Segmented ariaLabel="Theme" value={settings.theme} onChange={(theme) => set({ theme })} options={[{ value: 'dark', label: 'Graphite' }, { value: 'light', label: 'Light' }]} />
        </Row>
        <Row title="Reduced motion" desc="Fold transitions jump instead of animating.">
          <Switch ariaLabel="Reduced motion" checked={settings.reducedMotion} onChange={(reducedMotion) => set({ reducedMotion })} />
        </Row>
        <Row title="System UI in device frames" desc="Status bar, home indicator and safe areas.">
          <Switch ariaLabel="System UI" checked={settings.showSystemUI} onChange={(showSystemUI) => set({ showSystemUI })} />
        </Row>
        <Row title="Hinge & fold visualization">
          <Switch ariaLabel="Hinge" checked={settings.showHinge} onChange={(showHinge) => set({ showHinge })} />
        </Row>
        <Row title="Media-query bar" desc="Breakpoints from the page's CSS above the device.">
          <Switch ariaLabel="Media query bar" checked={settings.showRulers} onChange={(showRulers) => set({ showRulers })} />
        </Row>

        <div className={s.sectionTitle}>Privacy & recording</div>
        <Row title="Mask all typed input while recording" desc="Password, card and other sensitive fields are always masked; this masks everything.">
          <Switch ariaLabel="Mask inputs" checked={settings.maskAllInputs} onChange={(maskAllInputs) => set({ maskAllInputs })} />
        </Row>
        <Row title="Telemetry" desc="IFDY sends no telemetry. This switch only enables a local event log.">
          <Switch ariaLabel="Telemetry" checked={settings.telemetry} onChange={(telemetry) => set({ telemetry })} />
        </Row>
        <Row title="Local data" desc="Projects, edits, screenshots and recordings are stored in this browser (IndexedDB) only.">
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 size={12} />}
            onClick={async () => {
              if (!confirm('Delete every IFDY project, screenshot and recording stored in this browser?')) return;
              await clearAllData();
              toast.success('All local IFDY data cleared');
            }}
          >
            Clear all data
          </Button>
        </Row>

        <div className={s.sectionTitle}>Preview instrumentation</div>
        <Row title="Instrument event listeners" desc="Wraps addEventListener inside the preview (reloads it) so the Events tab can list every listener. Off by default.">
          <Switch ariaLabel="Instrument events" checked={settings.instrumentEvents} onChange={(instrumentEvents) => set({ instrumentEvents })} />
        </Row>
        <Row title="Instrument fetch / XHR" desc="Adds methods, statuses and failure reasons to the Network panel. Bodies and auth headers are never captured.">
          <Switch ariaLabel="Instrument network" checked={settings.instrumentNetwork} onChange={(instrumentNetwork) => set({ instrumentNetwork })} />
        </Row>

        <div className={s.sectionTitle}>Audits</div>
        <Row title="Minimum tap target (px)" desc="WCAG 2.5.8 minimum is 24; Apple/Google guidance is 44/48.">
          <div style={{ width: 90 }}>
            <NumberField value={String(settings.minTapSize)} unit="" onCommit={(v) => set({ minTapSize: Number(v) || 24 })} />
          </div>
        </Row>
        <Row title="Maximum line length (characters)">
          <div style={{ width: 90 }}>
            <NumberField value={String(settings.maxLineLength)} unit="" onCommit={(v) => set({ maxLineLength: Number(v) || 110 })} />
          </div>
        </Row>

        <div className={s.sectionTitle}>AI assistant</div>
        <Row title="Provider" desc="Anthropic runs through the local companion (key stays server-side). Local uses an explicitly configured OpenAI-compatible endpoint. Heuristic runs fully offline.">
          <Segmented
            ariaLabel="AI provider"
            value={settings.aiProvider}
            onChange={(aiProvider) => set({ aiProvider })}
            options={[
              { value: 'heuristic', label: 'Offline' },
              { value: 'anthropic', label: 'Anthropic', disabled: !caps?.ai.anthropic },
              { value: 'local', label: 'Local', disabled: !caps?.ai.local },
            ]}
          />
        </Row>
        <Row title="External processing consent" desc="Required before any page context is sent to an external AI service. You can review exactly what is sent.">
          <Switch ariaLabel="AI consent" checked={settings.aiConsent} onChange={(aiConsent) => set({ aiConsent })} />
        </Row>

        <div className={s.sectionTitle}>Companion capabilities</div>
        <Row title="Controlled Chromium">
          {caps?.browser.available ? <Badge tone="success">Available</Badge> : <Badge tone="warning" title={caps?.browser.reason}>Unavailable</Badge>}
        </Row>
        <Row title="Local filesystem" desc={caps?.fs.available ? caps.fs.roots.map((r) => r.path).join(', ') : 'Set IFDY_ALLOWED_ROOTS to grant access to specific directories.'}>
          {caps?.fs.available ? <Badge tone="success">{caps.fs.roots.length} root(s)</Badge> : <Badge tone="outline">Not granted</Badge>}
        </Row>
      </div>
    </Dialog>
  );
}

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className={s.row}>
      <div className={s.rowText}>
        <div className={s.rowTitle}>{title}</div>
        {desc && <div className={s.rowDesc}>{desc}</div>}
      </div>
      {children}
    </div>
  );
}
